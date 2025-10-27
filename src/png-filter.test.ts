import { test } from 'node:test';
import assert from 'node:assert';
import {
  unfilterScanline,
  filterScanline,
  getBytesPerPixel,
  FilterType
} from './png-filter.js';
import { ColorType } from './types.js';

test('getBytesPerPixel calculates correct values', () => {
  assert.strictEqual(getBytesPerPixel(8, ColorType.GRAYSCALE), 1);
  assert.strictEqual(getBytesPerPixel(8, ColorType.RGB), 3);
  assert.strictEqual(getBytesPerPixel(8, ColorType.RGBA), 4);
  assert.strictEqual(getBytesPerPixel(8, ColorType.GRAYSCALE_ALPHA), 2);
  assert.strictEqual(getBytesPerPixel(16, ColorType.GRAYSCALE), 2);
  assert.strictEqual(getBytesPerPixel(16, ColorType.RGB), 6);
});

test('unfilterScanline handles None filter', () => {
  const scanline = new Uint8Array([1, 2, 3, 4, 5]);
  const result = unfilterScanline(FilterType.None, scanline, null, 1);
  assert.deepStrictEqual(result, scanline);
});

test('unfilterScanline handles Sub filter', () => {
  const scanline = new Uint8Array([10, 20, 30, 40]);
  const result = unfilterScanline(FilterType.Sub, scanline, null, 2);

  // First pixel: [10, 20] (no left byte, so values stay same)
  // Second pixel byte 0: 30 + result[0] = 30 + 10 = 40
  // Second pixel byte 1: 40 + result[1] = 40 + 20 = 60
  assert.strictEqual(result[0], 10);
  assert.strictEqual(result[1], 20);
  assert.strictEqual(result[2], 40);
  assert.strictEqual(result[3], 60);
});

test('unfilterScanline handles Up filter', () => {
  const scanline = new Uint8Array([5, 10, 15, 20]);
  const previousLine = new Uint8Array([100, 50, 80, 30]);
  const result = unfilterScanline(FilterType.Up, scanline, previousLine, 1);

  assert.strictEqual(result[0], 105); // 5 + 100
  assert.strictEqual(result[1], 60);  // 10 + 50
  assert.strictEqual(result[2], 95);  // 15 + 80
  assert.strictEqual(result[3], 50);  // 20 + 30
});

test('unfilterScanline handles Up filter with no previous line', () => {
  const scanline = new Uint8Array([5, 10, 15, 20]);
  const result = unfilterScanline(FilterType.Up, scanline, null, 1);

  assert.deepStrictEqual(result, scanline);
});

test('unfilterScanline handles Average filter', () => {
  const scanline = new Uint8Array([10, 20]);
  const previousLine = new Uint8Array([50, 30]);
  const result = unfilterScanline(FilterType.Average, scanline, previousLine, 1);

  // First byte: 10 + floor((0 + 50) / 2) = 10 + 25 = 35
  // Second byte: 20 + floor((35 + 30) / 2) = 20 + 32 = 52
  assert.strictEqual(result[0], 35);
  assert.strictEqual(result[1], 52);
});

test('unfilterScanline handles Paeth filter', () => {
  const scanline = new Uint8Array([5, 10]);
  const previousLine = new Uint8Array([100, 50]);
  const result = unfilterScanline(FilterType.Paeth, scanline, previousLine, 1);

  // Implementation would use Paeth predictor
  assert.ok(result instanceof Uint8Array);
  assert.strictEqual(result.length, 2);
});

test('unfilterScanline throws on invalid filter type', () => {
  const scanline = new Uint8Array([1, 2, 3]);
  assert.throws(
    () => unfilterScanline(99 as FilterType, scanline, null, 1),
    /Unknown filter type/
  );
});

test('filterScanline returns valid filter type and data', () => {
  const scanline = new Uint8Array([100, 150, 200, 250]);
  const result = filterScanline(scanline, null, 1);

  assert.ok(result.filterType >= FilterType.None && result.filterType <= FilterType.Paeth);
  assert.ok(result.filtered instanceof Uint8Array);
  assert.strictEqual(result.filtered.length, scanline.length);
});

test('filterScanline can be reversed with unfilterScanline', () => {
  const original = new Uint8Array([100, 150, 200, 250, 50, 75, 125, 175]);
  const previousLine = new Uint8Array([110, 140, 190, 240, 60, 80, 130, 170]);
  const bytesPerPixel = 2;

  const { filterType, filtered } = filterScanline(original, previousLine, bytesPerPixel);
  const unfiltered = unfilterScanline(filterType, filtered, previousLine, bytesPerPixel);

  assert.deepStrictEqual(unfiltered, original);
});

test('filterScanline round-trip without previous line', () => {
  const original = new Uint8Array([50, 100, 150, 200]);
  const bytesPerPixel = 1;

  const { filterType, filtered } = filterScanline(original, null, bytesPerPixel);
  const unfiltered = unfilterScanline(filterType, filtered, null, bytesPerPixel);

  assert.deepStrictEqual(unfiltered, original);
});

test('filterScanline with RGB data', () => {
  const original = new Uint8Array([255, 128, 64, 200, 100, 50, 150, 75, 25]);
  const bytesPerPixel = 3;

  const { filterType, filtered } = filterScanline(original, null, bytesPerPixel);
  const unfiltered = unfilterScanline(filterType, filtered, null, bytesPerPixel);

  assert.deepStrictEqual(unfiltered, original);
});

test('filterScanline with RGBA data and previous line', () => {
  const original = new Uint8Array([255, 255, 255, 255, 128, 128, 128, 255]);
  const previousLine = new Uint8Array([200, 200, 200, 255, 100, 100, 100, 255]);
  const bytesPerPixel = 4;

  const { filterType, filtered } = filterScanline(original, previousLine, bytesPerPixel);
  const unfiltered = unfilterScanline(filterType, filtered, previousLine, bytesPerPixel);

  assert.deepStrictEqual(unfiltered, original);
});

test('getBytesPerPixel throws on invalid color type', () => {
  assert.throws(
    () => getBytesPerPixel(8, 99),
    /Unknown color type/
  );
});
