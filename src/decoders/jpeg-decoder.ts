/**
 * JPEG Decoder Implementation
 *
 * Supports multiple decoding backends:
 * - Browser: ImageDecoder API (Chrome/Edge/Firefox) or Canvas fallback
 * - Node.js: sharp (optional, fastest) or jpeg-js (pure JS fallback)
 *
 * Memory strategy: Decode entire image once (JPEG doesn't support scanline streaming),
 * then yield scanlines progressively from the decoded buffer.
 */

import type {
  ImageDecoder,
  ImageHeader,
  JpegDecoderOptions,
  DecoderPlugin,
  DecoderOptions,
  CustomConstructors
} from './types.js';
import { isNode } from '../utils.js';

/**
 * JPEG SOF (Start of Frame) marker types
 * Used to extract image dimensions without full decode
 */
const JPEG_SOF_MARKERS = [
  0xc0, // Baseline DCT
  0xc1, // Extended sequential DCT
  0xc2, // Progressive DCT
  0xc3, // Lossless
  0xc5, // Differential sequential DCT
  0xc6, // Differential progressive DCT
  0xc7, // Differential lossless
  0xc9, // Extended sequential DCT (arithmetic)
  0xca, // Progressive DCT (arithmetic)
  0xcb, // Lossless (arithmetic)
  0xcd, // Differential sequential DCT (arithmetic)
  0xce, // Differential progressive DCT (arithmetic)
  0xcf // Differential lossless (arithmetic)
];

/**
 * Extract JPEG header information without full decode
 * Parses SOF marker to get dimensions and channel count
 */
function parseJpegHeader(data: Uint8Array): { width: number; height: number; channels: number } {
  // JPEG must start with SOI marker (0xFF 0xD8)
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error('Invalid JPEG: missing SOI marker');
  }

  let offset = 2;

  // Scan for SOF marker
  while (offset < data.length - 1) {
    // Find next marker (0xFF followed by non-zero byte)
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1];
    offset += 2;

    // Skip padding bytes (0xFF 0xFF)
    if (marker === 0xff || marker === 0x00) {
      continue;
    }

    // Check if this is a SOF marker
    if (JPEG_SOF_MARKERS.includes(marker)) {
      // SOF structure: [length (2)] [precision (1)] [height (2)] [width (2)] [components (1)]
      if (offset + 7 > data.length) {
        throw new Error('Invalid JPEG: truncated SOF marker');
      }

      // Skip length (2 bytes) and precision (1 byte)
      const height = (data[offset + 3] << 8) | data[offset + 4];
      const width = (data[offset + 5] << 8) | data[offset + 6];
      const channels = data[offset + 7];

      return { width, height, channels };
    }

    // Skip this marker's data
    if (offset + 2 > data.length) {
      break;
    }
    const markerLength = (data[offset] << 8) | data[offset + 1];
    offset += markerLength;
  }

  throw new Error('Invalid JPEG: no SOF marker found');
}

/**
 * Check if browser's ImageDecoder API is available (modern browsers)
 */
function hasImageDecoderAPI(): boolean {
  return typeof globalThis.ImageDecoder !== 'undefined';
}

/**
 * Decode JPEG using browser's ImageDecoder API (Chrome/Edge/Firefox 119+)
 */
async function decodeJpegWithImageDecoderAPI(data: Uint8Array): Promise<Uint8Array> {
  const decoder = new globalThis.ImageDecoder({
    data,
    type: 'image/jpeg'
  });

  try {
    const result = await decoder.decode();
    const image = result.image;

    // Extract RGBA data
    const width = image.displayWidth;
    const height = image.displayHeight;
    const pixelData = new Uint8Array(width * height * 4);

    // Use canvas to extract pixel data
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    pixelData.set(imageData.data);

    image.close();
    return pixelData;
  } finally {
    decoder.close();
  }
}

/**
 * Decode JPEG using Canvas API (fallback for browsers)
 */
async function decodeJpegWithCanvas(data: Uint8Array, customConstructors?: CustomConstructors): Promise<Uint8Array> {
  // Resolve constructors
  const ImageCtor = customConstructors?.Image || (typeof Image !== 'undefined' ? Image : null);

  // Try OffscreenCanvas first, then custom Canvas, then HTMLCanvasElement logic if needed
  // Note: customConstructors.Canvas usually expects `new Canvas(width, height)` signature
  let CanvasCtor = customConstructors?.Canvas;
  if (!CanvasCtor && typeof OffscreenCanvas !== 'undefined') {
    CanvasCtor = OffscreenCanvas as any;
  }

  if (!ImageCtor) {
    throw new Error('Image constructor not available for canvas decoding');
  }

  // Create blob from JPEG data - create a copy to ensure it's an ArrayBuffer
  const buffer = data.slice().buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);

  try {
    // Load image
    const img = new ImageCtor();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load JPEG image'));
      img.src = url;
    });

    let canvas: any;
    let ctx: any;

    if (CanvasCtor) {
      canvas = new CanvasCtor(img.width, img.height);
      ctx = canvas.getContext('2d');
    } else if (typeof document !== 'undefined') {
      // Fallback to document.createElement('canvas')
      canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx = canvas.getContext('2d');
    }

    if (!ctx) {
      throw new Error('Failed to get canvas context (no Canvas constructor available)');
    }

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    return new Uint8Array(imageData.data);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode JPEG using sharp (Node.js, fastest option)
 */
async function decodeJpegWithSharp(data: Uint8Array): Promise<Uint8Array> {
  try {
    // Dynamic import (optional peer dependency)
    // @ts-expect-error - sharp is an optional peer dependency
    const sharp = await import('sharp');

    const result = await sharp.default(data)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    return new Uint8Array(result.data);
  } catch (err) {
    if ((err as Error).message?.includes('Cannot find module')) {
      throw new Error('sharp module not found. Install with: npm install sharp');
    }
    throw err;
  }
}

/**
 * Decode JPEG using jpeg-js (pure JavaScript fallback)
 */
async function decodeJpegWithJpegJs(data: Uint8Array): Promise<Uint8Array> {
  try {
    // Dynamic import
    const jpegJs = await import('jpeg-js');

    const decoded = jpegJs.decode(data, { useTArray: true, formatAsRGBA: true });
    return decoded.data;
  } catch (err) {
    if ((err as Error).message?.includes('Cannot find module')) {
      throw new Error('jpeg-js module not found. Install with: npm install jpeg-js');
    }
    throw err;
  }
}

/**
 * Detect environment and choose best JPEG decoder
 */
async function decodeJpeg(data: Uint8Array, options: JpegDecoderOptions = {}): Promise<Uint8Array> {
  // 1. Custom Constructors (Force Browser/Canvas Strategy)
  // This allows JSDOM to use injected node-canvas or similar
  if (options.customConstructors) {
    return await decodeJpegWithCanvas(data, options.customConstructors);
  }

  // 2. Node.js environment (Strict Check)
  // We check this BEFORE browser check to handle JSDOM correctly (which has window but is Node)
  if (isNode()) {
    // Try sharp first (fastest, but optional dependency)
    if (!options.preferWasm) {
      try {
        return await decodeJpegWithSharp(data);
      } catch (err) {
        // Sharp not available, continue to fallback
        // Only warn if we're not in a test environment or if strict mode
      }
    }

    // Fallback to jpeg-js (pure JS, always available)
    return await decodeJpegWithJpegJs(data);
  }

  // 3. Browser environment
  const isBrowser = typeof window !== 'undefined';
  if (isBrowser) {
    // Try ImageDecoder API first (if enabled and available)
    if (options.useImageDecoderAPI !== false && hasImageDecoderAPI()) {
      try {
        return await decodeJpegWithImageDecoderAPI(data);
      } catch (err) {
        console.warn('ImageDecoder API failed, falling back to Canvas:', err);
      }
    }

    // Fallback to Canvas API
    return await decodeJpegWithCanvas(data);
  }

  throw new Error('Unsupported environment for JPEG decoding');
}

/**
 * Base JPEG decoder class
 */
abstract class BaseJpegDecoder implements ImageDecoder {
  protected data: Uint8Array;
  protected header: ImageHeader | null = null;
  protected decodedPixels: Uint8Array | null = null;
  protected options: JpegDecoderOptions;

  constructor(data: Uint8Array, options: JpegDecoderOptions = {}) {
    this.data = data;
    this.options = options;
  }

  async getHeader(): Promise<ImageHeader> {
    if (this.header) {
      return this.header;
    }

    // Quick header parse without full decode
    const jpegHeader = parseJpegHeader(this.data);

    this.header = {
      width: jpegHeader.width,
      height: jpegHeader.height,
      channels: jpegHeader.channels === 1 ? 1 : 4, // Grayscale or RGBA
      bitDepth: 8, // JPEG is always 8-bit per channel
      format: 'jpeg'
    };

    return this.header;
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    const header = await this.getHeader();

    // Decode entire image (JPEG doesn't support scanline streaming)
    if (!this.decodedPixels) {
      this.decodedPixels = await decodeJpeg(this.data, this.options);
    }

    // Yield scanlines progressively from decoded buffer
    const scanlineSize = header.width * header.channels;
    for (let y = 0; y < header.height; y++) {
      const offset = y * scanlineSize;
      // Important: Create a copy so caller can modify without affecting our buffer
      yield this.decodedPixels.slice(offset, offset + scanlineSize);
    }
  }

  async close(): Promise<void> {
    // Release decoded pixel buffer
    this.decodedPixels = null;
  }
}

/**
 * JPEG decoder for file-based inputs
 */
export class JpegFileDecoder extends BaseJpegDecoder {
  private filePath: string;

  constructor(filePath: string, options: JpegDecoderOptions = {}) {
    // We need to load the file first
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
 * JPEG decoder for in-memory buffers
 */
export class JpegBufferDecoder extends BaseJpegDecoder {
  constructor(data: Uint8Array, options: JpegDecoderOptions = {}) {
    super(data, options);
  }
}

/**
 * Decoder plugin for JPEG images
 */
export const jpegDecoder: DecoderPlugin = {
  format: 'jpeg',
  async create(input, options?: DecoderOptions) {
    const jpegOptions: JpegDecoderOptions = {
      ...options?.jpeg,
      customConstructors: options?.customConstructors
    };

    if (typeof input === 'string') {
      return new JpegFileDecoder(input, jpegOptions);
    }
    if (input instanceof Uint8Array) {
      return new JpegBufferDecoder(input, jpegOptions);
    }
    if (input instanceof ArrayBuffer) {
      return new JpegBufferDecoder(new Uint8Array(input), jpegOptions);
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      const buffer = await input.arrayBuffer();
      return new JpegBufferDecoder(new Uint8Array(buffer), jpegOptions);
    }
    throw new Error('Unsupported JPEG input type for decoder plugin');
  }
};
