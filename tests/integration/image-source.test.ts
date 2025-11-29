import { describe, test } from 'node:test';
import assert from 'node:assert';
import { concat } from '../../src/image-concat-core.js';
import { createTestPng } from '../utils/image-fixtures.js';
import type { ImageSource } from '../../src/decoders/types.js';

describe('ImageSource Integration', () => {
  test('concat works with ImageSource input', async () => {
    const width = 10;
    const height = 10;
    const pngBytes = await createTestPng(width, height, new Uint8Array([255, 0, 0, 255]));

    let factoryCalled = false;
    const source: ImageSource = {
      width,
      height,
      factory: async () => {
        factoryCalled = true;
        return pngBytes;
      }
    };

    const result = await concat({
      inputs: [source, source], // Concatenate 2 red squares
      layout: { columns: 2 }
    });

    assert.ok(result.length > 0, 'Should produce output');
    assert.strictEqual(factoryCalled, true, 'Factory should be called');

    // Check if result is a valid PNG (simple signature check)
    assert.strictEqual(result[0], 0x89);
    assert.strictEqual(result[1], 0x50);
    assert.strictEqual(result[2], 0x4E);
    assert.strictEqual(result[3], 0x47);
  });
});
