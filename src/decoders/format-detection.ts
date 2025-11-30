import type { ImageFormat } from './types.js';

/**
 * Detect image format from byte signature (magic bytes)
 *
 * @param bytes - Image data (at least first 12 bytes needed)
 * @returns Detected image format or 'unknown'
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 4) {
    return 'unknown';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF (Start of Image marker)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // HEIC/HEIF: Check for ftyp box with compatible brands
  // Format: [4 bytes size][4 bytes 'ftyp'][brand][minor version][compatible brands...]
  if (bytes.length >= 12) {
    // Check for 'ftyp' at offset 4
    if (
      bytes[4] === 0x66 && // 'f'
      bytes[5] === 0x74 && // 't'
      bytes[6] === 0x79 && // 'y'
      bytes[7] === 0x70 // 'p'
    ) {
      // Check major brand at offset 8-11
      const majorBrand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);

      // Common HEIC/HEIF brands
      const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

      if (heicBrands.includes(majorBrand)) {
        return 'heic';
      }

      // Check compatible brands (after major brand + minor version)
      // This is a more thorough check for HEIC variants
      if (bytes.length >= 20) {
        for (let i = 16; i < Math.min(bytes.length - 3, 32); i += 4) {
          const brand = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
          if (heicBrands.includes(brand)) {
            return 'heic';
          }
        }
      }
    }
  }

  return 'unknown';
}

/**
 * Read the first N bytes from a file or buffer for format detection
 *
 * @param input - File path, Uint8Array, ArrayBuffer, or Blob
 * @returns Promise resolving to first 32 bytes for format detection
 */
export async function readMagicBytes(input: string | Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  // If already bytes, return first 32
  if (input instanceof Uint8Array) {
    return input.slice(0, 32);
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0, 32));
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const slice = input.slice(0, 32);
    return new Uint8Array(await slice.arrayBuffer());
  }

  // Read from file (Node.js only)
  if (typeof input === 'string') {
    // Check if we're in Node.js environment
    if (typeof process !== 'undefined' && process?.versions?.node) {
      try {
        const fs = await import('node:fs/promises');
        const fileHandle = await fs.open(input, 'r');
        try {
          const buffer = new Uint8Array(32);
          const { bytesRead } = await fileHandle.read(buffer, 0, 32, 0);
          return buffer.slice(0, bytesRead);
        } finally {
          await fileHandle.close();
        }
      } catch (err) {
        throw new Error(`Failed to read file for format detection: ${(err as Error).message}`);
      }
    } else {
      throw new Error('File path input is only supported in Node.js environment');
    }
  }

  throw new Error(`Unsupported input type for format detection`);
}

/**
 * Detect format from various input types
 *
 * @param input - Image source (path, bytes, buffer, or Blob)
 * @returns Promise resolving to detected format
 */
export async function detectFormat(input: string | Uint8Array | ArrayBuffer | Blob): Promise<ImageFormat> {
  const magicBytes = await readMagicBytes(input);
  return detectImageFormat(magicBytes);
}

/**
 * Validate that a format is supported
 *
 * @param format - Format to validate
 * @throws Error if format is unknown or unsupported
 */
export function validateFormat(format: ImageFormat): asserts format is Exclude<ImageFormat, 'unknown'> {
  if (format === 'unknown') {
    throw new Error('Unknown or unsupported image format. Supported formats: PNG, JPEG, HEIC');
  }
}
