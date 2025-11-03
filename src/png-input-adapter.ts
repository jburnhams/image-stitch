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
import type { PngInputSource } from './types.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { unfilterScanline, getBytesPerPixel, FilterType } from './png-filter.js';
import { readUInt32BE, bytesToString, getSamplesPerPixel } from './utils.js';

/**
 * Input caching configuration
 *
 * When enabled, caches decompressed scanlines for Uint8Array inputs to avoid
 * redundant parsing and decompression when the same image is used multiple times.
 *
 * IMPORTANT: Off by default. Enable for:
 * - Tests that reuse the same image data many times
 * - Examples/demos showing tiling or grid layouts
 * - NOT recommended for production unless you know you'll reuse images
 *
 * Memory impact: O(unique_images × image_size_decompressed)
 * Performance gain: Avoids O(reuse_count × parse_time)
 */
interface CacheWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface CachedImageData {
  header?: PngHeader;
  headerPromise?: Promise<PngHeader>;
  scanlines: Uint8Array[];
  completed: boolean;
  producerActive: boolean;
  waiters: CacheWaiter[];
  error?: Error;
}

interface InputCacheConfig {
  enabled: boolean;
  cache: WeakMap<Uint8Array, CachedImageData>;
}

const inputCache: InputCacheConfig = {
  enabled: false,
  cache: new WeakMap()
};

function getOrCreateCacheEntry(data: Uint8Array): CachedImageData {
  let entry = inputCache.cache.get(data);
  if (!entry) {
    entry = {
      scanlines: [],
      completed: false,
      producerActive: false,
      waiters: []
    };
    inputCache.cache.set(data, entry);
  }
  return entry;
}

function notifyCacheWaiters(entry: CachedImageData, error?: Error): void {
  if (entry.waiters.length === 0) {
    return;
  }
  const waiters = entry.waiters.splice(0, entry.waiters.length);
  for (const waiter of waiters) {
    if (error) {
      waiter.reject(error);
    } else {
      waiter.resolve();
    }
  }
}

async function* consumeCachedScanlines(entry: CachedImageData): AsyncGenerator<Uint8Array> {
  let index = 0;

  while (true) {
    if (index < entry.scanlines.length) {
      yield entry.scanlines[index++];
      continue;
    }

    if (entry.completed) {
      if (entry.error) {
        throw entry.error;
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      entry.waiters.push({ resolve, reject });
    });
  }
}

/**
 * Enable input caching for performance optimization
 *
 * Use this when the same Uint8Array images will be reused many times,
 * such as in tests or tiling examples.
 *
 * @example
 * import { enableInputCache } from 'image-stitch';
 * enableInputCache();
 * // ... use same image data multiple times
 * disableInputCache(); // Clean up when done
 */
export function enableInputCache(): void {
  inputCache.enabled = true;
}

/**
 * Disable input caching and clear the cache
 *
 * Call this to free memory when done with cached operations.
 */
export function disableInputCache(): void {
  inputCache.enabled = false;
  clearInputCache();
}

/**
 * Clear the input cache without disabling it
 *
 * Useful to free memory while keeping caching enabled.
 */
export function clearInputCache(): void {
  inputCache.cache = new WeakMap();
}

/**
 * Check if input caching is currently enabled
 */
export function isInputCacheEnabled(): boolean {
  return inputCache.enabled;
}

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
export type PngInput = string | Uint8Array | ArrayBuffer | PngInputAdapter;

async function* decodeScanlinesFromCompressedData(
  compressedData: Uint8Array,
  header: PngHeader
): AsyncGenerator<Uint8Array> {
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const scanlineLength = Math.ceil(
    (header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8
  );
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

    // Check for interlaced PNGs
    if (header.interlaceMethod !== 0) {
      throw new Error('Interlaced PNGs are not currently supported. Please use non-interlaced PNG files.');
    }

    // Open file for streaming
    this.fileHandle = await open(this.filePath, 'r');

    try {
      // Find and read IDAT chunks
      const idatData = await this.extractIdatData();

      const compressedView = new Uint8Array(idatData.buffer, idatData.byteOffset, idatData.byteLength);

      for await (const scanline of decodeScanlinesFromCompressedData(compressedView, header)) {
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
 * Adapter for Uint8Array (in-memory) PNG inputs
 * Efficient for already-loaded images
 *
 * Supports optional caching when enabled via enableInputCache()
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

    if (inputCache.enabled) {
      const entry = getOrCreateCacheEntry(this.data);

      if (entry.header) {
        this.header = entry.header;
        return entry.header;
      }

      if (!entry.headerPromise) {
        entry.headerPromise = Promise.resolve().then(() => parsePngHeader(this.data));
      }

      const header = await entry.headerPromise;
      entry.header = header;
      this.header = header;
      return header;
    }

    this.header = parsePngHeader(this.data);
    return this.header;
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    const header = await this.getHeader();

    // Check for interlaced PNGs
    if (header.interlaceMethod !== 0) {
      throw new Error('Interlaced PNGs are not currently supported. Please use non-interlaced PNG files.');
    }

    if (inputCache.enabled) {
      const entry = getOrCreateCacheEntry(this.data);

      if (entry.error) {
        throw entry.error;
      }

      if (entry.completed || entry.scanlines.length > 0 || entry.producerActive) {
        yield* consumeCachedScanlines(entry);
        return;
      }

      entry.producerActive = true;

      try {
        const chunks = parsePngChunks(this.data);
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

        for await (const scanline of decodeScanlinesFromCompressedData(compressedData, header)) {
          entry.scanlines.push(scanline);
          notifyCacheWaiters(entry);
          yield scanline;
        }

        entry.completed = true;
        entry.producerActive = false;
        notifyCacheWaiters(entry);
      } catch (error) {
        entry.error = error as Error;
        entry.completed = true;
        entry.producerActive = false;
        notifyCacheWaiters(entry, entry.error);
        throw error;
      }

      return;
    }

    const chunks = parsePngChunks(this.data);
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

    for await (const scanline of decodeScanlinesFromCompressedData(compressedData, header)) {
      yield scanline;
    }
  }

  async close(): Promise<void> {
    // No resources to clean up for memory-based input
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

  if (input instanceof ArrayBuffer) {
    return new Uint8ArrayInputAdapter(new Uint8Array(input));
  }

  throw new Error('Unsupported input type. Expected string (file path), Uint8Array, ArrayBuffer, or PngInputAdapter');
}

/**
 * Create multiple adapters from mixed input types
 */
export async function createInputAdapters(inputs: PngInputSource): Promise<PngInputAdapter[]> {
  const adapters: PngInputAdapter[] = [];

  const asyncIterator = (inputs as AsyncIterable<PngInput>)[Symbol.asyncIterator];
  if (typeof asyncIterator === 'function') {
    for await (const input of inputs as AsyncIterable<PngInput>) {
      adapters.push(await createInputAdapter(input));
    }
  } else {
    for (const input of inputs as Iterable<PngInput>) {
      adapters.push(await createInputAdapter(input));
    }
  }

  return adapters;
}
