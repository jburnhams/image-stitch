import { test } from 'node:test';
import assert from 'node:assert';
import { concatPngsStream, concatPngsToStream, PngConcatenatorStream } from './png-concat-stream.js';
import { parsePngHeader } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData } from './png-decompress.js';
import { PngHeader, ColorType } from './types.js';
import { Readable } from 'node:stream';

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

test('concatPngsStream yields PNG chunks', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatPngsStream({
    inputs: [png1, png2],
    layout: { columns: 2 }
  })) {
    chunks.push(chunk);
  }

  // Should have at least signature, IHDR, IDAT, and IEND
  assert.ok(chunks.length >= 4);

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  // Verify it's a valid PNG
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concatPngsStream produces same result as concatPngs', async () => {
  const png1 = createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(8, 8, new Uint8Array([0, 255, 0, 255]));

  // Get streaming result
  const chunks: Uint8Array[] = [];
  for await (const chunk of concatPngsStream({
    inputs: [png1, png2],
    layout: { rows: 2 }
  })) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const streamResult = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    streamResult.set(chunk, offset);
    offset += chunk.length;
  }

  // Get non-streaming result
  const { concatPngs } = await import('./png-concat.js');
  const normalResult = await concatPngs({
    inputs: [png1, png2],
    layout: { rows: 2 }
  });

  // Results should be identical
  assert.deepStrictEqual(streamResult, normalResult);
});

test('concatPngsToStream returns a Readable stream', async () => {
  const png1 = createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(5, 5, new Uint8Array([0, 255, 0, 255]));

  const stream = concatPngsToStream({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(stream instanceof Readable);

  // Read all data from stream
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const result = Buffer.concat(chunks);

  // Verify it's a valid PNG
  const header = parsePngHeader(new Uint8Array(result));
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 5);
});

test('PngConcatenatorStream validates options', () => {
  assert.throws(
    () => new PngConcatenatorStream({ inputs: [], layout: { columns: 1 } }),
    /At least one input image is required/
  );

  assert.throws(
    () => new PngConcatenatorStream({
      inputs: [new Uint8Array()],
      layout: {}
    }),
    /Must specify layout/
  );
});

test('concatPngsStream with single image', async () => {
  const png = createTestPng(10, 10, new Uint8Array([100, 150, 200, 255]));

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatPngsStream({
    inputs: [png],
    layout: { columns: 1 }
  })) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 10);
});

test('concatPngsStream yields chunks in correct order', async () => {
  const png1 = createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatPngsStream({
    inputs: [png1],
    layout: { columns: 1 }
  })) {
    chunks.push(chunk);
  }

  // First chunk should be PNG signature
  assert.strictEqual(chunks[0][0], 137);
  assert.strictEqual(chunks[0][1], 80); // 'P'
  assert.strictEqual(chunks[0][2], 78); // 'N'
  assert.strictEqual(chunks[0][3], 71); // 'G'

  // Should be able to parse the complete result
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  assert.doesNotThrow(() => parsePngHeader(result));
});

test('concatPngsStream handles multiple images in grid', async () => {
  const pngs = [
    createTestPng(4, 4, new Uint8Array([255, 0, 0, 255])),
    createTestPng(4, 4, new Uint8Array([0, 255, 0, 255])),
    createTestPng(4, 4, new Uint8Array([0, 0, 255, 255])),
    createTestPng(4, 4, new Uint8Array([255, 255, 0, 255]))
  ];

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatPngsStream({
    inputs: pngs,
    layout: { columns: 2 }
  })) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 8); // 2 columns * 4 pixels
  assert.strictEqual(header.height, 8); // 2 rows * 4 pixels
});
