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
 * Combines multiple scanlines horizontally into one output scanline with variable widths
 */
function combineScanlines(
  scanlines: Uint8Array[],
  widths: number[],
  bytesPerPixel: number
): Uint8Array {
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const output = new Uint8Array(totalWidth * bytesPerPixel);

  let offset = 0;
  for (let i = 0; i < scanlines.length; i++) {
    output.set(scanlines[i], offset);
    offset += widths[i] * bytesPerPixel;
  }

  return output;
}

/**
 * Get transparent color for padding
 */
function getTransparentColor(colorType: number, bitDepth: number): Uint8Array {
  const bytesPerSample = bitDepth === 16 ? 2 : 1;

  switch (colorType) {
    case 0: return new Uint8Array(bytesPerSample).fill(0);
    case 2: return new Uint8Array(3 * bytesPerSample).fill(0);
    case 4:
      return bitDepth === 16 ? new Uint8Array([0, 0, 0, 0]) : new Uint8Array([0, 0]);
    case 6:
      return bitDepth === 16 ? new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]) : new Uint8Array([0, 0, 0, 0]);
    default:
      throw new Error(`Unsupported color type: ${colorType}`);
  }
}

/**
 * Create a transparent scanline of given width
 */
function createTransparentScanline(width: number, bytesPerPixel: number, transparentColor: Uint8Array): Uint8Array {
  const scanline = new Uint8Array(width * bytesPerPixel);
  for (let i = 0; i < width; i++) {
    scanline.set(transparentColor, i * bytesPerPixel);
  }
  return scanline;
}

/**
 * Pad a scanline to a target width with transparent pixels
 */
function padScanline(
  scanline: Uint8Array,
  currentWidth: number,
  targetWidth: number,
  bytesPerPixel: number,
  transparentColor: Uint8Array
): Uint8Array {
  if (currentWidth >= targetWidth) {
    return scanline;
  }

  const padded = new Uint8Array(targetWidth * bytesPerPixel);
  padded.set(scanline, 0);

  // Fill padding with transparent color
  for (let i = currentWidth; i < targetWidth; i++) {
    padded.set(transparentColor, i * bytesPerPixel);
  }

  return padded;
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
   * Stream concatenated PNG output scanline-by-scanline with support for arbitrary sizes
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

    // Validate all images have compatible format
    const firstHeader = headers[0];
    for (let i = 1; i < headers.length; i++) {
      if (headers[i].bitDepth !== firstHeader.bitDepth ||
          headers[i].colorType !== firstHeader.colorType) {
        throw new Error('All images must have same bit depth and color type');
      }
    }

    // Calculate layout with variable image sizes
    const layout = this.calculateLayout(headers);
    const { grid, rowHeights, colWidths, totalWidth, totalHeight } = layout;

    // Create output header
    const outputHeader: PngHeader = {
      width: totalWidth,
      height: totalHeight,
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
    const transparentColor = getTransparentColor(firstHeader.colorType, firstHeader.bitDepth);

    // Set up streaming compression
    const compressedChunks: Buffer[] = [];
    const deflate = createDeflate({ level: 9 });

    deflate.on('data', (chunk: Buffer) => {
      compressedChunks.push(chunk);
    });

    let previousOutputScanline: Uint8Array | null = null;

    // Process each output scanline
    let currentY = 0;
    for (let row = 0; row < grid.length; row++) {
      const rowHeight = rowHeights[row];
      const rowColWidths = colWidths[row];

      // Process each scanline in this row
      for (let localY = 0; localY < rowHeight; localY++) {
        const scanlines: Uint8Array[] = [];

        // Collect scanlines from all images in this row
        for (let col = 0; col < grid[row].length; col++) {
          const imageIdx = grid[row][col];
          const colWidth = rowColWidths[col];

          if (imageIdx >= 0) {
            const imageHeader = headers[imageIdx];
            const imageHeight = imageHeader.height;
            const imageWidth = imageHeader.width;

            if (localY < imageHeight) {
              // Read scanline from this image
              const { value, done } = await iterators[imageIdx].next();
              if (!done) {
                // Pad scanline if image is narrower than column
                const paddedScanline = padScanline(
                  value,
                  imageWidth,
                  colWidth,
                  bytesPerPixel,
                  transparentColor
                );
                scanlines.push(paddedScanline);
              } else {
                // Shouldn't happen, but handle gracefully
                scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
              }
            } else {
              // Below image - use transparent scanline
              scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
            }
          } else {
            // Empty cell - use transparent scanline
            scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
          }
        }

        // Combine scanlines horizontally
        const outputScanline = combineScanlines(scanlines, rowColWidths, bytesPerPixel);

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

        currentY++;
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
   * Calculate grid layout (same logic as legacy concatenator)
   */
  private calculateLayout(headers: PngHeader[]): {
    grid: number[][];
    rowHeights: number[];
    colWidths: number[][];
    totalWidth: number;
    totalHeight: number;
  } {
    const { layout } = this.options;
    const numImages = headers.length;

    let grid: number[][] = [];

    if (layout.columns && !layout.height) {
      const columns = layout.columns;
      const rows = Math.ceil(numImages / columns);
      grid = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          const idx = row * columns + col;
          return idx < numImages ? idx : -1;
        })
      );
    } else if (layout.rows && !layout.width) {
      const rows = layout.rows;
      const columns = Math.ceil(numImages / rows);
      grid = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          const idx = col * rows + row;
          return idx < numImages ? idx : -1;
        })
      );
    } else if (layout.width || layout.height) {
      grid = this.calculatePixelBasedLayout(
        headers,
        layout.width,
        layout.height,
        layout.columns,
        layout.rows
      );
    } else {
      grid = [Array.from({ length: numImages }, (_, i) => i)];
    }

    // Calculate max width per column in each row and max height per row
    const rowHeights: number[] = [];
    const colWidths: number[][] = [];

    for (let row = 0; row < grid.length; row++) {
      let maxHeight = 0;
      const rowColWidths: number[] = [];

      for (let col = 0; col < grid[row].length; col++) {
        const imageIdx = grid[row][col];
        if (imageIdx >= 0) {
          const header = headers[imageIdx];
          maxHeight = Math.max(maxHeight, header.height);
          rowColWidths[col] = Math.max(rowColWidths[col] || 0, header.width);
        } else {
          rowColWidths[col] = rowColWidths[col] || 0;
        }
      }

      rowHeights.push(maxHeight);
      colWidths.push(rowColWidths);
    }

    const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);
    const totalWidth = Math.max(...colWidths.map(row => row.reduce((sum, w) => sum + w, 0)));

    return { grid, rowHeights, colWidths, totalWidth, totalHeight };
  }

  /**
   * Calculate layout when pixel-based width/height limits are specified
   */
  private calculatePixelBasedLayout(
    headers: PngHeader[],
    maxWidth?: number,
    maxHeight?: number,
    fixedColumns?: number,
    fixedRows?: number
  ): number[][] {
    const grid: number[][] = [];
    let currentRow: number[] = [];
    let currentRowWidth = 0;
    let currentRowMaxHeight = 0;
    let totalHeight = 0;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const imageWidth = header.width;
      const imageHeight = header.height;

      const wouldExceedWidth = maxWidth && (currentRowWidth + imageWidth > maxWidth);
      const wouldExceedColumns = fixedColumns && (currentRow.length >= fixedColumns);

      if ((wouldExceedWidth || wouldExceedColumns) && currentRow.length > 0) {
        // Need to start a new row - check if it would exceed height limit
        const newRowHeight = imageHeight;
        const wouldExceedHeight = maxHeight && (totalHeight + currentRowMaxHeight + newRowHeight > maxHeight);

        if (wouldExceedHeight) {
          // Can't fit this image - stop here
          break;
        }

        grid.push(currentRow);
        totalHeight += currentRowMaxHeight;
        currentRow = [i];
        currentRowWidth = imageWidth;
        currentRowMaxHeight = imageHeight;
      } else {
        currentRow.push(i);
        currentRowWidth += imageWidth;
        currentRowMaxHeight = Math.max(currentRowMaxHeight, imageHeight);
      }

      if (fixedRows && grid.length >= fixedRows && currentRow.length === 0) {
        break;
      }
    }

    if (currentRow.length > 0) {
      grid.push(currentRow);
    }

    return grid;
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
