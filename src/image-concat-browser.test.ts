import { test } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  concatCanvases,
  concatToBuffer,
  concatStreaming,
  concat as deprecatedConcat
} from './image-concat-browser.js';
import type { BrowserConcatOptions } from './image-concat-browser.js';
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

test('concatStreaming yields stitched PNG chunks', async () => {
  const red = await createTestPng(2, 2, new Uint8Array([255, 0, 0, 255]));
  const green = await createTestPng(2, 2, new Uint8Array([0, 255, 0, 255]));

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatStreaming({
    inputs: [red, green],
    layout: { columns: 2 }
  })) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  const header = parsePngHeader(buffer);
  assert.strictEqual(header.width, 4);
  assert.strictEqual(header.height, 2);
});

test('concatToBuffer accepts Blob inputs from async iterables', async () => {
  const window = new Window();
  const globalAny = globalThis as Record<string, unknown>;

  if (typeof globalAny.Blob === 'undefined') {
    globalAny.Blob = window.Blob;
  }

  const png = await createTestPng(4, 2, new Uint8Array([12, 34, 56, 255]));
  const inputs = async function* (): AsyncGenerator<Blob> {
    for (let i = 0; i < 2; i++) {
      const copy = new Uint8Array(png.length);
      copy.set(png);
      yield new Blob([copy], { type: 'image/png' });
    }
  };

  const buffer = await concatToBuffer({
    inputs: inputs(),
    layout: { columns: 2 }
  } satisfies BrowserConcatOptions);

  const header = parsePngHeader(buffer);
  assert.strictEqual(header.width, 8);
  assert.strictEqual(header.height, 2);

  await window.close();
});

test('concatToBuffer accepts HTMLCanvasElement inputs with convertToBlob', async () => {
  const window = new Window();
  const globalAny = globalThis as Record<string, unknown>;

  if (typeof globalAny.HTMLCanvasElement === 'undefined') {
    globalAny.HTMLCanvasElement = window.HTMLCanvasElement;
  }

  const png = await createTestPng(3, 3, new Uint8Array([200, 150, 100, 255]));

  const canvas = window.document.createElement('canvas');
  canvas.width = 3;
  canvas.height = 3;
  Object.defineProperty(canvas, 'convertToBlob', {
    value: () => Promise.resolve(new Blob([new Uint8Array(png)], { type: 'image/png' }))
  });
  Object.defineProperty(canvas, 'toBlob', {
    value: undefined
  });

  const set = new Set<HTMLCanvasElement>();
  set.add(canvas as unknown as HTMLCanvasElement);

  const result = await concatToBuffer({
    inputs: set,
    layout: { rows: 1, columns: 1 }
  } satisfies BrowserConcatOptions);

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 3);
  assert.strictEqual(header.height, 3);

  await window.close();
});

test('concatCanvases can render directly into a provided canvas using createImageBitmap', async () => {
  const window = new Window();
  const globalAny = globalThis as Record<string, unknown>;

  if (typeof globalAny.HTMLCanvasElement === 'undefined') {
    globalAny.HTMLCanvasElement = window.HTMLCanvasElement;
  }

  if (typeof globalAny.Blob === 'undefined') {
    globalAny.Blob = window.Blob;
  }

  const png = await createTestPng(5, 4, new Uint8Array([10, 20, 30, 255]));
  const canvasInput = window.document.createElement('canvas');
  canvasInput.width = 5;
  canvasInput.height = 4;
  Object.defineProperty(canvasInput, 'toBlob', {
    value: (callback: BlobCallback) => {
      const copy = new Uint8Array(png.length);
      copy.set(png);
      callback(new Blob([copy], { type: 'image/png' }));
    }
  });

  const targetCanvas = window.document.createElement('canvas') as unknown as HTMLCanvasElement;
  let transferred = false;
  Object.defineProperty(targetCanvas, 'getContext', {
    value: (type: string) => {
      if (type === 'bitmaprenderer') {
        return {
          transferFromImageBitmap() {
            transferred = true;
          }
        };
      }
      return null;
    }
  });

  const previousCreateImageBitmap = globalAny.createImageBitmap;
  globalAny.createImageBitmap = async () => ({
    width: 5,
    height: 4,
    close() {
      return undefined;
    }
  });

  try {
    const result = await concatCanvases({
      canvases: [canvasInput as unknown as HTMLCanvasElement],
      layout: { columns: 1 },
      output: 'canvas',
      targetCanvas
    });

    const rendered = result as HTMLCanvasElement;
    assert.strictEqual(rendered, targetCanvas);
    assert.strictEqual(rendered.width, 5);
    assert.strictEqual(rendered.height, 4);
    assert.strictEqual(transferred, true);
  } finally {
    if (previousCreateImageBitmap) {
      globalAny.createImageBitmap = previousCreateImageBitmap;
    } else {
      delete globalAny.createImageBitmap;
    }
  }

  await window.close();
});

test('concatCanvases accepts async iterable sources', async () => {
  const window = new Window();
  const globalAny = globalThis as Record<string, unknown>;

  if (typeof globalAny.HTMLCanvasElement === 'undefined') {
    globalAny.HTMLCanvasElement = window.HTMLCanvasElement;
  }

  const png = await createTestPng(2, 3, new Uint8Array([90, 80, 70, 255]));

  async function* canvases(): AsyncGenerator<HTMLCanvasElement> {
    const canvas = window.document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 3;
    Object.defineProperty(canvas, 'toBlob', {
      value: (callback: BlobCallback) => {
        const copy = new Uint8Array(png.length);
        copy.set(png);
        callback(new Blob([copy], { type: 'image/png' }));
      }
    });
    yield canvas as unknown as HTMLCanvasElement;
  }

  const blob = await concatCanvases({
    canvases: canvases(),
    layout: { columns: 1 }
  });

  assert.ok(blob instanceof Blob);
  const header = parsePngHeader(new Uint8Array(await blob.arrayBuffer()));
  assert.strictEqual(header.width, 2);
  assert.strictEqual(header.height, 3);

  await window.close();
});

test('concatCanvases accepts iterable sources', async () => {
  const window = new Window();
  const globalAny = globalThis as Record<string, unknown>;

  if (typeof globalAny.HTMLCanvasElement === 'undefined') {
    globalAny.HTMLCanvasElement = window.HTMLCanvasElement;
  }

  const png = await createTestPng(3, 2, new Uint8Array([70, 60, 50, 255]));

  const canvas = window.document.createElement('canvas');
  canvas.width = 3;
  canvas.height = 2;
  Object.defineProperty(canvas, 'toBlob', {
    value: (callback: BlobCallback) => {
      const copy = new Uint8Array(png.length);
      copy.set(png);
      callback(new Blob([copy], { type: 'image/png' }));
    }
  });

  const set = new Set<HTMLCanvasElement>();
  set.add(canvas as unknown as HTMLCanvasElement);

  const blob = await concatCanvases({
    canvases: set,
    layout: { rows: 1 }
  });

  assert.ok(blob instanceof Blob);
  const header = parsePngHeader(new Uint8Array(await blob.arrayBuffer()));
  assert.strictEqual(header.width, 3);
  assert.strictEqual(header.height, 2);

  await window.close();
});

test('concatCanvases rejects unsupported sources', async () => {
  await assert.rejects(
    () =>
      concatCanvases({
        canvases: 123 as unknown as HTMLCanvasElement[],
        layout: { columns: 1 }
      }),
    /At least one canvas is required|Unsupported input source/
  );
});

test('concat alias delegates to concatToBuffer', async () => {
  const png = await createTestPng(2, 2, new Uint8Array([1, 2, 3, 255]));
  const result = await deprecatedConcat({
    inputs: [png],
    layout: { columns: 1 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 2);
  assert.strictEqual(header.height, 2);
});

test('concatToBuffer rejects unsupported input sources', () => {
  assert.throws(
    () =>
      concatToBuffer({
        inputs: 123 as unknown as BrowserConcatOptions['inputs'],
        layout: { columns: 1 }
      }),
    /Unsupported input source type/
  );
});
