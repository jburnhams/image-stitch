/**
 * Streaming Inflate Decompression with native DecompressionStream fallback
 *
 * Uses the modern DecompressionStream API in supported environments.
 * Falls back to pako in environments lacking native decompression streams (like older Node.js or some JSDOM setups).
 */

import type { Inflate } from 'pako';

type PakoModule = typeof import('pako');

let pakoPromise: Promise<PakoModule> | null = null;
async function loadPako(): Promise<PakoModule> {
  if (!pakoPromise) {
    pakoPromise = import('pako');
  }
  return pakoPromise;
}

/**
 * Create a decompression stream (native or polyfilled via pako)
 */
export function createDecompressionStream(format: 'deflate' | 'gzip' | 'deflate-raw' = 'deflate'): ReadableWritablePair<Uint8Array, BufferSource> {
  if (typeof DecompressionStream !== 'undefined') {
    return new DecompressionStream(format);
  }

  let inflator: Inflate | null = null;

  return new TransformStream({
    async transform(chunk: BufferSource, controller) {
      if (!inflator) {
        const pako = await loadPako();
        const options: any = {};

        if (format === 'deflate-raw') {
          options.raw = true;
        }
        // pako.Inflate autodetects zlib/gzip by default, which covers 'deflate' and 'gzip'

        inflator = new pako.Inflate(options);

        inflator.onData = (data: Uint8Array) => {
          if (data && data.length > 0) {
            controller.enqueue(data);
          }
        };
      }

      if (inflator) {
        let inputData: Uint8Array;
        if (chunk instanceof Uint8Array) {
          inputData = chunk;
        } else if (chunk instanceof ArrayBuffer) {
          inputData = new Uint8Array(chunk);
        } else {
          inputData = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        }

        inflator.push(inputData, false);
        if (inflator.err) {
          throw new Error(`Inflate error: ${inflator.msg}`);
        }
      }
    },

    async flush() {
      if (inflator) {
        inflator.push(new Uint8Array(0), true);
        if (inflator.err) {
          throw new Error(`Inflate error: ${inflator.msg}`);
        }
      }
    }
  });
}
