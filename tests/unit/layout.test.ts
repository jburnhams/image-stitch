import { describe, test } from 'node:test';
import assert from 'node:assert';
import { calculateLayout } from '../../src/image-concat-core.js';

const size = (width: number, height: number) => ({ width, height });

describe('calculateLayout', () => {
  test('columns: column widths and row heights are shared across the grid', () => {
    const layout = calculateLayout([size(100, 10), size(10, 30), size(10, 10), size(100, 20)], { columns: 2 });

    assert.deepStrictEqual(layout.grid, [[0, 1], [2, 3]]);
    assert.deepStrictEqual(layout.colWidths, [[100, 100], [100, 100]]);
    assert.deepStrictEqual(layout.rowHeights, [30, 20]);
    assert.strictEqual(layout.totalWidth, 200);
    assert.strictEqual(layout.totalHeight, 50);
    assert.deepStrictEqual(layout.dropped, []);
  });

  test('columns: a partial last row keeps the shared column widths', () => {
    const layout = calculateLayout([size(10, 10), size(20, 10), size(30, 10)], { columns: 2 });

    assert.deepStrictEqual(layout.grid, [[0, 1], [2, -1]]);
    assert.deepStrictEqual(layout.colWidths, [[30, 20], [30, 20]]);
    assert.strictEqual(layout.totalWidth, 50);
  });

  test('rows: images fill top to bottom, then left to right', () => {
    const layout = calculateLayout([size(10, 10), size(20, 5), size(30, 10)], { rows: 2 });

    assert.deepStrictEqual(layout.grid, [[0, 2], [1, -1]]);
    assert.deepStrictEqual(layout.colWidths, [[20, 30], [20, 30]]);
    assert.deepStrictEqual(layout.rowHeights, [10, 5]);
    assert.strictEqual(layout.totalWidth, 50);
    assert.strictEqual(layout.totalHeight, 15);
  });

  test('width: wraps to a new row when the next image would not fit', () => {
    const layout = calculateLayout([size(100, 10), size(100, 10), size(100, 20), size(50, 10)], { width: 250 });

    assert.deepStrictEqual(layout.grid, [[0, 1], [2, 3]]);
    assert.deepStrictEqual(layout.colWidths, [[100, 100], [100, 50]]);
    assert.strictEqual(layout.totalWidth, 200);
    assert.strictEqual(layout.totalHeight, 30);
  });

  test('width: an image wider than the limit still gets its own row', () => {
    const layout = calculateLayout([size(400, 10), size(10, 10)], { width: 100 });

    assert.deepStrictEqual(layout.grid, [[0], [1]]);
    assert.strictEqual(layout.totalWidth, 400);
  });

  test('width + rows: stops after the row limit and reports dropped inputs', () => {
    const images = Array.from({ length: 6 }, () => size(100, 10));
    const layout = calculateLayout(images, { width: 250, rows: 2 });

    assert.deepStrictEqual(layout.grid, [[0, 1], [2, 3]]);
    assert.deepStrictEqual(layout.dropped, [4, 5]);
    assert.strictEqual(layout.totalHeight, 20);
  });

  test('width + height: stops before a row that would exceed the height', () => {
    const images = Array.from({ length: 6 }, () => size(100, 10));
    const layout = calculateLayout(images, { width: 200, height: 25 });

    assert.deepStrictEqual(layout.grid, [[0, 1], [2, 3]]);
    assert.deepStrictEqual(layout.dropped, [4, 5]);
  });

  test('height + columns: caps images per row', () => {
    const images = Array.from({ length: 5 }, () => size(10, 10));
    const layout = calculateLayout(images, { columns: 2, height: 100 });

    assert.deepStrictEqual(layout.grid, [[0, 1], [2, 3], [4]]);
    assert.strictEqual(layout.totalWidth, 20);
  });

  test('no layout keys: single row', () => {
    const layout = calculateLayout([size(10, 10), size(20, 20)], {});

    assert.deepStrictEqual(layout.grid, [[0, 1]]);
    assert.strictEqual(layout.totalWidth, 30);
    assert.strictEqual(layout.totalHeight, 20);
  });
});
