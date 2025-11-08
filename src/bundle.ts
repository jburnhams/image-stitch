import { setDefaultDecoderPlugins } from './decoders/plugin-registry.js';
import { pngDecoder } from './decoders/png-decoder.js';

setDefaultDecoderPlugins([pngDecoder]);

export { concat, concatStreaming, concatToStream, concatToFile, StreamingConcatenator } from './image-concat.js';
export type { UnifiedConcatOptions } from './image-concat.js';
export type { ConcatOptions } from './types.js';
export { createDecoder, createDecoders, createDecodersFromAsyncIterable, createDecodersFromIterable } from './decoders/decoder-factory.js';
export type { DecoderPlugin, DecoderOptions, ImageInput } from './decoders/types.js';
export { detectFormat, detectImageFormat, readMagicBytes, validateFormat } from './decoders/format-detection.js';
export { pngDecoder } from './decoders/png-decoder.js';
