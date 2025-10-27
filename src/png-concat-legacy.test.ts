import { test } from 'node:test';
import assert from 'node:assert';
import { concatPngs, PngConcatenator } from './png-concat-legacy.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData } from './png-decompress.js';
import { PngHeader, ColorType } from './types.js';

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

  // Create pixel data (all same color)
  const pixelData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixelData[i * 4] = color[0];     // R
    pixelData[i * 4 + 1] = color[1]; // G
    pixelData[i * 4 + 2] = color[2]; // B
    pixelData[i * 4 + 3] = color[3]; // A
  }

  const compressed = compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

test('concatPngs throws on empty inputs', async () => {
  await assert.rejects(
    async () => {
      await concatPngs({ inputs: [], layout: { columns: 1 } });
    },
    /At least one input image is required/
  );
});

test('concatPngs throws on missing layout', async () => {
  const testPng = createTestPng(2, 2, new Uint8Array([255, 0, 0, 255]));

  await assert.rejects(
    async () => {
      await concatPngs({ inputs: [testPng], layout: {} });
    },
    /Must specify layout/
  );
});

test('concatPngs concatenates single image', async () => {
  const testPng = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));

  const result = await concatPngs({
    inputs: [testPng],
    layout: { columns: 1 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 10);
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('concatPngs concatenates two images horizontally', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concatPngs concatenates two images vertically', async () => {
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

test('concatPngs concatenates four images in 2x2 grid', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));
  const png4 = createTestPng(10, 10, new Uint8Array([255, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2, png3, png4],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 20);
});

test('concatPngs validates incompatible bit depths', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));

  // Create a PNG with different bit depth
  const header2: PngHeader = {
    width: 10,
    height: 10,
    bitDepth: 16, // Different bit depth
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
  const pixelData2 = new Uint8Array(10 * 10 * 8); // 16-bit RGBA
  const compressed2 = compressImageData(pixelData2, header2);
  const png2 = buildPng([
    createIHDR(header2),
    createChunk('IDAT', compressed2),
    createIEND()
  ]);

  await assert.rejects(
    async () => {
      await concatPngs({
        inputs: [png1, png2],
        layout: { columns: 2 }
      });
    },
    /must have the same bit depth and color type/
  );
});

test('concatPngs validates incompatible dimensions', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  await assert.rejects(
    async () => {
      await concatPngs({
        inputs: [png1, png2],
        layout: { columns: 2 }
      });
    },
    /must have the same dimensions/
  );
});

test('concatPngs with 6 images in 3 columns', async () => {
  const pngs = [];
  for (let i = 0; i < 6; i++) {
    pngs.push(createTestPng(5, 5, new Uint8Array([i * 40, i * 40, i * 40, 255])));
  }

  const result = await concatPngs({
    inputs: pngs,
    layout: { columns: 3 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 15); // 3 columns * 5 pixels
  assert.strictEqual(header.height, 10); // 2 rows * 5 pixels
});

test('concatPngs result is valid PNG', async () => {
  const png1 = createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(8, 8, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  // Should be able to parse the result without errors
  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);

  assert.ok(header);
  assert.ok(chunks.length >= 2); // At least IHDR and IEND
  assert.strictEqual(chunks[0].type, 'IHDR');
  assert.strictEqual(chunks[chunks.length - 1].type, 'IEND');
});

test('PngConcatenator validates options', () => {
  assert.throws(
    () => new PngConcatenator({ inputs: [], layout: { columns: 1 } }),
    /At least one input image is required/
  );
});

test('concatPngs with RGB images', async () => {
  // Create RGB (not RGBA) test images
  const header: PngHeader = {
    width: 5,
    height: 5,
    bitDepth: 8,
    colorType: ColorType.RGB,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const pixelData1 = new Uint8Array(5 * 5 * 3);
  for (let i = 0; i < 5 * 5; i++) {
    pixelData1[i * 3] = 255;     // R
    pixelData1[i * 3 + 1] = 0;   // G
    pixelData1[i * 3 + 2] = 0;   // B
  }

  const pixelData2 = new Uint8Array(5 * 5 * 3);
  for (let i = 0; i < 5 * 5; i++) {
    pixelData2[i * 3] = 0;       // R
    pixelData2[i * 3 + 1] = 255; // G
    pixelData2[i * 3 + 2] = 0;   // B
  }

  const png1 = buildPng([
    createIHDR(header),
    createChunk('IDAT', compressImageData(pixelData1, header)),
    createIEND()
  ]);

  const png2 = buildPng([
    createIHDR(header),
    createChunk('IDAT', compressImageData(pixelData2, header)),
    createIEND()
  ]);

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header_result = parsePngHeader(result);
  assert.strictEqual(header_result.width, 10);
  assert.strictEqual(header_result.height, 5);
  assert.strictEqual(header_result.colorType, ColorType.RGB);
});
