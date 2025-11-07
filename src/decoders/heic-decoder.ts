/**
 * HEIC/HEIF Decoder Implementation
 *
 * Supports multiple decoding backends:
 * - Browser: Native support (Safari/iOS) or libheif-js WASM
 * - Node.js: sharp with libheif support or heic-decode WASM
 *
 * Memory strategy: Decode entire image once (HEIC doesn't support scanline streaming),
 * then yield scanlines progressively from the decoded buffer.
 */

import type { ImageDecoder, ImageHeader, HeicDecoderOptions } from './types.js';

/**
 * Check if native HEIC support is available (Safari/iOS)
 */
async function hasNativeHeicSupport(): Promise<boolean> {
  if (typeof createImageBitmap !== 'function') {
    return false;
  }

  try {
    // Try to decode a minimal HEIC image
    // This is a 1x1 black pixel HEIC (base64 encoded)
    const minimalHeic = Uint8Array.from(atob('AAAAGGZyeXBoZWljAAAADGhlYzEAAAANTmF2aWdhdG9yAAAAIm1ldGFoZGxyAAAAAAAAAAAAAAAAAAAAAAAAAAAAIm1ldGFoZGxyAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), c => c.charCodeAt(0));
    const blob = new Blob([minimalHeic], { type: 'image/heic' });
    await createImageBitmap(blob);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode HEIC using native browser support (Safari/iOS)
 */
async function decodeHeicWithNative(data: Uint8Array): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  // Create blob from HEIC data - create a copy to ensure it's an ArrayBuffer
  const buffer = data.slice().buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'image/heic' });

  // Create ImageBitmap
  const imageBitmap = await createImageBitmap(blob);

  try {
    const width = imageBitmap.width;
    const height = imageBitmap.height;

    // Draw to canvas and extract pixels
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return {
      pixels: new Uint8Array(imageData.data),
      width,
      height
    };
  } finally {
    imageBitmap.close();
  }
}

/**
 * Decode HEIC using libheif-js WASM (browser fallback)
 */
async function decodeHeicWithLibheifJs(data: Uint8Array, wasmPath?: string): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  try {
    // Dynamic import to avoid bundling (optional peer dependency)
    // @ts-expect-error - libheif-js is an optional peer dependency
    const libheif = await import('libheif-js');

    // Initialize decoder with optional custom WASM path
    let decoder: any;
    if (wasmPath) {
      decoder = await libheif.HeifDecoder({ locateFile: () => wasmPath });
    } else {
      decoder = await libheif.HeifDecoder();
    }

    // Decode image
    const result = decoder.decode(data);
    if (!result || result.length === 0) {
      throw new Error('Failed to decode HEIC image');
    }

    // Get first image (HEIC can contain multiple images)
    const image = result[0];
    const width = image.get_width();
    const height = image.get_height();

    // Get RGBA data
    const rgbaData = image.display({ data: new Uint8ClampedArray(width * height * 4), width, height });

    return {
      pixels: new Uint8Array(rgbaData.data),
      width,
      height
    };
  } catch (err) {
    if ((err as Error).message?.includes('Cannot find module')) {
      throw new Error('libheif-js module not found. Install with: npm install libheif-js');
    }
    throw err;
  }
}

/**
 * Decode HEIC using sharp (Node.js, requires libheif)
 */
async function decodeHeicWithSharp(data: Uint8Array): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  try {
    // Dynamic import (optional peer dependency)
    // @ts-expect-error - sharp is an optional peer dependency
    const sharp = await import('sharp');

    const result = await sharp.default(data)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    return {
      pixels: new Uint8Array(result.data),
      width: result.info.width,
      height: result.info.height
    };
  } catch (err) {
    const errorMsg = (err as Error).message || '';
    if (errorMsg.includes('Cannot find module')) {
      throw new Error('sharp module not found. Install with: npm install sharp');
    }
    if (errorMsg.includes('heif') || errorMsg.includes('HEIC')) {
      throw new Error('sharp installed without HEIF/HEIC support. Reinstall sharp with libheif support.');
    }
    throw err;
  }
}

/**
 * Decode HEIC using heic-decode WASM (Node.js fallback)
 */
async function decodeHeicWithHeicDecode(data: Uint8Array): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  try {
    // Dynamic import (optional peer dependency)
    // @ts-expect-error - heic-decode is an optional peer dependency
    const heicDecode = await import('heic-decode');

    const result = await heicDecode.decode({ buffer: data.buffer });
    if (!result || result.length === 0) {
      throw new Error('Failed to decode HEIC image');
    }

    // Get first image
    const image = result[0];
    return {
      pixels: new Uint8Array(image.data),
      width: image.width,
      height: image.height
    };
  } catch (err) {
    if ((err as Error).message?.includes('Cannot find module')) {
      throw new Error('heic-decode module not found. Install with: npm install heic-decode');
    }
    throw err;
  }
}

/**
 * Extract basic header info from HEIF container
 * This is a simplified parser - full HEIF parsing is complex
 */
function parseHeicHeader(_data: Uint8Array): { width?: number; height?: number } {
  // HEIF uses ISO Base Media File Format (like MP4)
  // We'd need to parse ftyp -> meta -> iprp boxes to get dimensions
  // For now, return empty and let full decode provide dimensions
  return {};
}

/**
 * Detect environment and choose best HEIC decoder
 */
async function decodeHeic(
  data: Uint8Array,
  options: HeicDecoderOptions = {}
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const isBrowser = typeof window !== 'undefined';
  const isNode = typeof process !== 'undefined' && process?.versions?.node;

  // Browser environment
  if (isBrowser) {
    // Try native support first (Safari/iOS)
    if (options.useNativeIfAvailable !== false) {
      const hasNative = await hasNativeHeicSupport();
      if (hasNative) {
        try {
          return await decodeHeicWithNative(data);
        } catch (err) {
          console.warn('Native HEIC decode failed, trying WASM fallback:', err);
        }
      }
    }

    // Fallback to libheif-js WASM
    return await decodeHeicWithLibheifJs(data, options.wasmPath);
  }

  // Node.js environment
  if (isNode) {
    // Try sharp first (fastest, but requires libheif)
    try {
      return await decodeHeicWithSharp(data);
    } catch (err) {
      console.warn('sharp with HEIC support not available, using heic-decode fallback');
    }

    // Fallback to heic-decode WASM
    return await decodeHeicWithHeicDecode(data);
  }

  throw new Error('Unsupported environment for HEIC decoding');
}

/**
 * Base HEIC decoder class
 */
abstract class BaseHeicDecoder implements ImageDecoder {
  protected data: Uint8Array;
  protected header: ImageHeader | null = null;
  protected decodedPixels: Uint8Array | null = null;
  protected decodedWidth: number = 0;
  protected decodedHeight: number = 0;
  protected options: HeicDecoderOptions;

  constructor(data: Uint8Array, options: HeicDecoderOptions = {}) {
    this.data = data;
    this.options = options;
  }

  async getHeader(): Promise<ImageHeader> {
    if (this.header) {
      return this.header;
    }

    // For HEIC, we need to decode to get accurate dimensions
    // Parse basic header first, but dimensions may not be available
    const basicHeader = parseHeicHeader(this.data);

    // If we can't get dimensions from header, we need to decode
    if (!basicHeader.width || !basicHeader.height) {
      const decoded = await decodeHeic(this.data, this.options);
      this.decodedPixels = decoded.pixels;
      this.decodedWidth = decoded.width;
      this.decodedHeight = decoded.height;

      this.header = {
        width: decoded.width,
        height: decoded.height,
        channels: 4, // HEIC decoded to RGBA
        bitDepth: 8,
        format: 'heic'
      };
    } else {
      this.header = {
        width: basicHeader.width,
        height: basicHeader.height,
        channels: 4, // HEIC typically has alpha
        bitDepth: 8,
        format: 'heic'
      };
    }

    return this.header;
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    const header = await this.getHeader();

    // Decode entire image if not already decoded
    if (!this.decodedPixels) {
      const decoded = await decodeHeic(this.data, this.options);
      this.decodedPixels = decoded.pixels;
      this.decodedWidth = decoded.width;
      this.decodedHeight = decoded.height;
    }

    // Yield scanlines progressively from decoded buffer
    const scanlineSize = header.width * header.channels;
    for (let y = 0; y < header.height; y++) {
      const offset = y * scanlineSize;
      // Create a copy so caller can modify without affecting our buffer
      yield this.decodedPixels.slice(offset, offset + scanlineSize);
    }
  }

  async close(): Promise<void> {
    // Release decoded pixel buffer
    this.decodedPixels = null;
  }
}

/**
 * HEIC decoder for file-based inputs
 */
export class HeicFileDecoder extends BaseHeicDecoder {
  private filePath: string;

  constructor(filePath: string, options: HeicDecoderOptions = {}) {
    super(new Uint8Array(0), options);
    this.filePath = filePath;
  }

  async getHeader(): Promise<ImageHeader> {
    // Load file if not already loaded
    if (this.data.length === 0) {
      await this.loadFile();
    }
    return super.getHeader();
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    // Load file if not already loaded
    if (this.data.length === 0) {
      await this.loadFile();
    }
    yield* super.scanlines();
  }

  private async loadFile(): Promise<void> {
    if (typeof process !== 'undefined' && process?.versions?.node) {
      const fs = await import('node:fs/promises');
      this.data = new Uint8Array(await fs.readFile(this.filePath));
    } else {
      throw new Error('File reading is only supported in Node.js environment');
    }
  }
}

/**
 * HEIC decoder for in-memory buffers
 */
export class HeicBufferDecoder extends BaseHeicDecoder {
  constructor(data: Uint8Array, options: HeicDecoderOptions = {}) {
    super(data, options);
  }
}
