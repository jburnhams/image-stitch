/**
 * Decoder Factory
 *
 * Auto-detects image format and creates appropriate decoder instance.
 * Supports PNG, JPEG, and HEIC formats with automatic fallback strategies.
 */

import type { ImageDecoder, ImageInput, DecoderOptions } from './types.js';
import { detectFormat, validateFormat } from './format-detection.js';
import { PngFileDecoder, PngBufferDecoder } from './png-decoder.js';
import { JpegFileDecoder, JpegBufferDecoder } from './jpeg-decoder.js';
import { HeicFileDecoder, HeicBufferDecoder } from './heic-decoder.js';

/**
 * Create appropriate decoder for any image input
 *
 * Automatically detects image format and creates the correct decoder type.
 * Supports mixed input types: file paths, buffers, or existing decoder instances.
 *
 * @param input - Image source (file path, Uint8Array, ArrayBuffer, or existing decoder)
 * @param options - Format-specific decoder options
 * @returns Promise resolving to appropriate decoder instance
 *
 * @example
 * // Auto-detect from file
 * const decoder = await createDecoder('photo.jpg');
 *
 * // Auto-detect from buffer
 * const decoder = await createDecoder(imageBytes);
 *
 * // With options
 * const decoder = await createDecoder('photo.heic', {
 *   heic: { useNativeIfAvailable: true }
 * });
 */
export async function createDecoder(input: ImageInput, options: DecoderOptions = {}): Promise<ImageDecoder> {
  // If already a decoder, return as-is
  if (
    typeof input === 'object' &&
    input !== null &&
    'getHeader' in input &&
    'scanlines' in input &&
    'close' in input
  ) {
    return input as ImageDecoder;
  }

  // For file paths
  if (typeof input === 'string') {
    const format = await detectFormat(input);
    validateFormat(format);

    switch (format) {
      case 'png':
        return new PngFileDecoder(input);
      case 'jpeg':
        return new JpegFileDecoder(input, options.jpeg);
      case 'heic':
        return new HeicFileDecoder(input, options.heic);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  // For ArrayBuffer, convert to Uint8Array
  if (input instanceof ArrayBuffer) {
    input = new Uint8Array(input);
  }

  // For Uint8Array
  if (input instanceof Uint8Array) {
    // Detect format from magic bytes
    const magicBytes = input.slice(0, 32);
    const format = await detectFormat(magicBytes);
    validateFormat(format);

    switch (format) {
      case 'png':
        return new PngBufferDecoder(input);
      case 'jpeg':
        return new JpegBufferDecoder(input, options.jpeg);
      case 'heic':
        return new HeicBufferDecoder(input, options.heic);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  throw new Error(
    'Unsupported input type. Expected string (file path), Uint8Array, ArrayBuffer, or ImageDecoder instance'
  );
}

/**
 * Create multiple decoders from an array of inputs
 *
 * Processes inputs in parallel for better performance.
 *
 * @param inputs - Array of image sources
 * @param options - Format-specific decoder options
 * @returns Promise resolving to array of decoders
 *
 * @example
 * const decoders = await createDecoders([
 *   'photo1.jpg',
 *   'photo2.png',
 *   heicBytes
 * ]);
 */
export async function createDecoders(inputs: ImageInput[], options: DecoderOptions = {}): Promise<ImageDecoder[]> {
  // Create all decoders in parallel
  return Promise.all(inputs.map((input) => createDecoder(input, options)));
}

/**
 * Create decoders from async iterable inputs
 *
 * Useful for streaming inputs or when inputs are generated on-demand.
 *
 * @param inputs - Async iterable of image sources
 * @param options - Format-specific decoder options
 * @returns Promise resolving to array of decoders
 *
 * @example
 * async function* generateInputs() {
 *   yield 'photo1.jpg';
 *   yield await fetchImageBytes();
 *   yield 'photo3.png';
 * }
 *
 * const decoders = await createDecodersFromAsyncIterable(generateInputs());
 */
export async function createDecodersFromAsyncIterable(
  inputs: AsyncIterable<ImageInput>,
  options: DecoderOptions = {}
): Promise<ImageDecoder[]> {
  const decoders: ImageDecoder[] = [];

  for await (const input of inputs) {
    decoders.push(await createDecoder(input, options));
  }

  return decoders;
}

/**
 * Create decoders from mixed iterable/async iterable inputs
 *
 * Automatically detects whether the input is synchronous or asynchronous.
 *
 * @param inputs - Iterable or async iterable of image sources
 * @param options - Format-specific decoder options
 * @returns Promise resolving to array of decoders
 */
export async function createDecodersFromIterable(
  inputs: Iterable<ImageInput> | AsyncIterable<ImageInput>,
  options: DecoderOptions = {}
): Promise<ImageDecoder[]> {
  // Check if async iterable
  const asyncIterator = (inputs as AsyncIterable<ImageInput>)[Symbol.asyncIterator];
  if (typeof asyncIterator === 'function') {
    return createDecodersFromAsyncIterable(inputs as AsyncIterable<ImageInput>, options);
  }

  // Synchronous iterable
  const inputArray = Array.from(inputs as Iterable<ImageInput>);
  return createDecoders(inputArray, options);
}
