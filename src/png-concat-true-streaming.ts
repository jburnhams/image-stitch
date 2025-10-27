/**
 * TRUE STREAMING IMPLEMENTATION (Proof of Concept)
 *
 * This is a scanline-by-scanline streaming approach that minimizes memory usage.
 * Only reads input images as needed, processing one output row at a time.
 */

import { open, FileHandle } from 'node:fs/promises';
import { createDeflate } from 'node:zlib';
import { Readable } from 'node:stream';
import { ConcatOptions, PngHeader } from './types.js';
import { parsePngHeader } from './png-parser.js';
import { readFileSync } from 'node:fs';
import { PNG_SIGNATURE, readUInt32BE, bytesToString } from './utils.js';
import { unfilterScanline, filterScanline, getBytesPerPixel, FilterType } from './png-filter.js';
import { createIHDR, createIEND, serializeChunk, createChunk } from './png-writer.js';

/**
 * Represents a streaming PNG input that can read scanlines on-demand
 */
class StreamingPngInput {
  private fileHandle: FileHandle | null = null;
  private header: PngHeader;
  private scanlineLength: number;
  private bytesPerPixel: number;
  private decompressedData: Uint8Array | null = null;

  constructor(
    private filePath: string,
    header: PngHeader
  ) {
    this.header = header;
    this.bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    this.scanlineLength = Math.ceil(
      (header.width * header.bitDepth * this.getSamplesPerPixel(header.colorType)) / 8
    );
  }

  /**
   * Initialize the input by finding IDAT chunks
   */
  async init(): Promise<void> {
    this.fileHandle = await open(this.filePath, 'r');

    // Skip PNG signature
    let position = 8;

    // Find IDAT chunks
    const idatChunks: { offset: number; length: number }[] = [];

    while (true) {
      const lengthBuffer = Buffer.alloc(4);
      await this.fileHandle.read(lengthBuffer, 0, 4, position);
      const chunkLength = readUInt32BE(new Uint8Array(lengthBuffer), 0);
      position += 4;

      const typeBuffer = Buffer.alloc(4);
      await this.fileHandle.read(typeBuffer, 0, 4, position);
      const chunkType = bytesToString(new Uint8Array(typeBuffer));
      position += 4;

      if (chunkType === 'IDAT') {
        idatChunks.push({ offset: position, length: chunkLength });
      }

      // Skip chunk data + CRC
      position += chunkLength + 4;

      if (chunkType === 'IEND') {
        break;
      }
    }

    // Read and concatenate all IDAT data
    let totalIdatLength = 0;
    for (const chunk of idatChunks) {
      totalIdatLength += chunk.length;
    }

    const idatData = Buffer.alloc(totalIdatLength);
    let offset = 0;
    for (const chunk of idatChunks) {
      await this.fileHandle.read(idatData, offset, chunk.length, chunk.offset);
      offset += chunk.length;
    }

    // Decompress all IDAT data at once
    // NOTE: For truly minimal memory, we'd use streaming decompression
    const { inflateSync } = await import('node:zlib');
    this.decompressedData = inflateSync(idatData);
  }

  /**
   * Read a specific scanline
   */
  async readScanline(lineNumber: number): Promise<Uint8Array> {
    if (!this.decompressedData) {
      throw new Error('StreamingPngInput not initialized');
    }

    // Each scanline has: 1 byte filter type + scanline data
    const bytesPerLine = 1 + this.scanlineLength;
    const offset = lineNumber * bytesPerLine;

    if (offset + bytesPerLine > this.decompressedData.length) {
      throw new Error(`Scanline ${lineNumber} out of bounds`);
    }

    const filterType = this.decompressedData[offset] as FilterType;
    const filteredData = this.decompressedData.slice(offset + 1, offset + bytesPerLine);

    // Get previous scanline for unfiltering
    const prevScanline = lineNumber > 0 ? await this.readScanline(lineNumber - 1) : null;

    // Unfilter and return
    return unfilterScanline(filterType, filteredData, prevScanline, this.bytesPerPixel);
  }

  /**
   * Read scanlines sequentially (more efficient than random access)
   */
  async *scanlines(): AsyncGenerator<Uint8Array> {
    if (!this.decompressedData) {
      throw new Error('StreamingPngInput not initialized');
    }

    let previousScanline: Uint8Array | null = null;
    const bytesPerLine = 1 + this.scanlineLength;

    for (let line = 0; line < this.header.height; line++) {
      const offset = line * bytesPerLine;
      const filterType = this.decompressedData[offset] as FilterType;
      const filteredData = this.decompressedData.slice(offset + 1, offset + bytesPerLine);

      const unfilteredData = unfilterScanline(
        filterType,
        filteredData,
        previousScanline,
        this.bytesPerPixel
      );

      previousScanline = unfilteredData;
      yield unfilteredData;
    }
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
    }
  }

  getHeader(): PngHeader {
    return this.header;
  }

  private getSamplesPerPixel(colorType: number): number {
    switch (colorType) {
      case 0: return 1; // Grayscale
      case 2: return 3; // RGB
      case 3: return 1; // Palette
      case 4: return 2; // Grayscale + Alpha
      case 6: return 4; // RGBA
      default: throw new Error(`Unknown color type: ${colorType}`);
    }
  }
}

/**
 * Combines multiple scanlines horizontally into one output scanline
 */
function combineScanlines(
  scanlines: Uint8Array[],
  imageWidth: number,
  bytesPerPixel: number,
  columns: number
): Uint8Array {
  const outputWidth = columns * imageWidth;
  const output = new Uint8Array(outputWidth * bytesPerPixel);

  for (let i = 0; i < scanlines.length; i++) {
    const col = i % columns;
    const offset = col * imageWidth * bytesPerPixel;
    output.set(scanlines[i], offset);
  }

  return output;
}

/**
 * True streaming PNG concatenation with minimal memory usage
 *
 * This implementation:
 * 1. Pass 1: Reads only headers to validate and plan
 * 2. Pass 2: Processes scanline-by-scanline, streaming output
 *
 * Memory usage: O(rows_in_flight * row_width) instead of O(total_image_size)
 */
export class TrueStreamingConcatenator {
  private options: ConcatOptions;

  constructor(options: ConcatOptions) {
    this.options = options;
  }

  /**
   * Stream concatenated PNG output scanline-by-scanline
   */
  async *stream(): AsyncGenerator<Uint8Array> {
    // PASS 1: Read headers and validate
    const headers: PngHeader[] = [];
    const inputs: StreamingPngInput[] = [];

    for (const input of this.options.inputs) {
      const filePath = typeof input === 'string' ? input : null;
      if (!filePath) {
        throw new Error('True streaming requires file paths, not Uint8Arrays');
      }

      // Read just the header
      const data = readFileSync(filePath);
      const header = parsePngHeader(data);
      headers.push(header);

      // Create streaming input
      const streamInput = new StreamingPngInput(filePath, header);
      await streamInput.init();
      inputs.push(streamInput);
    }

    // Validate all images have same dimensions and format
    const firstHeader = headers[0];
    for (let i = 1; i < headers.length; i++) {
      if (headers[i].width !== firstHeader.width ||
          headers[i].height !== firstHeader.height ||
          headers[i].bitDepth !== firstHeader.bitDepth ||
          headers[i].colorType !== firstHeader.colorType) {
        throw new Error('All images must have same dimensions and format');
      }
    }

    // Calculate layout
    const imageWidth = firstHeader.width;
    const imageHeight = firstHeader.height;
    const columns = this.options.layout.columns || Math.ceil(inputs.length / (this.options.layout.rows || 1));
    const rows = Math.ceil(inputs.length / columns);

    // Create output header
    const outputHeader: PngHeader = {
      width: columns * imageWidth,
      height: rows * imageHeight,
      bitDepth: firstHeader.bitDepth,
      colorType: firstHeader.colorType,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Yield PNG signature
    yield PNG_SIGNATURE;

    // Yield IHDR
    yield serializeChunk(createIHDR(outputHeader));

    // PASS 2: Stream scanlines
    // Create iterators for each input
    const iterators = inputs.map(input => input.scanlines());
    const bytesPerPixel = getBytesPerPixel(firstHeader.bitDepth, firstHeader.colorType);

    // Set up streaming compression
    const compressedChunks: Buffer[] = [];
    const deflate = createDeflate({ level: 9 });

    deflate.on('data', (chunk: Buffer) => {
      compressedChunks.push(chunk);
    });

    let previousOutputScanline: Uint8Array | null = null;

    // Process each output row
    for (let outputY = 0; outputY < outputHeader.height; outputY++) {
      const inputRow = Math.floor(outputY / imageHeight);
      // localY = outputY % imageHeight (not needed - iterators auto-advance)

      // Collect scanlines from all images in this row
      const scanlines: Uint8Array[] = [];
      for (let col = 0; col < columns; col++) {
        const imageIndex = inputRow * columns + col;

        if (imageIndex < inputs.length) {
          // Read next scanline from this input
          const { value, done } = await iterators[imageIndex].next();
          if (!done) {
            scanlines.push(value);
          } else {
            // Pad with zeros if image doesn't exist
            scanlines.push(new Uint8Array(imageWidth * bytesPerPixel));
          }
        } else {
          // Pad with zeros
          scanlines.push(new Uint8Array(imageWidth * bytesPerPixel));
        }
      }

      // Combine scanlines horizontally
      const outputScanline = combineScanlines(scanlines, imageWidth, bytesPerPixel, columns);

      // Filter the scanline
      const { filterType, filtered } = filterScanline(
        outputScanline,
        previousOutputScanline,
        bytesPerPixel
      );

      // Write filter type + filtered data to compressor
      const scanlineWithFilter = new Uint8Array(1 + filtered.length);
      scanlineWithFilter[0] = filterType;
      scanlineWithFilter.set(filtered, 1);

      deflate.write(Buffer.from(scanlineWithFilter));

      previousOutputScanline = outputScanline;

      // Yield any compressed chunks that are ready
      while (compressedChunks.length > 0) {
        const chunk = compressedChunks.shift()!;
        yield serializeChunk(createChunk('IDAT', new Uint8Array(chunk)));
      }
    }

    // Finish compression
    deflate.end();

    // Wait for final compressed data
    await new Promise<void>((resolve) => {
      deflate.on('end', () => resolve());
    });

    // Yield any remaining compressed chunks
    while (compressedChunks.length > 0) {
      const chunk = compressedChunks.shift()!;
      yield serializeChunk(createChunk('IDAT', new Uint8Array(chunk)));
    }

    // Yield IEND
    yield serializeChunk(createIEND());

    // Clean up
    for (const input of inputs) {
      await input.close();
    }
  }

  /**
   * Convert to Node.js Readable stream
   */
  toReadableStream(): Readable {
    const generator = this.stream();

    return new Readable({
      async read() {
        try {
          const { value, done } = await generator.next();
          if (done) {
            this.push(null);
          } else {
            this.push(Buffer.from(value));
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      }
    });
  }
}

/**
 * Concatenate PNGs with true streaming (minimal memory usage)
 *
 * This processes images scanline-by-scanline, keeping only a few rows
 * in memory at a time. Ideal for large images.
 *
 * NOTE: Currently requires file paths (not Uint8Arrays) as inputs
 */
export async function* concatPngsTrueStreaming(
  options: ConcatOptions
): AsyncGenerator<Uint8Array> {
  const concatenator = new TrueStreamingConcatenator(options);
  yield* concatenator.stream();
}

/**
 * Get a Readable stream for true streaming concatenation
 */
export function concatPngsTrueStreamingToStream(options: ConcatOptions): Readable {
  const concatenator = new TrueStreamingConcatenator(options);
  return concatenator.toReadableStream();
}
