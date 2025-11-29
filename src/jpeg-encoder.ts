/**
 * JPEG Encoder Wrapper
 *
 * Lightweight wrapper around the WASM JPEG encoder that provides:
 * - Single initialization of WASM module
 * - Async generator API returning byte chunks
 * - Handles worker/wasm module loading differences between Node and browser
 * - Streaming encode that yields JPEG marker/data chunks as they're generated
 */

import { init as jpegEncoderInit, StreamingJpegEncoder, WasmColorType } from 'jpeg-encoder-wasm';

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
  // The new package structure has both ESM and CJS builds with proper WASM loading
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // Dynamic imports to avoid bundler issues
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      // Try to load from node_modules using require.resolve
      let wasmPath: string;
      try {
        // Try require.resolve first (works in both CJS and ESM with createRequire)
        wasmPath = require.resolve('jpeg-encoder-wasm/pkg/esm/jpeg_encoder_bg.wasm');
      } catch {
        // Fallback: use cwd-relative path for ESM
        wasmPath = join(process.cwd(), 'node_modules', 'jpeg-encoder-wasm', 'pkg', 'esm', 'jpeg_encoder_bg.wasm');
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
   * Initialize the encoder
   *
   * NOTE: The WASM encoder includes the JPEG header in the first encode_strip() call,
   * so we don't call header_bytes() to avoid duplicate SOI markers.
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

    // Don't yield header_bytes() - the first encode_strip() call includes the header
    this.initialized = true;

    // Return empty generator (no bytes to yield)
    return;
  }

  /**
   * Encode a strip of scanlines (handles 1-8 lines)
   *
   * @param strip - RGBA data for scanlines (width * lines * 4 bytes, lines ≤ 8)
   * @param _lastScanline - Unused (kept for API compatibility)
   * @returns Async generator yielding JPEG data chunks
   *
   * Note: The WASM encoder handles partial strips internally and will pad
   * using edge pixel repetition to avoid white blending artifacts.
   */
  async *encodeStrip(strip: Uint8Array, _lastScanline: Uint8Array | null = null): AsyncGenerator<Uint8Array> {
    if (!this.initialized || !this.encoder) {
      throw new Error('Encoder not initialized. Call header() first.');
    }

    // Pass the strip directly to the WASM encoder
    // It handles partial strips and pads using edge pixel repetition
    const encoded = this.encoder.encode_strip(strip);
    if (encoded.length > 0) {
      yield encoded;
    }
  }

  /**
   * Finalize the encoding and yield any remaining data
   *
   * NOTE: The WASM encoder's finish() method already includes the EOI marker,
   * so we don't call footer_bytes() to avoid duplicate EOI markers.
   */
  async *finish(): AsyncGenerator<Uint8Array> {
    if (!this.initialized || !this.encoder) {
      throw new Error('Encoder not initialized. Call header() first.');
    }

    // Get remaining buffered data (includes EOI marker)
    const finalData = this.encoder.finish();
    if (finalData.length > 0) {
      yield finalData;
    }

    // Don't call footer_bytes() - finish() already includes EOI marker

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
    const scanlineSize = this.width * 4;

    for (let y = 0; y < this.height; y += stripHeight) {
      const remainingLines = Math.min(stripHeight, this.height - y);
      const offset = y * this.width * 4;
      const size = this.width * remainingLines * 4;
      const strip = data.subarray(offset, offset + size);

      // Extract last scanline from this strip for edge pixel repetition
      const lastScanlineOffset = offset + (remainingLines - 1) * scanlineSize;
      const lastScanline = data.subarray(lastScanlineOffset, lastScanlineOffset + scanlineSize);

      for await (const chunk of this.encodeStrip(strip, lastScanline)) {
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
