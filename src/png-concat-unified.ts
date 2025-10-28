import { Readable } from 'node:stream';
import { ConcatOptions } from './types.js';
import { concatPngsStreaming, concatPngsToStream as concatPngsToStreamImpl } from './png-concat-true-streaming.js';

/**
 * Extended options with output format hint
 */
export interface UnifiedConcatOptions extends ConcatOptions {
  /**
   * Return a stream instead of Uint8Array
   * Useful for HTTP responses or piping to files
   */
  stream?: boolean;
}

/**
 * Unified PNG concatenation function using true streaming
 *
 * This function always uses the true streaming implementation which:
 * - Processes images scanline-by-scanline
 * - Minimizes memory usage
 * - Supports both file paths and Uint8Array inputs
 * - Handles variable image dimensions with automatic padding
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
 * const stream = await concatPngs({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 },
 *   stream: true
 * });
 * stream.pipe(res);
 *
 * @example
 * // Mix file paths and Uint8Arrays
 * const result = await concatPngs({
 *   inputs: ['img1.png', pngBuffer],
 *   layout: { rows: 2 }
 * });
 */
export function concatPngs(options: UnifiedConcatOptions & { stream: true }): Promise<Readable>;
export function concatPngs(options: UnifiedConcatOptions): Promise<Uint8Array>;
export function concatPngs(options: UnifiedConcatOptions): Promise<Uint8Array | Readable> {
  return (async () => {
    if (options.stream) {
      // User wants streaming output
      return concatPngsToStreamImpl(options);
    } else {
      // User wants Uint8Array result - collect chunks from stream
      const chunks: Uint8Array[] = [];

      for await (const chunk of concatPngsStreaming(options)) {
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
