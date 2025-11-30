import { test } from 'node:test';
import assert from 'node:assert';

test('Node.js environment supports Blob.stream()', () => {
  if (typeof Blob === 'undefined') {
    assert.fail('Blob is not defined in this environment');
  }

  const blob = new Blob(['test']);
  assert.strictEqual(typeof blob.stream, 'function', 'Blob.stream() should be a function');

  const stream = blob.stream();
  assert.ok(stream, 'blob.stream() should return a stream');
  // Verify it's a ReadableStream (Web Streams API)
  assert.strictEqual(typeof stream.getReader, 'function', 'Stream should have getReader()');
});

test('Node.js environment supports DecompressionStream', () => {
  if (typeof DecompressionStream === 'undefined') {
    assert.fail('DecompressionStream is not defined in this environment');
  }

  const ds = new DecompressionStream('deflate');
  assert.ok(ds, 'Should be able to instantiate DecompressionStream');
  assert.strictEqual(typeof ds.readable, 'object', 'Should have readable property');
  assert.strictEqual(typeof ds.writable, 'object', 'Should have writable property');
});
