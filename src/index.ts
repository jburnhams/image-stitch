/**
 * PNG Concatenation Library
 *
 * A streaming PNG concatenation library for Node.js and web browsers
 * that works without canvas and can handle large files efficiently.
 */

// Main unified API - use this!
export { concatPngs, concatPngsToFile } from './png-concat-unified.js';
export type { UnifiedConcatOptions } from './png-concat-unified.js';

// Legacy/advanced APIs (kept for backwards compatibility)
export { PngConcatenator } from './png-concat-legacy.js';
export { PngConcatenatorStream } from './png-concat-stream.js';
export { TrueStreamingConcatenator } from './png-concat-true-streaming.js';

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
  extractPixelData
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
  crc32,
  readUInt32BE,
  writeUInt32BE,
  isPngSignature,
  PNG_SIGNATURE
} from './utils.js';
