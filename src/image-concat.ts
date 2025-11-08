import { Readable } from 'node:stream';
import { ConcatOptions } from './types.js';
import {
  StreamingConcatenator as CoreStreamingConcatenator,
  concat as concatUint8Array,
  concatStreaming as concatStreamingCore
} from './image-concat-core.js';

export class StreamingConcatenator extends CoreStreamingConcatenator {
  toReadableStream(): Readable {
    const generator = this.stream();

    return new Readable({
      async read() {
        try {
          const { value, done } = await generator.next();
          if (done) {
            this.push(null);
          } else {
            this.push(Buffer.from(value));
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      }
    });
  }
}

export { concatStreamingCore as concatStreaming };

export function concatToBuffer(options: ConcatOptions): Promise<Uint8Array> {
  return concatUint8Array(options);
}

export function concatToStream(options: ConcatOptions): Readable {
  const concatenator = new StreamingConcatenator(options);
  return concatenator.toReadableStream();
}

export async function concatToFile(options: ConcatOptions): Promise<Readable> {
  return concatToStream(options);
}

/**
 * @deprecated Use {@link concatToBuffer} instead.
 */
export function concat(options: ConcatOptions): Promise<Uint8Array> {
  return concatToBuffer(options);
}
