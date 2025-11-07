/**
 * Test Image Fixture Utilities
 *
 * Creates simple test images in various formats for testing.
 */

import { createIHDR, createIEND, createChunk, buildPng } from '../png-writer.js';
import { compressImageData } from '../png-decompress.js';
import { PngHeader, ColorType } from '../types.js';

/**
 * Create a simple solid-color PNG for testing
 */
export async function createTestPng(
  width: number,
  height: number,
  color: Uint8Array
): Promise<Uint8Array> {
  const header: PngHeader = {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const pixelData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixelData[i * 4] = color[0]; // R
    pixelData[i * 4 + 1] = color[1]; // G
    pixelData[i * 4 + 2] = color[2]; // B
    pixelData[i * 4 + 3] = color[3]; // A
  }

  const compressed = await compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

/**
 * Create a minimal valid JPEG image (100x100 solid color)
 *
 * This creates a very simple baseline JPEG for testing.
 * Uses jpeg-js to encode a simple image.
 */
export async function createTestJpeg(
  width: number,
  height: number,
  color: Uint8Array
): Promise<Uint8Array> {
  try {
    // Dynamic import since jpeg-js is now a dependency
    const jpegJs = await import('jpeg-js');

    // Create RGBA pixel data
    const pixelData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixelData[i * 4] = color[0]; // R
      pixelData[i * 4 + 1] = color[1]; // G
      pixelData[i * 4 + 2] = color[2]; // B
      pixelData[i * 4 + 3] = color[3]; // A
    }

    // Encode to JPEG
    const encoded = jpegJs.encode(
      {
        data: pixelData,
        width,
        height
      },
      90 // quality
    );

    return new Uint8Array(encoded.data);
  } catch (err) {
    throw new Error(`Failed to create test JPEG: ${(err as Error).message}`);
  }
}

/**
 * Create test image bytes with specific magic bytes for format detection testing
 */
export function createMagicBytesTest(format: 'png' | 'jpeg' | 'heic'): Uint8Array {
  switch (format) {
    case 'png':
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)]);

    case 'jpeg':
      // JPEG SOI: FF D8 FF
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(28).fill(0)]);

    case 'heic':
      // HEIC: [size] ftyp heic
      return new Uint8Array([
        0x00, 0x00, 0x00, 0x18, // Box size (24 bytes)
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x68, 0x65, 0x69, 0x63, // 'heic' (major brand)
        0x00, 0x00, 0x00, 0x00, // Minor version
        0x68, 0x65, 0x69, 0x63, // 'heic' (compatible brand)
        ...new Array(8).fill(0)
      ]);

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Create a gradient PNG for more complex testing
 */
export async function createGradientPng(
  width: number,
  height: number
): Promise<Uint8Array> {
  const header: PngHeader = {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const pixelData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Gradient from red to blue
      pixelData[i] = Math.floor((x / width) * 255); // R
      pixelData[i + 1] = 0; // G
      pixelData[i + 2] = Math.floor((y / height) * 255); // B
      pixelData[i + 3] = 255; // A
    }
  }

  const compressed = await compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}
