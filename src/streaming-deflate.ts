/**
 * TRUE Streaming Deflate Compression using pako's onData callback
 *
 * This achieves constant memory usage by:
 * 1. Using pako's onData callback to receive compressed chunks immediately
 * 2. Batching input scanlines to control flush frequency
 * 3. Using Z_SYNC_FLUSH to maintain deflate state across batches
 * 4. NO accumulation of compressed output
 */

import pako from 'pako';

export interface StreamingDeflatorOptions {
  /**
   * Compression level (0-9)
   * Default: 6 (balanced)
   */
  level?: number;

  /**
   * Maximum bytes to accumulate before flushing
   * Default: 10MB
   */
  maxBatchSize?: number;
}

/**
 * True streaming deflate compressor using pako's onData callback
 *
 * Key insight: pako's onData callback receives compressed chunks as they're
 * produced, WITHOUT accumulating them in the result property!
 */
export class StreamingDeflator {
  private deflator: pako.Deflate | null = null;
  private batchBuffer: Uint8Array[] = [];
  private batchSize = 0;
  private readonly maxBatchSize: number;
  private readonly level: pako.DeflateOptions['level'];
  private finished = false;

  constructor(options: StreamingDeflatorOptions = {}) {
    this.level = (options.level ?? 6) as pako.DeflateOptions['level'];
    this.maxBatchSize = options.maxBatchSize ?? 10 * 1024 * 1024; // 10MB
  }

  /**
   * Initialize the deflator with a callback to receive compressed chunks
   * This MUST be called before push()
   */
  initialize(onData: (chunk: Uint8Array) => void): void {
    // Create deflator
    this.deflator = new pako.Deflate({
      level: this.level,
      chunkSize: 64 * 1024 // 64KB internal chunks
    });

    // Override onData method - this is the key to true streaming!
    // pako calls this for each compressed chunk WITHOUT accumulating
    this.deflator.onData = (chunk: Uint8Array) => {
      if (chunk && chunk.length > 0) {
        onData(chunk);
      }
    };

    // Override onEnd to catch compression completion
    this.deflator.onEnd = (status: number) => {
      if (status !== 0) {
        console.warn(`Deflate ended with status: ${status}`);
      }
    };
  }

  /**
   * Push uncompressed data
   * Returns true if batch was flushed
   */
  push(data: Uint8Array): boolean {
    if (!this.deflator) {
      throw new Error('Must call initialize() before push()');
    }
    if (this.finished) {
      throw new Error('Cannot push after finish()');
    }

    this.batchBuffer.push(data);
    this.batchSize += data.length;

    // Flush batch if full
    if (this.batchSize >= this.maxBatchSize) {
      this.flushBatch(false);
      return true;
    }

    return false;
  }

  /**
   * Force flush current batch
   */
  flush(): void {
    if (this.batchSize > 0) {
      this.flushBatch(false);
    }
  }

  /**
   * Finish compression
   * Flushes any remaining data and finalizes the stream
   */
  finish(): void {
    if (!this.deflator) {
      throw new Error('Must call initialize() before finish()');
    }
    if (this.finished) {
      return;
    }

    this.finished = true;

    // Flush remaining data
    if (this.batchSize > 0) {
      this.flushBatch(true);
    } else {
      // Just finalize
      this.deflator.push(new Uint8Array(0), true);
    }

    if (this.deflator.err) {
      throw new Error(`Deflate error: ${this.deflator.msg}`);
    }
  }

  /**
   * Internal: Flush the batch buffer
   */
  private flushBatch(final: boolean): void {
    if (!this.deflator) return;

    // Concatenate batch
    const batchData = new Uint8Array(this.batchSize);
    let offset = 0;
    for (const chunk of this.batchBuffer) {
      batchData.set(chunk, offset);
      offset += chunk.length;
    }

    // Clear batch buffer - critical for memory!
    this.batchBuffer = [];
    this.batchSize = 0;

    // Push to deflator
    // final=false uses Z_SYNC_FLUSH (maintains state, allows incremental output)
    // final=true uses Z_FINISH (completes stream)
    this.deflator.push(batchData, final);

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

  // Initialize with callback that collects chunks
  deflator.initialize((chunk) => {
    outputChunks.push(chunk);
  });

  // Process input data
  for await (const data of dataGenerator) {
    deflator.push(data);

    // Yield any accumulated output
    while (outputChunks.length > 0) {
      yield outputChunks.shift()!;
    }
  }

  // Finish and yield final chunks
  deflator.finish();
  while (outputChunks.length > 0) {
    yield outputChunks.shift()!;
  }
}
