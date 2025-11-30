/**
 * Decoder Factory
 *
 * Auto-detects image format and creates appropriate decoder instance.
 * Supports PNG, JPEG, and HEIC formats with automatic fallback strategies.
 */

import type { ImageDecoder, ImageInput, DecoderOptions, DecoderPlugin, PositionedImage, ImageSource, ImageHeader } from './types.js';
import { detectFormat, validateFormat } from './format-detection.js';
import { getDefaultDecoderPlugins } from './plugin-registry.js';

/**
 * Type guard to check if input is a PositionedImage
 */
function isPositionedImage(input: ImageInput): input is PositionedImage {
  return (
    typeof input === 'object' &&
    input !== null &&
    'x' in input &&
    'y' in input &&
    'source' in input &&
    typeof (input as PositionedImage).x === 'number' &&
    typeof (input as PositionedImage).y === 'number'
  );
}

/**
 * Type guard to check if input is an ImageSource
 */
function isImageSource(input: any): input is ImageSource {
  return (
    typeof input === 'object' &&
    input !== null &&
    'factory' in input &&
    'width' in input &&
    'height' in input
  );
}

/**
 * Lazy decoder that defers loading/decoding until scanlines are requested
 */
class LazyImageDecoder implements ImageDecoder {
  constructor(
    private source: ImageSource,
    private options: DecoderOptions,
    private plugins: DecoderPlugin[]
  ) {}

  async getHeader(): Promise<ImageHeader> {
    return {
      width: this.source.width,
      height: this.source.height,
      channels: 4, // Default to RGBA
      bitDepth: 8, // Default to 8-bit
      format: 'unknown'
    };
  }

  async *scanlines(): AsyncGenerator<Uint8Array> {
    const data = await this.source.factory();

    let input: Uint8Array | ArrayBuffer;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      input = await data.arrayBuffer();
    } else {
      input = data as Uint8Array | ArrayBuffer;
    }

    // Pass the plugins to the inner decoder to ensure consistency
    const decoder = await createDecoder(input, this.options, this.plugins);
    try {
      yield *decoder.scanlines();
    } finally {
      await decoder.close();
    }
  }

  async close(): Promise<void> {
    // No resources to clean up until scanlines are called (which handles its own cleanup)
  }
}

/**
 * Extract the actual image source from input (unwraps PositionedImage)
 */
function extractSource(input: ImageInput): string | Uint8Array | ArrayBuffer | Blob | ImageDecoder | ImageSource {
  if (isPositionedImage(input)) {
    return input.source;
  }
  return input;
}

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
  // Unwrap PositionedImage to get the actual source
  const source = extractSource(input);

  // If already a decoder, return as-is
  if (
    typeof source === 'object' &&
    source !== null &&
    'getHeader' in source &&
    'scanlines' in source &&
    'close' in source
  ) {
    return source as ImageDecoder;
  }

  const availablePlugins = plugins.length > 0 ? plugins : getDefaultDecoderPlugins();

  // For Lazy ImageSource
  if (isImageSource(source)) {
    return new LazyImageDecoder(source, options, availablePlugins);
  }

  // For file paths
  if (typeof source === 'string') {
    const format = await detectFormat(source);
    validateFormat(format);

    const plugin = availablePlugins.find(candidate => candidate.format === format);
    if (!plugin) {
      throw new Error(
        `No decoder registered for format "${format}". Provide a matching plugin via options.decoders.`
      );
    }

    return plugin.create(source, options);
  }

  // For ArrayBuffer, convert to Uint8Array
  let processedSource = source;
  if (source instanceof ArrayBuffer) {
    processedSource = new Uint8Array(source);
  }

  // For Uint8Array
  if (processedSource instanceof Uint8Array) {
    // Detect format from magic bytes
    const magicBytes = processedSource.slice(0, 32);
    const format = await detectFormat(magicBytes);
    validateFormat(format);

    const plugin = availablePlugins.find(candidate => candidate.format === format);
    if (!plugin) {
      throw new Error(
        `No decoder registered for format "${format}". Provide a matching plugin via options.decoders.`
      );
    }

    return plugin.create(processedSource, options);
  }

  // For Blob
  if (typeof Blob !== 'undefined' && processedSource instanceof Blob) {
    const format = await detectFormat(processedSource);
    validateFormat(format);

    const plugin = availablePlugins.find(candidate => candidate.format === format);
    if (!plugin) {
      throw new Error(
        `No decoder registered for format "${format}". Provide a matching plugin via options.decoders.`
      );
    }

    return plugin.create(processedSource, options);
  }

  throw new Error(
    'Unsupported input type. Expected string (file path), Uint8Array, ArrayBuffer, Blob, ImageDecoder instance, or PositionedImage'
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

/**
 * Check if inputs contain positioned images
 */
export function hasPositionedImages(inputs: ImageInput[]): boolean {
  return inputs.some(isPositionedImage);
}

/**
 * Extract position information from inputs
 * Returns positions for positioned images, or undefined for non-positioned
 */
export function extractPositions(
  inputs: ImageInput[]
): Array<{ x: number; y: number; zIndex?: number } | undefined> {
  return inputs.map(input => {
    if (isPositionedImage(input)) {
      return { x: input.x, y: input.y, zIndex: input.zIndex };
    }
    return undefined;
  });
}

/**
 * Validate that all inputs are positioned or none are
 * Throws if mixing positioned and non-positioned inputs
 */
export function validatePositionedInputs(inputs: ImageInput[]): void {
  const positionedCount = inputs.filter(isPositionedImage).length;

  if (positionedCount > 0 && positionedCount < inputs.length) {
    throw new Error(
      'Cannot mix positioned and non-positioned images. ' +
      'All inputs must be PositionedImage objects or none can be. ' +
      `Found ${positionedCount} positioned and ${inputs.length - positionedCount} non-positioned images.`
    );
  }
}

// Export type guard for external use
export { isPositionedImage };
