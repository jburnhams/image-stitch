import { Readable } from 'node:stream';
import { ConcatOptions, PngHeader } from './types.js';
import { parsePngHeader } from './png-parser.js';

/**
 * Extended options with output format and optimization hints
 */
export interface UnifiedConcatOptions extends ConcatOptions {
  /**
   * Return a stream instead of Uint8Array
   * Useful for HTTP responses or piping to files
   */
  stream?: boolean;

  /**
   * Optimization strategy
   * - 'auto': Automatically choose based on image sizes (default)
   * - 'memory': Prioritize low memory usage (use true streaming)
   * - 'speed': Prioritize speed (load everything)
   */
  optimize?: 'auto' | 'memory' | 'speed';

  /**
   * Memory budget in MB (helps 'auto' mode decide)
   * Default: 100 MB
   */
  maxMemoryMB?: number;
}

/**
 * Detect if we should use true streaming based on image characteristics
 */
function shouldUseTrueStreaming(
  options: UnifiedConcatOptions,
  headers: PngHeader[]
): boolean {
  // Explicit optimization request
  if (options.optimize === 'memory') {
    return true;
  }
  if (options.optimize === 'speed') {
    return false;
  }

  // Auto mode - decide based on memory requirements
  const firstHeader = headers[0];
  const imageWidth = firstHeader.width;
  const imageHeight = firstHeader.height;
  const bytesPerPixel = getBytesPerPixelFromHeader(firstHeader);

  // Calculate layout
  const numImages = options.inputs.length;
  const columns = options.layout.columns ||
                  Math.ceil(numImages / (options.layout.rows || 1));
  const rows = Math.ceil(numImages / columns);

  // Calculate memory requirements
  const inputPixelBytes = imageWidth * imageHeight * bytesPerPixel;
  const totalInputMB = (inputPixelBytes * numImages) / (1024 * 1024);

  const outputWidth = columns * imageWidth;
  const outputHeight = rows * imageHeight;
  const outputPixelBytes = outputWidth * outputHeight * bytesPerPixel;
  const outputMB = outputPixelBytes / (1024 * 1024);

  const totalMemoryMB = totalInputMB + outputMB;

  // Memory budget (default 100 MB)
  const maxMemoryMB = options.maxMemoryMB || 100;

  // Use true streaming if estimated memory exceeds budget
  if (totalMemoryMB > maxMemoryMB) {
    return true;
  }

  // Also use true streaming for very large individual images
  const largeImageThreshold = 2000 * 2000; // 4MP
  const pixelsPerImage = imageWidth * imageHeight;
  if (pixelsPerImage > largeImageThreshold) {
    return true;
  }

  return false;
}

/**
 * Check if all inputs are file paths (required for true streaming)
 */
function allInputsAreFilePaths(inputs: Array<Uint8Array | string>): boolean {
  return inputs.every(input => typeof input === 'string');
}

/**
 * Get bytes per pixel from header
 */
function getBytesPerPixelFromHeader(header: PngHeader): number {
  let samplesPerPixel = 1;
  switch (header.colorType) {
    case 0: samplesPerPixel = 1; break; // Grayscale
    case 2: samplesPerPixel = 3; break; // RGB
    case 3: samplesPerPixel = 1; break; // Palette
    case 4: samplesPerPixel = 2; break; // Grayscale + Alpha
    case 6: samplesPerPixel = 4; break; // RGBA
  }
  return Math.ceil((samplesPerPixel * header.bitDepth) / 8);
}

/**
 * Unified PNG concatenation function
 *
 * Automatically chooses the best implementation based on:
 * - Image sizes
 * - Available memory
 * - Input types
 * - User preferences
 *
 * @example
 * // Simple usage - returns Uint8Array
 * const result = await concatPngs({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 }
 * });
 *
 * @example
 * // Stream output for HTTP responses or large files
 * const stream = concatPngs({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 },
 *   stream: true
 * });
 * stream.pipe(res);
 *
 * @example
 * // Force memory-efficient mode for large images
 * const result = await concatPngs({
 *   inputs: ['huge1.png', 'huge2.png'],
 *   layout: { columns: 2 },
 *   optimize: 'memory'
 * });
 */
export function concatPngs(options: UnifiedConcatOptions & { stream: true }): Promise<Readable>;
export function concatPngs(options: UnifiedConcatOptions): Promise<Uint8Array>;
export function concatPngs(options: UnifiedConcatOptions): Promise<Uint8Array | Readable> {
  return (async () => {
    // Dynamically import fs
    const { openSync, readSync, closeSync } = await import('node:fs');

    // Read headers to make decision
    const headers: PngHeader[] = [];

    for (const input of options.inputs) {
      let data: Uint8Array;

      if (typeof input === 'string') {
        // Just read enough for header (first ~100 bytes)
        const buffer = Buffer.alloc(100);
        const fd = openSync(input, 'r');
        readSync(fd, buffer, 0, 100, 0);
        closeSync(fd);
        data = new Uint8Array(buffer);
      } else {
        data = input;
      }

      headers.push(parsePngHeader(data));
    }

    // Decide which implementation to use
    const useTrueStreaming = shouldUseTrueStreaming(options, headers) &&
                             allInputsAreFilePaths(options.inputs);

    // Return appropriate result
    if (options.stream) {
      // User wants streaming output
      if (useTrueStreaming) {
        const { concatPngsTrueStreamingToStream } = await import('./png-concat-true-streaming.js');
        return concatPngsTrueStreamingToStream(options);
      } else {
        const { concatPngsToStream } = await import('./png-concat-stream.js');
        return concatPngsToStream(options);
      }
    } else {
      // User wants Uint8Array result
      if (useTrueStreaming) {
        // Use true streaming but collect into array
        const { concatPngsTrueStreaming } = await import('./png-concat-true-streaming.js');
        const chunks: Uint8Array[] = [];

        for await (const chunk of concatPngsTrueStreaming(options)) {
          chunks.push(chunk);
        }

        // Combine chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        return result;
      } else {
        // Use regular implementation
        const { PngConcatenator } = await import('./png-concat-legacy.js');
        const concatenator = new PngConcatenator(options);
        return concatenator.concat();
      }
    }
  })();
}

/**
 * Convenience function: concatenate and write to stream
 *
 * @example
 * import { createWriteStream } from 'fs';
 *
 * const stream = await concatPngsToFile({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 }
 * });
 * stream.pipe(createWriteStream('output.png'));
 */
export async function concatPngsToFile(options: ConcatOptions): Promise<Readable> {
  return concatPngs({ ...options, stream: true }) as Promise<Readable>;
}
