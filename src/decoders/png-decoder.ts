/**
 * PNG Decoder Implementation
 *
 * Implements the ImageDecoder interface for PNG format.
 * Supports streaming from files and memory buffers with minimal memory usage.
 */

import { open, FileHandle } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { ImageDecoder, ImageHeader, DecoderPlugin } from './types.js';
import { parsePngHeader, parsePngChunks } from '../png-parser.js';
import { unfilterScanline, getBytesPerPixel, FilterType } from '../png-filter.js';
import { readUInt32BE, bytesToString, getSamplesPerPixel } from '../utils.js';
import { decompressData } from '../png-decompress.js';
import { deinterlaceAdam7 } from '../adam7.js';
import type { PngHeader } from '../types.js';

/**
 * Convert PNG header to generic image header
 */
function pngHeaderToImageHeader(pngHeader: PngHeader): ImageHeader {
  // Determine channel count from PNG color type
  let channels: number;
  switch (pngHeader.colorType) {
    case 0: // Grayscale
      channels = 1;
      break;
    case 2: // RGB
      channels = 3;
      break;
    case 3: // Palette (treat as RGB after decoding)
      channels = 3;
      break;
    case 4: // Grayscale + Alpha
      channels = 2;
      break;
    case 6: // RGBA
      channels = 4;
      break;
    default:
      throw new Error(`Unsupported PNG color type: ${pngHeader.colorType}`);
  }

  return {
    width: pngHeader.width,
    height: pngHeader.height,
    channels,
    bitDepth: pngHeader.bitDepth,
    format: 'png',
    metadata: {
      colorType: pngHeader.colorType,
      compressionMethod: pngHeader.compressionMethod,
      filterMethod: pngHeader.filterMethod,
      interlaceMethod: pngHeader.interlaceMethod
    }
  };
}

/**
 * Decode scanlines from compressed PNG data
 */
async function* decodeScanlinesFromCompressedData(
  compressedData: Uint8Array,
  header: PngHeader
): AsyncGenerator<Uint8Array> {
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const scanlineLength = Math.ceil(
    (header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8
  );

  // For interlaced images, we need all data at once to deinterlace
  if (header.interlaceMethod === 1) {
    const decompressed = await decompressData(compressedData);
    const deinterlaced = deinterlaceAdam7(decompressed, header);

    // Yield scanlines from the deinterlaced data
    for (let y = 0; y < header.height; y++) {
      const offset = y * scanlineLength;
      yield deinterlaced.slice(offset, offset + scanlineLength);
    }
    return;
  }

  // For non-interlaced images, stream scanlines
  const bytesPerLine = 1 + scanlineLength;

  let previousScanline: Uint8Array | null = null;
  let bufferChunks: Uint8Array[] = [];
  let totalBufferLength = 0;
  let processedLines = 0;

  const sourceBuffer =
    compressedData.byteOffset === 0 && compressedData.byteLength === compressedData.buffer.byteLength
      ? (compressedData.buffer as ArrayBuffer)
      : compressedData.buffer.slice(
          compressedData.byteOffset,
          compressedData.byteOffset + compressedData.byteLength
        );

  const normalizedBuffer =
    sourceBuffer instanceof ArrayBuffer ? sourceBuffer : new Uint8Array(sourceBuffer).slice().buffer;

  const decompressedStream = new Blob([normalizedBuffer]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = decompressedStream.getReader();

  // Helper to merge chunks only when needed
  function getWorkingBuffer(): Uint8Array {
    if (bufferChunks.length === 0) {
      return new Uint8Array(0);
    }
    if (bufferChunks.length === 1) {
      return bufferChunks[0];
    }
    // Merge chunks
    const merged = new Uint8Array(totalBufferLength);
    let offset = 0;
    for (const chunk of bufferChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    bufferChunks = [merged];
    return merged;
  }

  try {
    while (processedLines < header.height) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }

      // Add chunk to list instead of merging immediately
      bufferChunks.push(value);
      totalBufferLength += value.length;

      // Process scanlines if we have enough data
      while (totalBufferLength >= bytesPerLine && processedLines < header.height) {
        const buffer = getWorkingBuffer();

        if (buffer.length < bytesPerLine) break;

        const filterType = buffer[0] as FilterType;
        const filtered = buffer.subarray(1, 1 + scanlineLength);

        const unfiltered = unfilterScanline(filterType, filtered, previousScanline, bytesPerPixel);
        previousScanline = unfiltered;
        processedLines++;

        // Update buffer
        const remaining = buffer.subarray(bytesPerLine);
        bufferChunks = remaining.length > 0 ? [remaining] : [];
        totalBufferLength = remaining.length;

        yield unfiltered;
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Process any remaining scanlines
  while (totalBufferLength >= bytesPerLine && processedLines < header.height) {
    const buffer = getWorkingBuffer();

    if (buffer.length < bytesPerLine) break;

    const filterType = buffer[0] as FilterType;
    const filtered = buffer.subarray(1, 1 + scanlineLength);

    const unfiltered = unfilterScanline(filterType, filtered, previousScanline, bytesPerPixel);
    previousScanline = unfiltered;
    processedLines++;

    // Update buffer
    const remaining = buffer.subarray(bytesPerLine);
    bufferChunks = remaining.length > 0 ? [remaining] : [];
    totalBufferLength = remaining.length;

    yield unfiltered;
  }

  if (processedLines !== header.height) {
    throw new Error(`Expected ${header.height} scanlines, decoded ${processedLines}`);
  }

  if (totalBufferLength > 0) {
    const finalBuffer = getWorkingBuffer();
    const hasResidualData = finalBuffer.some((value) => value !== 0);
    if (hasResidualData) {
      throw new Error(`Unexpected remaining decompressed data (${totalBufferLength} bytes)`);
    }
  }
}

/**
 * PNG decoder for file-based inputs
 * Streams data directly from disk with minimal memory usage
 */
export class PngFileDecoder implements ImageDecoder {
  private fileHandle: FileHandle | null = null;
  private pngHeader: PngHeader | null = null;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getHeader(): Promise<ImageHeader> {
    if (this.pngHeader) {
      return pngHeaderToImageHeader(this.pngHeader);
    }

    // Read just enough to parse the header (typically < 1KB)
    const data = readFileSync(this.filePath);
    this.pngHeader = parsePngHeader(data);
    return pngHeaderToImageHeader(this.pngHeader);
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    await this.getHeader(); // Ensure header is loaded
    const pngHeader = this.pngHeader!;

    // Open file for streaming
    this.fileHandle = await open(this.filePath, 'r');

    try {
      // Find and read IDAT chunks
      const idatData = await this.extractIdatData();
      const compressedView = new Uint8Array(idatData.buffer, idatData.byteOffset, idatData.byteLength);

      for await (const scanline of decodeScanlinesFromCompressedData(compressedView, pngHeader)) {
        yield scanline;
      }
    } finally {
      // Ensure file handle is closed even if iteration stops early
      if (this.fileHandle) {
        await this.fileHandle.close();
        this.fileHandle = null;
      }
    }
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  private async extractIdatData(): Promise<Buffer> {
    if (!this.fileHandle) {
      throw new Error('File not opened');
    }

    let position = 8; // Skip PNG signature
    const idatChunks: { offset: number; length: number }[] = [];

    // Find all IDAT chunks
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

      position += chunkLength + 4; // Skip data + CRC

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

    return idatData;
  }
}

/**
 * PNG decoder for in-memory buffers
 * Efficient for already-loaded images
 */
export class PngBufferDecoder implements ImageDecoder {
  private pngHeader: PngHeader | null = null;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  async getHeader(): Promise<ImageHeader> {
    if (this.pngHeader) {
      return pngHeaderToImageHeader(this.pngHeader);
    }

    this.pngHeader = parsePngHeader(this.data);
    return pngHeaderToImageHeader(this.pngHeader);
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    await this.getHeader(); // Ensure header is loaded
    const pngHeader = this.pngHeader!;

    const chunks = parsePngChunks(this.data);
    const idatChunks = chunks.filter((chunk) => chunk.type === 'IDAT');
    if (idatChunks.length === 0) {
      throw new Error('No IDAT chunks found in PNG');
    }

    let totalLength = 0;
    for (const chunk of idatChunks) {
      totalLength += chunk.data.length;
    }

    const compressedData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of idatChunks) {
      compressedData.set(chunk.data, offset);
      offset += chunk.data.length;
    }

    for await (const scanline of decodeScanlinesFromCompressedData(compressedData, pngHeader)) {
      yield scanline;
    }
  }

  async close(): Promise<void> {
    // No resources to clean up for memory-based input
  }
}

/**
 * Decoder plugin for PNG images (files and buffers)
 */
export const pngDecoder: DecoderPlugin = {
  format: 'png',
  async create(input) {
    if (typeof input === 'string') {
      return new PngFileDecoder(input);
    }
    if (input instanceof Uint8Array) {
      return new PngBufferDecoder(input);
    }
    if (input instanceof ArrayBuffer) {
      return new PngBufferDecoder(new Uint8Array(input));
    }
    throw new Error('Unsupported PNG input type for decoder plugin');
  }
};
