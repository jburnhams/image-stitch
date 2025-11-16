/**
 * JPEG Encoder Wrapper
 *
 * Lightweight wrapper around the WASM JPEG encoder that provides:
 * - Single initialization of WASM module
 * - Async generator API returning byte chunks
 * - Handles worker/wasm module loading differences between Node and browser
 * - Streaming encode that yields JPEG marker/data chunks as they're generated
 */

import jpegEncoderInit, { StreamingJpegEncoder, WasmColorType } from 'jpeg-encoder/pkg/jpeg_encoder.js';

let wasmInitialized = false;

/**
 * Initialize the WASM module
 * Handles both Node.js and browser environments
 */
async function initWasm(): Promise<void> {
  if (wasmInitialized) {
    return;
  }

  // In Node.js, we need to load the wasm file manually
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // Dynamic imports to avoid bundler issues
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      // Try to load from node_modules using require.resolve (works in both ESM and CJS)
      let wasmPath: string;
      try {
        // Try require.resolve first (works in CJS and sometimes in ESM)
        wasmPath = require.resolve('jpeg-encoder/pkg/jpeg_encoder_bg.wasm');
      } catch {
        // Fallback: use cwd-relative path
        wasmPath = join(process.cwd(), 'node_modules', 'jpeg-encoder', 'pkg', 'jpeg_encoder_bg.wasm');
      }

      const wasmBuffer = readFileSync(wasmPath);
      await jpegEncoderInit(wasmBuffer);
    } catch (err) {
      // Final fallback: let the module find the wasm itself
      // This works in browser and some Node environments
      await jpegEncoderInit();
    }
  } else {
    // In browser, the module will fetch the wasm automatically
    await jpegEncoderInit();
  }

  wasmInitialized = true;
}

export interface JpegEncoderOptions {
  /** Output image width in pixels */
  width: number;
  /** Output image height in pixels */
  height: number;
  /** JPEG quality (1-100, default: 85) */
  quality?: number;
}

/**
 * Streaming JPEG encoder that yields byte chunks
 *
 * Takes RGBA scanlines (8-bit per channel) and yields JPEG data chunks.
 * Scanlines must be provided in 8-line MCU (Minimum Coded Unit) strips.
 *
 * @example
 * ```ts
 * const encoder = new JpegEncoder({ width: 800, height: 600, quality: 85 });
 *
 * // Yield header
 * for await (const chunk of encoder.header()) {
 *   process.stdout.write(chunk);
 * }
 *
 * // Yield scanline data (in 8-line strips)
 * for (let y = 0; y < 600; y += 8) {
 *   const strip = new Uint8Array(800 * 8 * 4); // width * 8 lines * 4 channels
 *   // ... fill strip with RGBA data ...
 *   for await (const chunk of encoder.encodeStrip(strip)) {
 *     process.stdout.write(chunk);
 *   }
 * }
 *
 * // Yield footer
 * for await (const chunk of encoder.finish()) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export class JpegEncoder {
  private width: number;
  private height: number;
  private quality: number;
  private encoder: StreamingJpegEncoder | null = null;
  private initialized = false;

  constructor(options: JpegEncoderOptions) {
    this.width = options.width;
    this.height = options.height;
    this.quality = options.quality ?? 85;

    // Validate parameters
    if (this.width <= 0 || this.height <= 0) {
      throw new Error(`Invalid dimensions: ${this.width}x${this.height}`);
    }
    if (this.quality < 1 || this.quality > 100) {
      throw new Error(`Invalid quality: ${this.quality} (must be 1-100)`);
    }
  }

  /**
   * Initialize the encoder and yield the JPEG header (SOI + frame headers)
   */
  async *header(): AsyncGenerator<Uint8Array> {
    if (this.initialized) {
      throw new Error('Encoder already initialized');
    }

    await initWasm();

    // Create the encoder instance
    this.encoder = new StreamingJpegEncoder(
      this.width,
      this.height,
      WasmColorType.Rgba,
      this.quality
    );

    // Yield the header bytes (SOI marker and frame headers)
    const headerBytes = StreamingJpegEncoder.header_bytes(
      this.width,
      this.height,
      WasmColorType.Rgba,
      this.quality
    );

    yield headerBytes;
    this.initialized = true;
  }

  /**
   * Encode a strip of scanlines (must be 8 lines for proper MCU alignment)
   *
   * @param strip - RGBA data for 8 scanlines (width * 8 * 4 bytes)
   * @returns Async generator yielding JPEG data chunks
   */
  async *encodeStrip(strip: Uint8Array): AsyncGenerator<Uint8Array> {
    if (!this.initialized || !this.encoder) {
      throw new Error('Encoder not initialized. Call header() first.');
    }

    // The expected strip size is width * 8 lines * 4 channels
    const expectedSize = this.width * 8 * 4;

    // Allow smaller strips for the last partial strip
    if (strip.length !== expectedSize && strip.length < expectedSize) {
      // Pad the strip to the expected size with transparent pixels
      const padded = new Uint8Array(expectedSize);
      padded.set(strip);
      // Fill remaining bytes with white/opaque (255, 255, 255, 255)
      for (let i = strip.length; i < expectedSize; i += 4) {
        padded[i] = 255;     // R
        padded[i + 1] = 255; // G
        padded[i + 2] = 255; // B
        padded[i + 3] = 255; // A
      }
      const encoded = this.encoder.encode_strip(padded);
      if (encoded.length > 0) {
        yield encoded;
      }
    } else {
      const encoded = this.encoder.encode_strip(strip);
      if (encoded.length > 0) {
        yield encoded;
      }
    }
  }

  /**
   * Finalize the encoding and yield the JPEG footer (EOI marker)
   */
  async *finish(): AsyncGenerator<Uint8Array> {
    if (!this.initialized || !this.encoder) {
      throw new Error('Encoder not initialized. Call header() first.');
    }

    // Get any remaining buffered data
    const finalData = this.encoder.finish();
    if (finalData.length > 0) {
      yield finalData;
    }

    // Yield the footer bytes (EOI marker)
    const footerBytes = StreamingJpegEncoder.footer_bytes();
    yield footerBytes;

    // Clean up
    this.encoder.free();
    this.encoder = null;
    this.initialized = false;
  }

  /**
   * Convenience method to encode all data at once
   *
   * @param data - Full RGBA image data (width * height * 4 bytes)
   * @returns Promise resolving to complete JPEG file as Uint8Array
   */
  async encodeToBuffer(data: Uint8Array): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    // Header
    for await (const chunk of this.header()) {
      chunks.push(chunk);
      totalLength += chunk.length;
    }

    // Encode in 8-line strips
    const stripHeight = 8;

    for (let y = 0; y < this.height; y += stripHeight) {
      const remainingLines = Math.min(stripHeight, this.height - y);
      const offset = y * this.width * 4;
      const size = this.width * remainingLines * 4;
      const strip = data.subarray(offset, offset + size);

      for await (const chunk of this.encodeStrip(strip)) {
        chunks.push(chunk);
        totalLength += chunk.length;
      }
    }

    // Footer
    for await (const chunk of this.finish()) {
      chunks.push(chunk);
      totalLength += chunk.length;
    }

    // Combine all chunks
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }
}

/**
 * Convenience function to encode RGBA data to JPEG
 *
 * @param data - RGBA image data (width * height * 4 bytes)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param quality - JPEG quality (1-100, default: 85)
 * @returns Promise resolving to complete JPEG file as Uint8Array
 */
export async function encodeJpeg(
  data: Uint8Array,
  width: number,
  height: number,
  quality = 85
): Promise<Uint8Array> {
  const encoder = new JpegEncoder({ width, height, quality });
  return encoder.encodeToBuffer(data);
}
