/**
 * Image Decoders
 *
 * Multi-format image decoder system supporting PNG, JPEG, and HEIC.
 * Provides a unified interface for streaming image data regardless of source format.
 */

// Core types
export type { ImageDecoder, ImageHeader, ImageFormat, ImageInput, DecoderOptions, JpegDecoderOptions, HeicDecoderOptions } from './types.js';

// Format detection
export { detectImageFormat, detectFormat, readMagicBytes, validateFormat } from './format-detection.js';

// PNG decoders
export { PngFileDecoder, PngBufferDecoder } from './png-decoder.js';

// JPEG decoders
export { JpegFileDecoder, JpegBufferDecoder } from './jpeg-decoder.js';

// HEIC decoders
export { HeicFileDecoder, HeicBufferDecoder } from './heic-decoder.js';

// Factory functions (main API)
export { createDecoder, createDecoders, createDecodersFromAsyncIterable, createDecodersFromIterable } from './decoder-factory.js';
