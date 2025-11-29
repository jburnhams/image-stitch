import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createDecoder } from '../../src/decoders/index.js';
import { createTestPng } from '../utils/image-fixtures.js';
import type { ImageSource } from '../../src/decoders/types.js';

describe('LazyImageDecoder', () => {
  test('LazyImageDecoder returns header without calling factory', async () => {
    let factoryCalled = false;
    const factory = async () => {
      factoryCalled = true;
      return new Uint8Array(0);
    };

    const source: ImageSource = {
      width: 100,
      height: 50,
      factory
    };

    const decoder = await createDecoder(source);
    const header = await decoder.getHeader();

    assert.strictEqual(factoryCalled, false, 'Factory should not be called by getHeader');
    assert.strictEqual(header.width, 100);
    assert.strictEqual(header.height, 50);
    assert.strictEqual(header.channels, 4);
    assert.strictEqual(header.bitDepth, 8);
    assert.strictEqual(header.format, 'unknown');
  });

  test('LazyImageDecoder calls factory and yields scanlines', async () => {
    const width = 10;
    const height = 5;
    const pngBytes = await createTestPng(width, height, new Uint8Array([255, 0, 0, 255]));

    let factoryCalled = false;
    const factory = async () => {
      factoryCalled = true;
      return pngBytes;
    };

    const source: ImageSource = {
      width,
      height,
      factory
    };

    const decoder = await createDecoder(source);

    // Header should still be from source
    const header = await decoder.getHeader();
    assert.strictEqual(header.width, width);
    assert.strictEqual(header.height, height);

    let rows = 0;
    for await (const row of decoder.scanlines()) {
      rows++;
      assert.ok(row instanceof Uint8Array);
      assert.strictEqual(row.length, width * 4);
    }

    assert.strictEqual(factoryCalled, true, 'Factory should be called by scanlines');
    assert.strictEqual(rows, height, 'Should yield correct number of rows');
  });

  test('LazyImageDecoder handles Blob return from factory', async () => {
    if (typeof Blob === 'undefined') {
      // Skip if environment doesn't support Blob (though Node 20 should)
      return;
    }

    const width = 10;
    const height = 10;
    const pngBytes = await createTestPng(width, height, new Uint8Array([0, 255, 0, 255]));

    const factory = async () => {
      return new Blob([pngBytes as any]);
    };

    const source: ImageSource = { width, height, factory };
    const decoder = await createDecoder(source);

    let rows = 0;
    for await (const _ of decoder.scanlines()) {
      rows++;
    }

    assert.strictEqual(rows, height);
  });

  test('LazyImageDecoder calls factory each time scanlines is called', async () => {
    const width = 2;
    const height = 2;
    const pngBytes = await createTestPng(width, height, new Uint8Array([0, 0, 255, 255]));

    let callCount = 0;
    const factory = async () => {
      callCount++;
      return pngBytes;
    };

    const source: ImageSource = { width, height, factory };
    const decoder = await createDecoder(source);

    // First scan
    for await (const _ of decoder.scanlines()) {}
    assert.strictEqual(callCount, 1);

    // Second scan
    for await (const _ of decoder.scanlines()) {}
    assert.strictEqual(callCount, 2);
  });

  test('PositionedImage works with ImageSource', async () => {
    const width = 5;
    const height = 5;
    const pngBytes = await createTestPng(width, height, new Uint8Array([255, 255, 255, 255]));

    const source: ImageSource = {
       width,
       height,
       factory: async () => pngBytes
    };

    // Using PositionedImage structure
    const positioned = {
       x: 0,
       y: 0,
       source
    };

    // createDecoder should handle wrapped PositionedImage
    const decoder = await createDecoder(positioned);
    const header = await decoder.getHeader();
    assert.strictEqual(header.width, width);
    assert.strictEqual(header.height, height);
  });
});
