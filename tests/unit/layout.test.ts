import { describe, test } from 'node:test';
import assert from 'node:assert';
import { calculateLayout, type GridLayout } from '../../src/image-concat-core.js';

const size = (width: number, height: number) => ({ width, height });

/** [imageIdx, x, y] for every placed cell, in input order */
function positions(layout: GridLayout): Array<[number, number, number]> {
  return layout.cells
    .map((c) => [c.imageIdx, c.x, c.y] as [number, number, number])
    .sort((a, b) => a[0] - b[0]);
}

// 2x2 grid where no row or column has matching sizes:
//   #0 100x10   #1 10x30
//   #2  10x10   #3 100x20
const MIXED = [size(100, 10), size(10, 30), size(10, 10), size(100, 20)];

describe('calculateLayout alignment', () => {
  test('default: rows aligned, columns packed (previous behaviour)', () => {
    const layout = calculateLayout(MIXED, { columns: 2 });

    assert.deepStrictEqual(layout.grid, [
      [0, 1],
      [2, 3],
    ]);
    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 100, 0],
      [2, 0, 30],
      [3, 10, 30],
    ]);
    assert.strictEqual(layout.totalWidth, 110);
    assert.strictEqual(layout.totalHeight, 50);
  });

  test('alignColumns: full grid', () => {
    const layout = calculateLayout(MIXED, { columns: 2, alignColumns: true });

    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 100, 0],
      [2, 0, 30],
      [3, 100, 30],
    ]);
    assert.strictEqual(layout.totalWidth, 200);
    assert.strictEqual(layout.totalHeight, 50);
  });

  test('alignColumns without alignRows: columns stack independently', () => {
    const layout = calculateLayout(MIXED, { columns: 2, alignColumns: true, alignRows: false });

    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 100, 0],
      [2, 0, 10],
      [3, 100, 30],
    ]);
    assert.strictEqual(layout.totalWidth, 200);
    assert.strictEqual(layout.totalHeight, 50);
  });

  test('no alignment: images drop onto whatever is below them, with no overlaps', () => {
    const layout = calculateLayout(MIXED, { columns: 2, alignRows: false });

    // #3 spans x 10..110, so it must clear both #0 (bottom 10) and #1 (bottom 30)
    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 100, 0],
      [2, 0, 10],
      [3, 10, 30],
    ]);
    assert.strictEqual(layout.totalWidth, 110);
    assert.strictEqual(layout.totalHeight, 50);

    for (const a of layout.cells) {
      for (const b of layout.cells) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        assert.ok(!overlap, `#${a.imageIdx} overlaps #${b.imageIdx}`);
      }
    }
  });

  test('alignColumns: a partial last row keeps the shared column widths', () => {
    const layout = calculateLayout([size(10, 10), size(20, 10), size(30, 10)], {
      columns: 2,
      alignColumns: true,
    });

    assert.deepStrictEqual(layout.grid, [
      [0, 1],
      [2, -1],
    ]);
    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 30, 0],
      [2, 0, 10],
    ]);
    assert.strictEqual(layout.totalWidth, 50);
  });
});

describe('calculateLayout grid shapes', () => {
  test('rows: images fill top to bottom, then left to right', () => {
    const layout = calculateLayout([size(10, 10), size(20, 5), size(30, 10)], {
      rows: 2,
      alignColumns: true,
    });

    assert.deepStrictEqual(layout.grid, [
      [0, 2],
      [1, -1],
    ]);
    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 0, 10],
      [2, 20, 0],
    ]);
    assert.strictEqual(layout.totalWidth, 50);
    assert.strictEqual(layout.totalHeight, 15);
  });

  test('width: wraps to a new row when the next image would not fit', () => {
    const layout = calculateLayout([size(100, 10), size(100, 10), size(100, 20), size(50, 10)], {
      width: 250,
    });

    assert.deepStrictEqual(layout.grid, [
      [0, 1],
      [2, 3],
    ]);
    assert.strictEqual(layout.totalWidth, 200);
    assert.strictEqual(layout.totalHeight, 30);
  });

  test('width: alignColumns is ignored for flow layouts', () => {
    const images = [size(100, 10), size(100, 10), size(150, 10), size(50, 10)];
    const layout = calculateLayout(images, { width: 250, alignColumns: true });

    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 100, 0],
      [2, 0, 10],
      [3, 150, 10],
    ]);
  });

  test('width + alignRows false: masonry flow', () => {
    const layout = calculateLayout([size(50, 30), size(50, 10), size(50, 10), size(50, 10)], {
      width: 100,
      alignRows: false,
    });

    assert.deepStrictEqual(positions(layout), [
      [0, 0, 0],
      [1, 50, 0],
      [2, 0, 30],
      [3, 50, 10],
    ]);
    assert.strictEqual(layout.totalHeight, 40);
  });

  test('width: an image wider than the limit still gets its own row', () => {
    const layout = calculateLayout([size(400, 10), size(10, 10)], { width: 100 });

    assert.deepStrictEqual(layout.grid, [[0], [1]]);
    assert.strictEqual(layout.totalWidth, 400);
  });

  test('width + rows: stops after the row limit and reports dropped inputs', () => {
    const images = Array.from({ length: 6 }, () => size(100, 10));
    const layout = calculateLayout(images, { width: 250, rows: 2 });

    assert.deepStrictEqual(layout.grid, [
      [0, 1],
      [2, 3],
    ]);
    assert.deepStrictEqual(layout.dropped, [4, 5]);
    assert.strictEqual(layout.totalHeight, 20);
  });

  test('width + height: stops before a row that would exceed the height', () => {
    const images = Array.from({ length: 6 }, () => size(100, 10));
    const layout = calculateLayout(images, { width: 200, height: 25 });

    assert.deepStrictEqual(layout.grid, [
      [0, 1],
      [2, 3],
    ]);
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
