/**
 * Image Decoders
 *
 * Multi-format image decoder system supporting PNG, JPEG, and HEIC.
 * Provides a unified interface for streaming image data regardless of source format.
 */

import { setDefaultDecoderPlugins } from './plugin-registry.js';
import { pngDecoder } from './png-decoder.js';
import { jpegDecoder } from './jpeg-decoder.js';
import { heicDecoder } from './heic-decoder.js';

// Register comprehensive defaults when consumers import the decoders bundle.
setDefaultDecoderPlugins([pngDecoder, jpegDecoder, heicDecoder]);

// Core types
export type { ImageDecoder, ImageHeader, ImageFormat, ImageInput, PositionedImage, DecoderOptions, JpegDecoderOptions, HeicDecoderOptions, DecoderPlugin } from './types.js';

// Format detection
export { detectImageFormat, detectFormat, readMagicBytes, validateFormat } from './format-detection.js';

// PNG decoders
export { PngFileDecoder, PngBufferDecoder, pngDecoder } from './png-decoder.js';

// JPEG decoders
export { JpegFileDecoder, JpegBufferDecoder, jpegDecoder } from './jpeg-decoder.js';

// HEIC decoders
export { HeicFileDecoder, HeicBufferDecoder, heicDecoder } from './heic-decoder.js';

// Factory functions (main API)
export { createDecoder, createDecoders, createDecodersFromAsyncIterable, createDecodersFromIterable } from './decoder-factory.js';
