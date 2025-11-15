import { test } from 'node:test';
import assert from 'node:assert';
import { StreamingDeflator, compressStreaming } from '../../src/streaming-deflate.js';

const serial = { concurrency: false } as const;

const originalCompressionStream = globalThis.CompressionStream;

function resetCompressionStream(): void {
  if (originalCompressionStream) {
    (globalThis as typeof globalThis & { CompressionStream: typeof originalCompressionStream }).CompressionStream =
      originalCompressionStream;
  } else {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'CompressionStream');
  }
}

test('StreamingDeflator rejects push before initialize', serial, async () => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'CompressionStream');
  const deflator = new StreamingDeflator();
  await assert.rejects(
    () => deflator.push(new Uint8Array([1, 2, 3])),
    /Must call initialize\(\) before push\(\)/
  );
  resetCompressionStream();
});

test('StreamingDeflator fallback compresses data and flushes batches', serial, async () => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'CompressionStream');
  const inputs = [
    Uint8Array.from({ length: 12 }, (_, i) => i + 1)
  ];
  const collected: Uint8Array[] = [];
  const deflator = new StreamingDeflator({ maxBatchSize: 8 });
  await deflator.initialize((chunk) => collected.push(chunk));

  await deflator.push(inputs[0].slice(0, 6));
  assert.strictEqual(collected.length, 0, 'no flush before batch threshold');

  await deflator.push(inputs[0].slice(6));
  assert.ok(collected.length > 0, 'flush occurs once batch threshold exceeded');

  await deflator.flush();
  await deflator.finish();

  await assert.rejects(
    () => deflator.push(new Uint8Array([0])),
    /Cannot push after finish\(\)/
  );

  const pako = await import('pako');
  const total = collected.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of collected) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const inflated = pako.inflate(combined);
  assert.deepStrictEqual(Array.from(inflated), Array.from(inputs[0]));
  resetCompressionStream();
});

test('compressStreaming yields compressed output for async generator', serial, async () => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'CompressionStream');
  async function* generate() {
    yield Uint8Array.of(1, 1, 2, 3, 5, 8);
    yield Uint8Array.of(13, 21, 34, 55, 89);
  }

  const chunks: Uint8Array[] = [];
  for await (const piece of compressStreaming(generate())) {
    chunks.push(piece);
  }

  const pako = await import('pako');
  const combinedLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(combinedLength);
  let joinOffset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, joinOffset);
    joinOffset += chunk.length;
  }

  const inflated = pako.inflate(joined);
  assert.deepStrictEqual(
    Array.from(inflated),
    [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
  );
  resetCompressionStream();
});
