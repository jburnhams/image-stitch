import { test } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { concatCanvases } from './image-concat-browser.js';
import { parsePngHeader } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData } from './png-decompress.js';
import { ColorType, PngHeader } from './types.js';

async function createTestPng(
  width: number,
  height: number,
  color: Uint8Array
): Promise<Uint8Array> {
  const header: PngHeader = {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const pixelData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixelData.set(color, i * 4);
  }

  const compressed = await compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

test('concatCanvases stitches canvas inputs into a PNG blob', async () => {
  const window = new Window();

  const globalAny = globalThis as Record<string, unknown>;
  if (typeof globalAny.HTMLCanvasElement === 'undefined') {
    globalAny.HTMLCanvasElement = window.HTMLCanvasElement;
  }

  const red = await createTestPng(8, 6, new Uint8Array([255, 0, 0, 255]));
  const green = await createTestPng(8, 6, new Uint8Array([0, 255, 0, 255]));
  const blue = await createTestPng(8, 6, new Uint8Array([0, 0, 255, 255]));
  const white = await createTestPng(8, 6, new Uint8Array([255, 255, 255, 255]));

  const canvases = [red, green, blue, white].map((png) => {
    const canvas = window.document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 6;
    Object.defineProperty(canvas, 'toBlob', {
      value: (callback: BlobCallback) => {
        const copy = new Uint8Array(png.length);
        copy.set(png);
        callback(new Blob([copy.buffer], { type: 'image/png' }));
      }
    });
    return canvas as unknown as HTMLCanvasElement;
  });

  const result = await concatCanvases({
    canvases,
    layout: { rows: 2, columns: 2 }
  });

  assert.ok(result instanceof Blob);
  assert.strictEqual(result.type, 'image/png');

  const buffer = new Uint8Array(await result.arrayBuffer());
  const header = parsePngHeader(buffer);
  assert.strictEqual(header.width, 16);
  assert.strictEqual(header.height, 12);

  await window.close();
});

test('concatCanvases forwards progress updates from the underlying stitcher', async () => {
  const window = new Window();

  const globalAny = globalThis as Record<string, unknown>;
  if (typeof globalAny.HTMLCanvasElement === 'undefined') {
    globalAny.HTMLCanvasElement = window.HTMLCanvasElement;
  }

  const red = await createTestPng(4, 4, new Uint8Array([255, 0, 0, 255]));
  const green = await createTestPng(4, 4, new Uint8Array([0, 255, 0, 255]));
  const blue = await createTestPng(4, 4, new Uint8Array([0, 0, 255, 255]));

  const canvases = [red, green, blue].map((png) => {
    const canvas = window.document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    Object.defineProperty(canvas, 'toBlob', {
      value: (callback: BlobCallback) => {
        const copy = new Uint8Array(png.length);
        copy.set(png);
        callback(new Blob([copy.buffer], { type: 'image/png' }));
      }
    });
    return canvas as unknown as HTMLCanvasElement;
  });

  const progress: Array<[number, number]> = [];

  await concatCanvases({
    canvases,
    layout: { columns: 2 },
    onProgress(current, total) {
      progress.push([current, total]);
    }
  });

  assert.deepStrictEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3]
  ]);

  await window.close();
});
