import { PngHeader } from './types.js';
import { getBytesPerPixel } from './png-filter.js';

/**
 * Copy a rectangular region from one image to another
 */
export function copyPixelRegion(
  src: Uint8Array,
  srcHeader: PngHeader,
  dst: Uint8Array,
  dstHeader: PngHeader,
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  width: number,
  height: number
): void {
  const bytesPerPixel = getBytesPerPixel(srcHeader.bitDepth, srcHeader.colorType);
  const srcRowBytes = Math.ceil((srcHeader.width * srcHeader.bitDepth * getSamplesPerPixel(srcHeader.colorType)) / 8);
  const dstRowBytes = Math.ceil((dstHeader.width * dstHeader.bitDepth * getSamplesPerPixel(dstHeader.colorType)) / 8);
  const copyBytes = width * bytesPerPixel;

  for (let y = 0; y < height; y++) {
    const srcOffset = (srcY + y) * srcRowBytes + srcX * bytesPerPixel;
    const dstOffset = (dstY + y) * dstRowBytes + dstX * bytesPerPixel;

    dst.set(src.slice(srcOffset, srcOffset + copyBytes), dstOffset);
  }
}

/**
 * Fill a rectangular region with a solid color
 */
export function fillPixelRegion(
  dst: Uint8Array,
  dstHeader: PngHeader,
  dstX: number,
  dstY: number,
  width: number,
  height: number,
  color: Uint8Array
): void {
  const bytesPerPixel = getBytesPerPixel(dstHeader.bitDepth, dstHeader.colorType);
  const dstRowBytes = Math.ceil((dstHeader.width * dstHeader.bitDepth * getSamplesPerPixel(dstHeader.colorType)) / 8);

  if (color.length !== bytesPerPixel) {
    throw new Error(`Color must have ${bytesPerPixel} bytes`);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dstOffset = (dstY + y) * dstRowBytes + (dstX + x) * bytesPerPixel;
      dst.set(color, dstOffset);
    }
  }
}

/**
 * Create a blank image with all pixels set to a color
 */
export function createBlankImage(
  header: PngHeader,
  backgroundColor: Uint8Array = new Uint8Array([0, 0, 0, 0])
): Uint8Array {
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const rowBytes = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
  const totalBytes = header.height * rowBytes;
  const data = new Uint8Array(totalBytes);

  // Fill with background color
  if (backgroundColor.length !== bytesPerPixel) {
    // Adjust background color to match format
    backgroundColor = backgroundColor.slice(0, bytesPerPixel);
  }

  for (let i = 0; i < totalBytes; i += bytesPerPixel) {
    data.set(backgroundColor, i);
  }

  return data;
}

/**
 * Get number of samples per pixel for a color type
 */
function getSamplesPerPixel(colorType: number): number {
  switch (colorType) {
    case 0: return 1; // Grayscale
    case 2: return 3; // RGB
    case 3: return 1; // Palette
    case 4: return 2; // Grayscale + Alpha
    case 6: return 4; // RGBA
    default: throw new Error(`Unknown color type: ${colorType}`);
  }
}

/**
 * Get transparent color for a given color type and bit depth
 */
export function getTransparentColor(colorType: number, bitDepth: number): Uint8Array {
  const bytesPerSample = bitDepth === 16 ? 2 : 1;

  switch (colorType) {
    case 0: // Grayscale - black
      return new Uint8Array(bytesPerSample).fill(0);
    case 2: // RGB - black
      return new Uint8Array(3 * bytesPerSample).fill(0);
    case 4: // Grayscale + Alpha - transparent black
      if (bitDepth === 16) {
        return new Uint8Array([0, 0, 0, 0]); // 16-bit: gray=0, alpha=0
      }
      return new Uint8Array([0, 0]); // 8-bit: gray=0, alpha=0
    case 6: // RGBA - transparent black
      if (bitDepth === 16) {
        return new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]); // R=0, G=0, B=0, A=0
      }
      return new Uint8Array([0, 0, 0, 0]); // R=0, G=0, B=0, A=0
    default:
      throw new Error(`Unsupported color type: ${colorType}`);
  }
}
