import { test } from 'node:test';
import assert from 'node:assert';
import { deinterlaceAdam7, hasAdam7Passes } from '../../src/adam7.js';
import { ColorType, PngHeader } from '../../src/types.js';
import { FilterType } from '../../src/png-filter.js';

const baseHeader: Omit<PngHeader, 'width' | 'height' | 'bitDepth' | 'colorType'> = {
  compressionMethod: 0,
  filterMethod: 0,
  interlaceMethod: 1
};

test('deinterlaceAdam7 reconstructs interlaced RGBA image', () => {
  const header: PngHeader = {
    width: 2,
    height: 2,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    ...baseHeader
  };

  const finalPixels = [
    // Row 0
    10, 20, 30, 40,
    50, 60, 70, 80,
    // Row 1
    90, 100, 110, 120,
    130, 140, 150, 160
  ];

  const decompressed = new Uint8Array([
    // Pass 1 (pixel 0,0)
    FilterType.None,
    10, 20, 30, 40,
    // Pass 6 (pixel 1,0)
    FilterType.None,
    50, 60, 70, 80,
    // Pass 7 (row 1)
    FilterType.None,
    90, 100, 110, 120,
    130, 140, 150, 160
  ]);

  const result = deinterlaceAdam7(decompressed, header);
  assert.deepStrictEqual(Array.from(result), finalPixels);
});

test('deinterlaceAdam7 supports sub-byte bit depths', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 1,
    colorType: ColorType.GRAYSCALE,
    ...baseHeader
  };

  const decompressed = new Uint8Array([
    FilterType.None,
    0b10000000
  ]);

  const result = deinterlaceAdam7(decompressed, header);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], 0b10000000);
});

test('deinterlaceAdam7 throws when data is truncated', () => {
  const header: PngHeader = {
    width: 2,
    height: 2,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    ...baseHeader
  };

  const truncated = new Uint8Array([FilterType.None]);

  assert.throws(() => deinterlaceAdam7(truncated, header), /Unexpected end of decompressed data/);
});

test('hasAdam7Passes detects non-empty passes', () => {
  assert.strictEqual(hasAdam7Passes(2, 2), true);
  assert.strictEqual(hasAdam7Passes(1, 0), false);
});
