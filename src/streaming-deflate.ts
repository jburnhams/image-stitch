/**
 * TRUE Streaming Deflate Compression with native CompressionStream fallback
 *
 * Uses the modern CompressionStream API in supported environments to avoid
 * bundling heavy dependencies. Falls back to pako in Node.js environments
 * lacking native compression streams.
 */

import type { Deflate, DeflateOptions } from 'pako';

type PakoModule = typeof import('pako');

let pakoPromise: Promise<PakoModule> | null = null;
async function loadPako(): Promise<PakoModule> {
  if (!pakoPromise) {
    pakoPromise = import('pako');
  }
  return pakoPromise;
}

export interface StreamingDeflatorOptions {
  /**
   * Compression level (0-9)
   * Default: 6 (balanced)
   */
  level?: number;

  /**
   * Maximum bytes to accumulate before flushing (pako fallback only)
   * Default: 10MB
   */
  maxBatchSize?: number;
}

type OnDataCallback = (chunk: Uint8Array) => void;

/**
 * True streaming deflate compressor that prefers native CompressionStream
 * and falls back to pako when unavailable (older Node.js builds).
 */
export class StreamingDeflator {
  private deflator: Deflate | null = null;
  private pakoModule: PakoModule | null = null;
  private pendingBytes = 0;
  private readonly maxBatchSize: number;
  private readonly level: DeflateOptions['level'];
  private finished = false;
  private readonly useNative: boolean;
  private nativeWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private nativeReadLoop: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private nativeError: Error | null = null;

  constructor(options: StreamingDeflatorOptions = {}) {
    this.level = (options.level ?? 6) as DeflateOptions['level'];
    this.maxBatchSize = options.maxBatchSize ?? 10 * 1024 * 1024; // 10MB
    this.useNative = typeof CompressionStream !== 'undefined';
  }

  /**
   * Initialize the deflator with a callback to receive compressed chunks.
   * This MUST be called before push().
   */
  async initialize(onData: OnDataCallback): Promise<void> {
    if (this.useNative) {
      const compressor = new CompressionStream('deflate');
      this.nativeWriter = compressor.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
      const reader = compressor.readable.getReader();

      this.nativeReadLoop = (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            if (value && value.length > 0) {
              onData(value instanceof Uint8Array ? value : new Uint8Array(value));
            }
          }
        } catch (err) {
          this.nativeError = err instanceof Error ? err : new Error(String(err));
          throw this.nativeError;
        } finally {
          reader.releaseLock();
        }
      })();
      return;
    }

    const pako = await loadPako();
    this.pakoModule = pako;
    this.deflator = new pako.Deflate({
      level: this.level,
      chunkSize: 64 * 1024 // 64KB internal chunks
    });

    this.deflator.onData = (chunk: Uint8Array) => {
      if (chunk && chunk.length > 0) {
        onData(chunk);
      }
    };

    this.deflator.onEnd = (status: number) => {
      if (status !== 0) {
        console.warn(`Deflate ended with status: ${status}`);
      }
    };
  }

  private ensureInitialized(): void {
    if (this.useNative) {
      if (!this.nativeWriter) {
        throw new Error('Must call initialize() before push()');
      }
      if (this.nativeError) {
        throw this.nativeError;
      }
      return;
    }

    if (!this.deflator) {
      throw new Error('Must call initialize() before push()');
    }
  }

  /**
   * Push uncompressed data. Returns true if a flush occurred (pako fallback).
   */
  async push(data: Uint8Array): Promise<boolean> {
    this.ensureInitialized();
    if (this.finished) {
      throw new Error('Cannot push after finish()');
    }

    if (this.useNative) {
      this.pendingBytes += data.length;
      this.writeChain = this.writeChain.then(async () => {
        if (!this.nativeWriter) {
          throw new Error('Native writer not available');
        }
        await this.nativeWriter.write(data);
      }).catch((err) => {
        this.nativeError = err instanceof Error ? err : new Error(String(err));
      });

      await this.writeChain;
      if (this.nativeError) {
        throw this.nativeError;
      }
      return false;
    }

    this.deflator!.push(data, false);
    this.pendingBytes += data.length;

    if (this.pendingBytes >= this.maxBatchSize) {
      await this.flushInternal(false);
      return true;
    }

    return false;
  }

  /**
   * Force flush current batch.
   */
  async flush(): Promise<void> {
    this.ensureInitialized();

    if (this.useNative) {
      await this.writeChain;
      if (this.nativeError) {
        throw this.nativeError;
      }
      return;
    }

    await this.flushInternal(false);
  }

  /**
   * Finish compression, flushing remaining data and finalizing the stream.
   */
  async finish(): Promise<void> {
    this.ensureInitialized();
    if (this.finished) {
      return;
    }

    this.finished = true;

    if (this.useNative) {
      await this.writeChain;
      if (!this.nativeWriter) {
        throw new Error('Native writer not available');
      }
      await this.nativeWriter.close();
      if (this.nativeReadLoop) {
        try {
          await this.nativeReadLoop;
        } catch (err) {
          this.nativeError = err instanceof Error ? err : new Error(String(err));
        }
      }
      if (this.nativeError) {
        throw this.nativeError;
      }
      return;
    }

    if (this.pendingBytes > 0) {
      await this.flushInternal(true);
    } else {
      this.deflator!.push(new Uint8Array(0), true);
    }

    if (this.deflator!.err) {
      throw new Error(`Deflate error: ${this.deflator!.msg}`);
    }
  }

  private async flushInternal(final: boolean): Promise<void> {
    if (!this.deflator || !this.pakoModule) {
      return;
    }
    if (!this.pendingBytes && !final) {
      return;
    }

    const mode: boolean | number = final ? true : this.pakoModule.constants.Z_SYNC_FLUSH;
    this.deflator.push(new Uint8Array(0), mode);
    this.pendingBytes = 0;

    if (this.deflator.err) {
      throw new Error(`Deflate error: ${this.deflator.msg}`);
    }
  }
}

/**
 * Async generator wrapper for convenient streaming
 */
export async function* compressStreaming(
  dataGenerator: AsyncGenerator<Uint8Array>,
  options: StreamingDeflatorOptions = {}
): AsyncGenerator<Uint8Array> {
  const outputChunks: Uint8Array[] = [];
  const deflator = new StreamingDeflator(options);

  await deflator.initialize((chunk) => {
    outputChunks.push(chunk);
  });

  for await (const data of dataGenerator) {
    await deflator.push(data);

    while (outputChunks.length > 0) {
      yield outputChunks.shift()!;
    }
  }

  await deflator.finish();
  while (outputChunks.length > 0) {
    yield outputChunks.shift()!;
  }
}
