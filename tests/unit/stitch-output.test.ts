/**
 * End-to-end checks on stitched output, decoded back to pixels.
 * Everything runs in memory so these stay fast enough for the unit suite.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import * as jpegjs from 'jpeg-js';
import '../../src/decoders/index.js';
import {
  concatToBuffer,
  concatToStream,
  concatToFile,
  concatStreaming,
} from '../../src/image-concat.js';
import type { PositionedImage } from '../../src/decoders/types.js';
import { createTestPng } from '../utils/image-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RED = new Uint8Array([255, 0, 0, 255]);
const GREEN = new Uint8Array([0, 255, 0, 255]);
const BLUE = new Uint8Array([0, 0, 255, 255]);
const HALF_WHITE = new Uint8Array([255, 255, 255, 128]);

function decodePng(data: Uint8Array) {
  return PNG.sync.read(Buffer.from(data));
}

function pixelAt(png: { width: number; data: Uint8Array }, x: number, y: number): number[] {
  const i = (y * png.width + x) * 4;
  return Array.from(png.data.subarray(i, i + 4));
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describe('grid output', () => {
  test('alignColumns: mixed sizes line up in columns and pad with the background colour', async () => {
    const wide = await createTestPng(20, 4, RED);
    const small = await createTestPng(4, 4, GREEN);

    const out = await concatToBuffer({
      inputs: [wide, small, small, wide],
      layout: { columns: 2, alignColumns: true },
      backgroundColor: '#0000FF',
    });
    const png = decodePng(out);

    assert.strictEqual(png.width, 40);
    assert.strictEqual(png.height, 8);
    assert.deepStrictEqual(pixelAt(png, 0, 0), [255, 0, 0, 255]);
    assert.deepStrictEqual(pixelAt(png, 20, 0), [0, 255, 0, 255]);
    assert.deepStrictEqual(
      pixelAt(png, 30, 0),
      [0, 0, 255, 255],
      'padding to the right of the small image'
    );
    assert.deepStrictEqual(pixelAt(png, 0, 4), [0, 255, 0, 255]);
    assert.deepStrictEqual(pixelAt(png, 10, 4), [0, 0, 255, 255], 'padding in column 1, row 2');
    assert.deepStrictEqual(
      pixelAt(png, 20, 4),
      [255, 0, 0, 255],
      'column 2 starts at the same x on every row'
    );
  });

  test('default grid packs each row side by side', async () => {
    const wide = await createTestPng(20, 4, RED);
    const small = await createTestPng(4, 4, GREEN);

    const png = decodePng(
      await concatToBuffer({ inputs: [wide, small, small, wide], layout: { columns: 2 } })
    );

    assert.strictEqual(png.width, 24);
    assert.strictEqual(png.height, 8);
    assert.deepStrictEqual(
      pixelAt(png, 4, 4),
      [255, 0, 0, 255],
      'row 2 column 2 starts right after the small image'
    );
  });

  test('alignRows false: short images leave no gap below them', async () => {
    const tall = await createTestPng(4, 8, RED);
    const short = await createTestPng(4, 2, GREEN);
    const blue = await createTestPng(4, 2, BLUE);

    const png = decodePng(
      await concatToBuffer({
        inputs: [tall, short, blue, blue],
        layout: { columns: 2, alignColumns: true, alignRows: false },
      })
    );

    assert.strictEqual(png.width, 8);
    assert.strictEqual(png.height, 10);
    assert.deepStrictEqual(
      pixelAt(png, 4, 2),
      [0, 0, 255, 255],
      'column 2 image 2 sits right under the short image'
    );
    assert.deepStrictEqual(
      pixelAt(png, 0, 8),
      [0, 0, 255, 255],
      'column 1 image 2 sits under the tall image'
    );
    assert.deepStrictEqual(pixelAt(png, 4, 6), [0, 0, 0, 0], 'gap at the bottom of column 2');
  });

  test('flow layout honours a row limit and warns about dropped inputs', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const tile = await createTestPng(10, 10, RED);
    const progress: Array<[number, number]> = [];

    const out = await concatToBuffer({
      inputs: Array.from({ length: 6 }, () => tile),
      layout: { width: 25, rows: 2 },
      onProgress: (done, total) => progress.push([done, total]),
    });
    const png = decodePng(out);

    assert.strictEqual(png.width, 20);
    assert.strictEqual(png.height, 20);
    assert.strictEqual(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /2 of 6 images did not fit/);
    assert.deepStrictEqual(progress.at(-1), [6, 6], 'progress still reaches the total');
  });

  test('inputs can be an async iterable', async () => {
    const tile = await createTestPng(3, 3, BLUE);
    async function* tiles() {
      for (let i = 0; i < 4; i++) {
        yield tile;
      }
    }

    const png = decodePng(await concatToBuffer({ inputs: tiles(), layout: { rows: 2 } }));
    assert.strictEqual(png.width, 6);
    assert.strictEqual(png.height, 6);
  });
});

describe('positioned output', () => {
  test('overlaps blend in z-order and clipped images still report progress', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const base = await createTestPng(10, 10, RED);
    const overlay = await createTestPng(10, 10, HALF_WHITE);
    const progress: Array<[number, number]> = [];

    const inputs: PositionedImage[] = [
      { x: 5, y: 5, zIndex: 2, source: overlay },
      { x: 0, y: 0, zIndex: 1, source: base },
      // Clipped off the bottom-right of the canvas
      { x: 8, y: 8, zIndex: 3, source: base },
      // Entirely outside the canvas
      { x: 100, y: 100, source: base },
    ];

    const out = await concatToBuffer({
      inputs,
      layout: { width: 12, height: 12 },
      onProgress: (done, total) => progress.push([done, total]),
    });
    const png = decodePng(out);

    assert.strictEqual(png.width, 12);
    assert.strictEqual(png.height, 12);
    assert.deepStrictEqual(pixelAt(png, 0, 0), [255, 0, 0, 255]);
    const [r, g, b, a] = pixelAt(png, 6, 6);
    assert.strictEqual(r, 255);
    assert.ok(g > 100 && g < 160, `blended green channel, got ${g}`);
    assert.ok(b > 100 && b < 160, `blended blue channel, got ${b}`);
    assert.strictEqual(a, 255);
    assert.deepStrictEqual(pixelAt(png, 11, 11), [255, 0, 0, 255], 'clipped image drawn on top');
    assert.deepStrictEqual(pixelAt(png, 11, 0), [0, 0, 0, 0], 'transparent background');
    assert.deepStrictEqual(progress.at(-1), [4, 4]);
  });

  test('images clipped off the top-left read from the right source row', async (t) => {
    t.mock.method(console, 'warn', () => {});
    // Gradient-free check: top half red, bottom half green
    const png = new PNG({ width: 4, height: 4 });
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        png.data.set(y < 2 ? RED : GREEN, (y * 4 + x) * 4);
      }
    }
    const source = new Uint8Array(PNG.sync.write(png));

    const out = decodePng(
      await concatToBuffer({ inputs: [{ x: -1, y: -2, source }], layout: { width: 3, height: 2 } })
    );
    assert.deepStrictEqual(pixelAt(out, 0, 0), [0, 255, 0, 255]);
    assert.deepStrictEqual(pixelAt(out, 2, 1), [0, 255, 0, 255]);
  });

  test('canvas size is auto-calculated from image bounds', async () => {
    const tile = await createTestPng(5, 5, BLUE);
    const out = decodePng(
      await concatToBuffer({
        inputs: [
          { x: 0, y: 0, source: tile },
          { x: 10, y: 3, source: tile },
        ],
        layout: {},
      })
    );
    assert.strictEqual(out.width, 15);
    assert.strictEqual(out.height, 8);
  });
});

describe('JPEG output', () => {
  test('grid output decodes to the expected size and colours', async () => {
    const red = await createTestPng(16, 13, RED);
    const green = await createTestPng(16, 13, GREEN);

    const out = await concatToBuffer({
      inputs: [red, green],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 95,
    });
    const img = jpegjs.decode(out, { useTArray: true });

    assert.strictEqual(img.width, 32);
    assert.strictEqual(img.height, 13, 'height that is not a multiple of 8');
    const [r, g] = pixelAt(img, 4, 4);
    assert.ok(r > 200 && g < 60, `left half is red, got ${r},${g}`);
    const [r2, g2] = pixelAt(img, 28, 12);
    assert.ok(r2 < 60 && g2 > 200, `right half is green, got ${r2},${g2}`);
  });

  test('positioned output encodes as JPEG', async () => {
    const tile = await createTestPng(8, 8, BLUE);
    const out = await concatToBuffer({
      inputs: [
        { x: 0, y: 0, source: tile },
        { x: 8, y: 8, source: tile },
      ],
      layout: {},
      outputFormat: 'jpeg',
      backgroundColor: 'white',
    });
    const img = jpegjs.decode(out, { useTArray: true });
    assert.strictEqual(img.width, 16);
    assert.strictEqual(img.height, 16);
    const [r, g, b] = pixelAt(img, 12, 2);
    assert.ok(r > 200 && g > 200 && b > 200, 'white background');
  });

  test('works when the working directory is outside the package', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'image-stitch-cwd-'));
    try {
      const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../src/image-concat.js')).href;
      const decodersUrl = pathToFileURL(
        path.resolve(__dirname, '../../src/decoders/index.js')
      ).href;
      const fixtureUrl = pathToFileURL(path.resolve(__dirname, '../utils/image-fixtures.js')).href;
      const script = `
        await import(${JSON.stringify(decodersUrl)});
        const { concatToBuffer } = await import(${JSON.stringify(moduleUrl)});
        const { createTestPng } = await import(${JSON.stringify(fixtureUrl)});
        const tile = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
        const out = await concatToBuffer({ inputs: [tile, tile], layout: { columns: 2 }, outputFormat: 'jpeg' });
        process.stdout.write(out[0].toString(16) + out[1].toString(16));
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: dir,
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, 'ffd8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Node helpers', () => {
  test('concatToStream produces the same bytes as concatToBuffer', async () => {
    const tile = await createTestPng(6, 6, RED);
    const options = { inputs: [tile, tile, tile], layout: { columns: 3 } };

    const fromBuffer = await concatToBuffer(options);
    const fromStream = await streamToBuffer(concatToStream(options));
    assert.deepStrictEqual(new Uint8Array(fromStream), fromBuffer);
  });

  test('concatToFile writes the output to disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'image-stitch-file-'));
    try {
      const tile = await createTestPng(6, 6, GREEN);
      const outPath = path.join(dir, 'out.png');
      const written = await concatToFile({ inputs: [tile, tile], layout: { rows: 2 } }, outPath);

      assert.strictEqual(written, outPath);
      const png = decodePng(readFileSync(outPath));
      assert.strictEqual(png.width, 6);
      assert.strictEqual(png.height, 12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('concatToFile without a path still returns a stream (deprecated)', async () => {
    const tile = await createTestPng(2, 2, GREEN);
    const stream = await concatToFile({ inputs: [tile], layout: { columns: 1 } });
    const png = decodePng(await streamToBuffer(stream));
    assert.strictEqual(png.width, 2);
  });

  test('stopping early closes the decoders', async () => {
    const tile = await createTestPng(50, 50, RED);
    let closed = 0;
    const plugin = {
      format: 'png' as const,
      create: async () => ({
        getHeader: async () => ({
          width: 50,
          height: 50,
          channels: 4 as const,
          bitDepth: 8 as const,
          format: 'png' as const,
        }),
        async *scanlines() {
          for (let y = 0; y < 50; y++) {
            yield new Uint8Array(50 * 4);
          }
        },
        close: async () => {
          closed++;
        },
      }),
    };

    for await (const chunk of concatStreaming({
      inputs: [tile, tile],
      layout: { columns: 2 },
      decoders: [plugin],
    })) {
      assert.ok(chunk.length > 0);
      break;
    }
    assert.strictEqual(closed, 2);
  });
});

describe('option validation', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['zero columns', { layout: { columns: 0 } }, /layout\.columns must be a positive integer/],
    ['fractional width', { layout: { width: 10.5 } }, /layout\.width must be a positive integer/],
    ['negative rows', { layout: { rows: -1 } }, /layout\.rows must be a positive integer/],
    [
      'non-boolean alignRows',
      { layout: { columns: 1, alignRows: 'no' } },
      /layout\.alignRows must be true or false/,
    ],
    ['missing layout', { layout: undefined }, /layout is required/],
    [
      'bad output format',
      { layout: { columns: 1 }, outputFormat: 'gif' },
      /outputFormat must be 'png' or 'jpeg'/,
    ],
    [
      'quality too high',
      { layout: { columns: 1 }, jpegQuality: 101 },
      /jpegQuality must be a number from 1 to 100/,
    ],
    [
      'quality not a number',
      { layout: { columns: 1 }, jpegQuality: '90' },
      /jpegQuality must be a number from 1 to 100/,
    ],
  ];

  for (const [name, overrides, pattern] of cases) {
    test(name, async () => {
      const tile = await createTestPng(1, 1, RED);
      await assert.rejects(
        () => concatToBuffer({ inputs: [tile], ...overrides } as never),
        pattern
      );
    });
  }
});
