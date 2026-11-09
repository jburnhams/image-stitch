import { Readable } from 'node:stream';
import { ConcatOptions } from './types.js';
import {
  CoreStreamingConcatenator,
  concat as concatUint8Array,
  concatStreaming as concatStreamingCore
} from './image-concat-core.js';

class NodeStreamingConcatenator extends CoreStreamingConcatenator {
  /**
   * Expose the output as a Node.js Readable. Destroying the stream early stops
   * decoding and releases the input decoders.
   */
  toReadableStream(): Readable {
    const generator = this.stream();
    async function* toBuffers(): AsyncGenerator<Buffer> {
      for await (const chunk of generator) {
        yield Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      }
    }
    return Readable.from(toBuffers(), { objectMode: false });
  }
}

export { NodeStreamingConcatenator as StreamingConcatenator };

export { concatStreamingCore as concatStreaming };

export function concatToBuffer(options: ConcatOptions): Promise<Uint8Array> {
  return concatUint8Array(options);
}

export function concatToStream(options: ConcatOptions): Readable {
  const concatenator = new NodeStreamingConcatenator(options);
  return concatenator.toReadableStream();
}

/**
 * Stitch images and write the result to `outputPath`.
 * Output is streamed to disk, so the full image is never held in memory.
 *
 * @returns the path that was written
 *
 * @example
 * await concatToFile({ inputs: ['a.png', 'b.png'], layout: { columns: 2 } }, 'out.png');
 */
export function concatToFile(options: ConcatOptions, outputPath: string): Promise<string>;
/**
 * @deprecated Calling without `outputPath` returns a Readable stream and writes nothing.
 * Use {@link concatToStream} for a stream, or pass `outputPath` to write a file.
 */
export function concatToFile(options: ConcatOptions): Promise<Readable>;
export async function concatToFile(options: ConcatOptions, outputPath?: string): Promise<string | Readable> {
  if (outputPath === undefined) {
    return concatToStream(options);
  }

  const [{ createWriteStream }, { pipeline }] = await Promise.all([
    import('node:fs'),
    import('node:stream/promises')
  ]);
  await pipeline(concatToStream(options), createWriteStream(outputPath));
  return outputPath;
}

/**
 * @deprecated Use {@link concatToBuffer} instead.
 */
export function concat(options: ConcatOptions): Promise<Uint8Array> {
  return concatToBuffer(options);
}
