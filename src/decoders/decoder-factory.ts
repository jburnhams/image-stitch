/**
 * Decoder Factory
 *
 * Auto-detects image format and creates appropriate decoder instance.
 * Supports PNG, JPEG, and HEIC formats with automatic fallback strategies.
 */

import type { ImageDecoder, ImageInput, DecoderOptions, DecoderPlugin } from './types.js';
import { detectFormat, validateFormat } from './format-detection.js';
import { getDefaultDecoderPlugins } from './plugin-registry.js';

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
export async function createDecoder(
  input: ImageInput,
  options: DecoderOptions = {},
  plugins: DecoderPlugin[] = getDefaultDecoderPlugins()
): Promise<ImageDecoder> {
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

  const availablePlugins = plugins.length > 0 ? plugins : getDefaultDecoderPlugins();

  // For file paths
  if (typeof input === 'string') {
    const format = await detectFormat(input);
    validateFormat(format);

    const plugin = availablePlugins.find(candidate => candidate.format === format);
    if (!plugin) {
      throw new Error(
        `No decoder registered for format "${format}". Provide a matching plugin via options.decoders.`
      );
    }

    return plugin.create(input, options);
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

    const plugin = availablePlugins.find(candidate => candidate.format === format);
    if (!plugin) {
      throw new Error(
        `No decoder registered for format "${format}". Provide a matching plugin via options.decoders.`
      );
    }

    return plugin.create(input, options);
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
export async function createDecoders(
  inputs: ImageInput[],
  options: DecoderOptions = {},
  plugins: DecoderPlugin[] = getDefaultDecoderPlugins()
): Promise<ImageDecoder[]> {
  // Create all decoders in parallel
  return Promise.all(inputs.map((input) => createDecoder(input, options, plugins)));
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
  options: DecoderOptions = {},
  plugins: DecoderPlugin[] = getDefaultDecoderPlugins()
): Promise<ImageDecoder[]> {
  const decoders: ImageDecoder[] = [];

  for await (const input of inputs) {
    decoders.push(await createDecoder(input, options, plugins));
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
  options: DecoderOptions = {},
  plugins: DecoderPlugin[] = getDefaultDecoderPlugins()
): Promise<ImageDecoder[]> {
  // Check if async iterable
  const asyncIterator = (inputs as AsyncIterable<ImageInput>)[Symbol.asyncIterator];
  if (typeof asyncIterator === 'function') {
    return createDecodersFromAsyncIterable(inputs as AsyncIterable<ImageInput>, options, plugins);
  }

  // Synchronous iterable
  const inputArray = Array.from(inputs as Iterable<ImageInput>);
  return createDecoders(inputArray, options, plugins);
}
