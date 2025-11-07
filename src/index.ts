/**
 * Multi-Format Image Concatenation Library
 *
 * A streaming image concatenation library for Node.js and web browsers.
 * Supports PNG, JPEG, and HEIC input formats with automatic detection.
 * Works without canvas and handles large files efficiently with minimal memory usage.
 *
 * Key features:
 * - Multi-format input: PNG, JPEG, HEIC
 * - Streaming processing (O(scanline) memory, not O(image))
 * - Browser and Node.js support
 * - No canvas dependency
 * - Automatic format detection
 * - Variable image sizes with padding
 *
 * @example
 * import { concatPngs } from 'image-stitch';
 *
 * // Mix different formats
 * const result = await concatPngs({
 *   inputs: ['photo.jpg', 'image.png', 'pic.heic'],
 *   layout: { columns: 3 }
 * });
 */

// Main API - use this!
export { concatPngs, concatPngsToFile } from './png-concat.js';
export type { UnifiedConcatOptions } from './png-concat.js';

// Multi-format decoder system (NEW - supports PNG, JPEG, HEIC)
export type {
  ImageDecoder,
  ImageHeader,
  ImageFormat,
  ImageInput,
  DecoderOptions,
  JpegDecoderOptions,
  HeicDecoderOptions
} from './decoders/index.js';
export {
  // Factory functions (recommended)
  createDecoder,
  createDecoders,
  createDecodersFromIterable,
  // Format detection
  detectImageFormat,
  detectFormat,
  // Individual decoders (advanced use)
  PngFileDecoder,
  PngBufferDecoder,
  JpegFileDecoder,
  JpegBufferDecoder,
  HeicFileDecoder,
  HeicBufferDecoder
} from './decoders/index.js';

// Streaming implementation
export { StreamingConcatenator } from './png-concat.js';

// Low-level APIs for advanced use
export { parsePngHeader, parsePngChunks, PngParser } from './png-parser.js';
export {
  createChunk,
  createIHDR,
  createIEND,
  serializeChunk,
  buildPng
} from './png-writer.js';
export {
  decompressImageData,
  compressImageData,
  extractPixelData,
  decompressData
} from './png-decompress.js';
export {
  unfilterScanline,
  filterScanline,
  getBytesPerPixel,
  FilterType
} from './png-filter.js';
export {
  copyPixelRegion,
  fillPixelRegion,
  createBlankImage
} from './pixel-ops.js';
export * from './types.js';
export {
  pngCrc32,
  pngCrc32 as crc32,
  readUInt32BE,
  writeUInt32BE,
  isPngSignature,
  PNG_SIGNATURE
} from './utils.js';
