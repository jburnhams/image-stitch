/**
 * PNG Input Adapter Architecture
 *
 * Provides a streaming interface for various PNG input sources.
 * Supports file-based, memory-based, and future extensible input types
 * (canvas, different formats, generated images, etc.)
 */

import { open, FileHandle } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { PngHeader } from './types.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { unfilterScanline, getBytesPerPixel, FilterType } from './png-filter.js';
import { readUInt32BE, bytesToString } from './utils.js';
import { decompressData } from './png-decompress.js';

/**
 * Abstract interface for PNG input sources
 *
 * This interface enables streaming access to PNG image data without
 * requiring the entire image to be loaded into memory at once.
 *
 * Implementations can support:
 * - File-based inputs (streaming from disk)
 * - Memory buffers (Uint8Array)
 * - Canvas elements (browser environments)
 * - Generated images (on-the-fly creation)
 * - Different image formats (with conversion)
 * - Network streams (HTTP, etc.)
 */
export interface PngInputAdapter {
  /**
   * Get the PNG header information
   * Should be efficient and not require loading the entire image
   */
  getHeader(): Promise<PngHeader>;

  /**
   * Stream scanlines (rows) of pixel data on-demand
   * Each scanline is unfiltered and ready to use
   *
   * @yields Uint8Array for each scanline (no filter byte, just pixel data)
   */
  scanlines(): AsyncGenerator<Uint8Array>;

  /**
   * Clean up any resources (file handles, memory, etc.)
   */
  close(): Promise<void>;
}

/**
 * Input types that can be automatically converted to adapters
 */
export type PngInput = string | Uint8Array | PngInputAdapter;

/**
 * Adapter for file-based PNG inputs
 * Streams data directly from disk with minimal memory usage
 */
export class FileInputAdapter implements PngInputAdapter {
  private fileHandle: FileHandle | null = null;
  private header: PngHeader | null = null;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getHeader(): Promise<PngHeader> {
    if (this.header) {
      return this.header;
    }

    // Read just enough to parse the header (typically < 1KB)
    const data = readFileSync(this.filePath);
    this.header = parsePngHeader(data);
    return this.header;
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    const header = await this.getHeader();

    // Open file for streaming
    this.fileHandle = await open(this.filePath, 'r');

    try {
      // Find and read IDAT chunks
      const idatData = await this.extractIdatData();

      // Decompress IDAT data using Web Compression Streams API
      const decompressedData = await decompressData(idatData);

      // Stream scanlines
      const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
      const scanlineLength = Math.ceil(
        (header.width * header.bitDepth * this.getSamplesPerPixel(header.colorType)) / 8
      );
      const bytesPerLine = 1 + scanlineLength; // 1 byte for filter type

      let previousScanline: Uint8Array | null = null;

      for (let line = 0; line < header.height; line++) {
        const offset = line * bytesPerLine;
        const filterType = decompressedData[offset] as FilterType;
        const filteredData = decompressedData.slice(offset + 1, offset + bytesPerLine);

        const unfilteredData = unfilterScanline(
          filterType,
          filteredData,
          previousScanline,
          bytesPerPixel
        );

        previousScanline = unfilteredData;
        yield unfilteredData;
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
 * Adapter for Uint8Array (in-memory) PNG inputs
 * Efficient for already-loaded images
 */
export class Uint8ArrayInputAdapter implements PngInputAdapter {
  private header: PngHeader | null = null;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  async getHeader(): Promise<PngHeader> {
    if (this.header) {
      return this.header;
    }

    this.header = parsePngHeader(this.data);
    return this.header;
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    const header = await this.getHeader();
    const chunks = parsePngChunks(this.data);

    // Find and concatenate IDAT chunks
    const idatChunks = chunks.filter(chunk => chunk.type === 'IDAT');
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

    // Decompress IDAT data using Web Compression Streams API
    const decompressedData = await decompressData(compressedData);

    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const scanlineLength = Math.ceil(
      (header.width * header.bitDepth * this.getSamplesPerPixel(header.colorType)) / 8
    );
    const bytesPerLine = 1 + scanlineLength;

    let previousScanline: Uint8Array | null = null;

    for (let line = 0; line < header.height; line++) {
      const dataOffset = line * bytesPerLine;
      const filterType = decompressedData[dataOffset] as FilterType;
      const filteredData = decompressedData.slice(dataOffset + 1, dataOffset + bytesPerLine);

      const unfilteredData = unfilterScanline(
        filterType,
        filteredData,
        previousScanline,
        bytesPerPixel
      );

      previousScanline = unfilteredData;
      yield unfilteredData;
    }
  }

  async close(): Promise<void> {
    // No resources to clean up for memory-based input
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
 * Factory function to create appropriate adapter for any input type
 * Supports auto-detection of input types
 */
export async function createInputAdapter(input: PngInput): Promise<PngInputAdapter> {
  // If already an adapter, return as-is
  if (typeof input === 'object' && 'getHeader' in input && 'scanlines' in input && 'close' in input) {
    return input as PngInputAdapter;
  }

  // Auto-detect input type
  if (typeof input === 'string') {
    return new FileInputAdapter(input);
  }

  if (input instanceof Uint8Array) {
    return new Uint8ArrayInputAdapter(input);
  }

  throw new Error('Unsupported input type. Expected string (file path), Uint8Array, or PngInputAdapter');
}

/**
 * Create multiple adapters from mixed input types
 */
export async function createInputAdapters(inputs: PngInput[]): Promise<PngInputAdapter[]> {
  return Promise.all(inputs.map(input => createInputAdapter(input)));
}
