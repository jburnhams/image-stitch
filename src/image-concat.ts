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

export function concatToStream(options: ConcatOptions): Readable {
  const concatenator = new StreamingConcatenator(options);
  return concatenator.toReadableStream();
}

export interface UnifiedConcatOptions extends ConcatOptions {
  stream?: boolean;
}

export function concat(options: UnifiedConcatOptions & { stream: true }): Promise<Readable>;
export function concat(options: UnifiedConcatOptions): Promise<Uint8Array>;
export function concat(options: UnifiedConcatOptions): Promise<Uint8Array | Readable> {
  return (async () => {
    if (options.stream) {
      return concatToStream(options);
    }

    return concatUint8Array(options);
  })();
}

export async function concatToFile(options: ConcatOptions): Promise<Readable> {
  return concat({ ...options, stream: true }) as Promise<Readable>;
}
