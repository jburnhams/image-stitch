import { test } from 'node:test';
import assert from 'node:assert';
import { concatPngs, concatPngsToFile } from './png-concat-unified.js';
import { parsePngHeader } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData } from './png-decompress.js';
import { PngHeader, ColorType } from './types.js';
import { Readable } from 'node:stream';
import { writeFileSync, unlinkSync } from 'node:fs';

/**
 * Create a simple test PNG with solid color
 */
function createTestPng(width: number, height: number, color: Uint8Array): Uint8Array {
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
    pixelData[i * 4] = color[0];
    pixelData[i * 4 + 1] = color[1];
    pixelData[i * 4 + 2] = color[2];
    pixelData[i * 4 + 3] = color[3];
  }

  const compressed = compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

test('concatPngs returns Uint8Array by default', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Uint8Array);

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concatPngs returns stream when requested', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 },
    stream: true
  });

  assert.ok(result instanceof Readable);
});

test('concatPngs with small images', async () => {
  const png1 = createTestPng(50, 50, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(50, 50, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Uint8Array);

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 100);
  assert.strictEqual(header.height, 50);
});

test('concatPngs with file paths', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  // Save to temp files for file path testing
  const tempFile1 = '/tmp/test-png1.png';
  const tempFile2 = '/tmp/test-png2.png';
  writeFileSync(tempFile1, png1);
  writeFileSync(tempFile2, png2);

  try {
    const result = await concatPngs({
      inputs: [tempFile1, tempFile2],
      layout: { columns: 2 }
    });

    assert.ok(result instanceof Uint8Array);

    const header = parsePngHeader(result);
    assert.strictEqual(header.width, 20);
    assert.strictEqual(header.height, 10);
  } finally {
    unlinkSync(tempFile1);
    unlinkSync(tempFile2);
  }
});

test('concatPngs with Uint8Array inputs', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Uint8Array);

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concatPngsToFile returns a stream', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngsToFile({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Readable);
});

test('concatPngs handles large images efficiently', async () => {
  // Create larger test images
  const largePng1 = createTestPng(500, 500, new Uint8Array([255, 0, 0, 255]));
  const largePng2 = createTestPng(500, 500, new Uint8Array([0, 255, 0, 255]));

  // Save to temp files
  const tempFile1 = '/tmp/test-large-png1.png';
  const tempFile2 = '/tmp/test-large-png2.png';
  writeFileSync(tempFile1, largePng1);
  writeFileSync(tempFile2, largePng2);

  try {
    const result = await concatPngs({
      inputs: [tempFile1, tempFile2],
      layout: { columns: 2 }
    });

    assert.ok(result instanceof Uint8Array);

    const header = parsePngHeader(result);
    assert.strictEqual(header.width, 1000);
    assert.strictEqual(header.height, 500);
  } finally {
    unlinkSync(tempFile1);
    unlinkSync(tempFile2);
  }
});

test('concatPngs handles vertical layout', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { rows: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 20);
});

test('concatPngs handles grid layout', async () => {
  const pngs = [
    createTestPng(10, 10, new Uint8Array([255, 0, 0, 255])),
    createTestPng(10, 10, new Uint8Array([0, 255, 0, 255])),
    createTestPng(10, 10, new Uint8Array([0, 0, 255, 255])),
    createTestPng(10, 10, new Uint8Array([255, 255, 0, 255]))
  ];

  const result = await concatPngs({
    inputs: pngs,
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 20);
});
