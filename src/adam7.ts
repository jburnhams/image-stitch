/**
 * Adam7 Interlacing Support for PNG
 *
 * Implements deinterlacing for PNG images using the Adam7 algorithm.
 * Adam7 divides an image into 7 passes, each containing a subset of pixels.
 */

import { PngHeader } from './types.js';
import { unfilterScanline, getBytesPerPixel, FilterType } from './png-filter.js';
import { getSamplesPerPixel } from './utils.js';

/**
 * Adam7 pass configuration
 * Each pass has different starting pixel coordinates and step sizes
 */
interface Adam7Pass {
  xStart: number;
  yStart: number;
  xStep: number;
  yStep: number;
}

const ADAM7_PASSES: Adam7Pass[] = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8 }, // Pass 1
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8 }, // Pass 2
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8 }, // Pass 3
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4 }, // Pass 4
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4 }, // Pass 5
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2 }, // Pass 6
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2 }, // Pass 7
];

/**
 * Calculate dimensions of a specific Adam7 pass
 */
function getPassDimensions(width: number, height: number, pass: Adam7Pass): { width: number; height: number } {
  const passWidth = Math.ceil((width - pass.xStart) / pass.xStep);
  const passHeight = Math.ceil((height - pass.yStart) / pass.yStep);
  return {
    width: Math.max(0, passWidth),
    height: Math.max(0, passHeight)
  };
}

/**
 * Deinterlace Adam7-interlaced PNG data
 *
 * @param decompressed Decompressed IDAT data containing all passes
 * @param header PNG header information
 * @returns Deinterlaced pixel data in row-major order
 */
export function deinterlaceAdam7(decompressed: Uint8Array, header: PngHeader): Uint8Array {
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const samplesPerPixel = getSamplesPerPixel(header.colorType);
  const finalScanlineLength = Math.ceil((header.width * header.bitDepth * samplesPerPixel) / 8);

  // Allocate output buffer for deinterlaced image
  const output = new Uint8Array(header.height * finalScanlineLength);

  let srcOffset = 0;

  // Process each Adam7 pass
  for (let passIndex = 0; passIndex < 7; passIndex++) {
    const pass = ADAM7_PASSES[passIndex];
    const passDims = getPassDimensions(header.width, header.height, pass);

    // Skip empty passes (can happen with small images)
    if (passDims.width === 0 || passDims.height === 0) {
      continue;
    }

    // Calculate scanline length for this pass
    const passScanlineLength = Math.ceil((passDims.width * header.bitDepth * samplesPerPixel) / 8);

    let previousLine: Uint8Array | null = null;

    // Process each scanline in this pass
    for (let passY = 0; passY < passDims.height; passY++) {
      if (srcOffset >= decompressed.length) {
        throw new Error(`Unexpected end of decompressed data at pass ${passIndex + 1}, line ${passY}`);
      }

      // Read filter type
      const filterType = decompressed[srcOffset++] as FilterType;

      // Extract filtered scanline
      const filteredLine = decompressed.slice(srcOffset, srcOffset + passScanlineLength);
      srcOffset += passScanlineLength;

      // Unfilter the scanline
      const unfilteredLine = unfilterScanline(filterType, filteredLine, previousLine, bytesPerPixel);
      previousLine = unfilteredLine;

      // Calculate actual Y coordinate in final image
      const finalY = pass.yStart + passY * pass.yStep;

      // Distribute pixels from this scanline to final image
      distributePassPixels(
        unfilteredLine,
        output,
        header,
        finalY,
        pass,
        passDims.width
      );
    }
  }

  return output;
}

/**
 * Distribute pixels from an Adam7 pass scanline to the final image
 */
function distributePassPixels(
  passScanline: Uint8Array,
  output: Uint8Array,
  header: PngHeader,
  y: number,
  pass: Adam7Pass,
  passWidth: number
): void {
  const samplesPerPixel = getSamplesPerPixel(header.colorType);
  const finalScanlineLength = Math.ceil((header.width * header.bitDepth * samplesPerPixel) / 8);
  const outputLineStart = y * finalScanlineLength;

  // Handle sub-byte bit depths (1, 2, 4 bits per pixel)
  if (header.bitDepth < 8) {
    distributeSubBytePixels(
      passScanline,
      output,
      outputLineStart,
      pass,
      passWidth,
      header.bitDepth
    );
  } else {
    // Handle byte-aligned pixels (8, 16 bits per sample)
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);

    for (let passX = 0; passX < passWidth; passX++) {
      const finalX = pass.xStart + passX * pass.xStep;

      // Copy pixel bytes
      const srcPixelOffset = passX * bytesPerPixel;
      const dstPixelOffset = outputLineStart + finalX * bytesPerPixel;

      for (let b = 0; b < bytesPerPixel; b++) {
        output[dstPixelOffset + b] = passScanline[srcPixelOffset + b];
      }
    }
  }
}

/**
 * Distribute sub-byte pixels (1, 2, or 4 bits per pixel)
 */
function distributeSubBytePixels(
  passScanline: Uint8Array,
  output: Uint8Array,
  outputLineStart: number,
  pass: Adam7Pass,
  passWidth: number,
  bitDepth: number
): void {
  const pixelsPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;

  for (let passX = 0; passX < passWidth; passX++) {
    const finalX = pass.xStart + passX * pass.xStep;

    // Extract pixel value from pass scanline
    const passByteIndex = Math.floor(passX / pixelsPerByte);
    const passBitOffset = (pixelsPerByte - 1 - (passX % pixelsPerByte)) * bitDepth;
    const pixelValue = (passScanline[passByteIndex] >> passBitOffset) & mask;

    // Write pixel value to output
    const finalByteIndex = outputLineStart + Math.floor(finalX / pixelsPerByte);
    const finalBitOffset = (pixelsPerByte - 1 - (finalX % pixelsPerByte)) * bitDepth;

    // Clear the bits and set the new value
    output[finalByteIndex] = (output[finalByteIndex] & ~(mask << finalBitOffset)) | (pixelValue << finalBitOffset);
  }
}

/**
 * Check if an image has any non-empty Adam7 passes
 * Used for validation
 */
export function hasAdam7Passes(width: number, height: number): boolean {
  for (const pass of ADAM7_PASSES) {
    const dims = getPassDimensions(width, height, pass);
    if (dims.width > 0 && dims.height > 0) {
      return true;
    }
  }
  return false;
}
