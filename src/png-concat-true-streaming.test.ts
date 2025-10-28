import { test } from 'node:test';
import assert from 'node:assert';
import { concatPngs, concatPngsToStream, TrueStreamingConcatenator } from './png-concat-true-streaming.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData, extractPixelData } from './png-decompress.js';
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

/**
 * Collect all chunks from generator
 */
async function collectChunks(generator: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

// ===== BASIC FUNCTIONALITY TESTS =====

test('concatPngs throws on empty inputs', async () => {
  await assert.rejects(
    async () => {
      const gen = concatPngs({ inputs: [], layout: { columns: 1 } });
      await collectChunks(gen);
    },
    /At least one input image is required/
  );
});

test('concatPngs throws on missing layout', async () => {
  const testPng = createTestPng(2, 2, new Uint8Array([255, 0, 0, 255]));

  await assert.rejects(
    async () => {
      const gen = concatPngs({ inputs: [testPng], layout: {} });
      await collectChunks(gen);
    },
    /Must specify layout/
  );
});

test('concatPngs concatenates single image (Uint8Array)', async () => {
  const testPng = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [testPng],
    layout: { columns: 1 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 10);
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('concatPngs concatenates single image (file path)', async () => {
  const testPng = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const tempFile = '/tmp/test-single-streaming.png';
  writeFileSync(tempFile, testPng);

  try {
    const result = await collectChunks(concatPngs({
      inputs: [tempFile],
      layout: { columns: 1 }
    }));

    const header = parsePngHeader(result);
    assert.strictEqual(header.width, 10);
    assert.strictEqual(header.height, 10);
  } finally {
    unlinkSync(tempFile);
  }
});

test('concatPngs concatenates two images horizontally', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concatPngs concatenates two images vertically', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { rows: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 20);
});

test('concatPngs concatenates four images in 2x2 grid', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));
  const png4 = createTestPng(10, 10, new Uint8Array([255, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3, png4],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 20);
});

// ===== VALIDATION TESTS =====

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
      const gen = concatPngs({
        inputs: [png1, png2],
        layout: { columns: 2 }
      });
      await collectChunks(gen);
    },
    /must have same bit depth and color type/
  );
});

// ===== VARIABLE IMAGE SIZE TESTS =====

test('concatPngs supports arbitrary dimensions with padding', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30); // 10 + 20
  assert.strictEqual(header.height, 20); // max(10, 20)
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('concatPngs with 6 images in 3 columns', async () => {
  const pngs = [];
  for (let i = 0; i < 6; i++) {
    pngs.push(createTestPng(5, 5, new Uint8Array([i * 40, i * 40, i * 40, 255])));
  }

  const result = await collectChunks(concatPngs({
    inputs: pngs,
    layout: { columns: 3 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 15); // 3 columns * 5 pixels
  assert.strictEqual(header.height, 10); // 2 rows * 5 pixels
});

test('concatPngs result is valid PNG', async () => {
  const png1 = createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(8, 8, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  // Should be able to parse the result without errors
  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);

  assert.ok(header);
  assert.ok(chunks.length >= 2); // At least IHDR and IEND
  assert.strictEqual(chunks[0].type, 'IHDR');
  assert.strictEqual(chunks[chunks.length - 1].type, 'IEND');
});

test('TrueStreamingConcatenator validates options', () => {
  assert.throws(
    () => new TrueStreamingConcatenator({ inputs: [], layout: { columns: 1 } }),
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

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header_result = parsePngHeader(result);
  assert.strictEqual(header_result.width, 10);
  assert.strictEqual(header_result.height, 5);
  assert.strictEqual(header_result.colorType, ColorType.RGB);
});

test('concatPngs with different heights in same row', async () => {
  const png1 = createTestPng(10, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 15, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3],
    layout: { columns: 3 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30); // 10 + 10 + 10
  assert.strictEqual(header.height, 15); // max(5, 15, 10)
});

test('concatPngs with different widths in same column', async () => {
  const png1 = createTestPng(5, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(15, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { rows: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 15); // max(5, 15)
  assert.strictEqual(header.height, 20); // 10 + 10
});

test('concatPngs with variable sizes in grid layout', async () => {
  // Create a 2x2 grid with different sizes
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(20, 15, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(15, 20, new Uint8Array([0, 0, 255, 255]));
  const png4 = createTestPng(25, 25, new Uint8Array([255, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3, png4],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 40);
  assert.strictEqual(header.height, 40);
});

test('concatPngs with pixel width limit wraps to new row', async () => {
  const png1 = createTestPng(30, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(30, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(30, 10, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3],
    layout: { width: 70 } // Can fit 2 images per row (30+30=60 < 70)
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 60); // 30 + 30 (row 1 has 2 images)
  assert.strictEqual(header.height, 20); // 10 (row 1) + 10 (row 2)
});

test('concatPngs with pixel height limit stops adding rows', async () => {
  const png1 = createTestPng(10, 30, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 30, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 30, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3],
    layout: { height: 70, columns: 1 } // Can fit 2 images (30+30=60 < 70)
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 60); // Only 2 images fit
});

test('concatPngs with mixed sizes and transparent padding', async () => {
  // Small and large images - should pad with transparency
  const png1 = createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 25); // 5 + 20
  assert.strictEqual(header.height, 20); // max(5, 20)

  // Extract pixel data to verify padding (transparent for RGBA is 0,0,0,0)
  const chunks = parsePngChunks(result);
  const pixels = extractPixelData(chunks, header);

  // Check that padding area has transparent pixels
  // Pixel at (2, 10) should be transparent (below first image's 5x5, in padding area)
  const bytesPerPixel = 4;
  const offset = (10 * header.width + 2) * bytesPerPixel;
  assert.strictEqual(pixels[offset], 0); // R
  assert.strictEqual(pixels[offset + 1], 0); // G
  assert.strictEqual(pixels[offset + 2], 0); // B
  assert.strictEqual(pixels[offset + 3], 0); // A (transparent)
});

test('concatPngs with three rows of different heights', async () => {
  const png1 = createTestPng(10, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 15, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3],
    layout: { columns: 1 } // Vertical stack
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 30); // 5 + 10 + 15
});

test('concatPngs with rows layout and variable widths', async () => {
  const png1 = createTestPng(5, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(15, 10, new Uint8Array([0, 0, 255, 255]));
  const png4 = createTestPng(20, 10, new Uint8Array([255, 255, 0, 255]));

  const result = await collectChunks(concatPngs({
    inputs: [png1, png2, png3, png4],
    layout: { rows: 2 } // 2 rows, 2 columns (column-first placement)
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30);
  assert.strictEqual(header.height, 20); // 10 + 10
});

// ===== STREAMING API TESTS =====

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

test('concatPngs yields chunks in correct order', async () => {
  const png1 = createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatPngs({
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
  const result = await collectChunks(concatPngs({
    inputs: [png1],
    layout: { columns: 1 }
  }));

  assert.doesNotThrow(() => parsePngHeader(result));
});

test('concatPngs handles multiple images in grid (streaming)', async () => {
  const pngs = [
    createTestPng(4, 4, new Uint8Array([255, 0, 0, 255])),
    createTestPng(4, 4, new Uint8Array([0, 255, 0, 255])),
    createTestPng(4, 4, new Uint8Array([0, 0, 255, 255])),
    createTestPng(4, 4, new Uint8Array([255, 255, 0, 255]))
  ];

  const result = await collectChunks(concatPngs({
    inputs: pngs,
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 8); // 2 columns * 4 pixels
  assert.strictEqual(header.height, 8); // 2 rows * 4 pixels
});

// ===== MIXED INPUT TYPE TESTS =====

test('concatPngs supports mixed input types (file + Uint8Array)', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const tempFile = '/tmp/test-mixed-input.png';
  writeFileSync(tempFile, png1);

  try {
    const result = await collectChunks(concatPngs({
      inputs: [tempFile, png2], // Mix of file path and Uint8Array
      layout: { columns: 2 }
    }));

    const header = parsePngHeader(result);
    assert.strictEqual(header.width, 20);
    assert.strictEqual(header.height, 10);
  } finally {
    unlinkSync(tempFile);
  }
});

test('concatPngs supports multiple file inputs', async () => {
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const tempFile1 = '/tmp/test-multi-file-1.png';
  const tempFile2 = '/tmp/test-multi-file-2.png';
  writeFileSync(tempFile1, png1);
  writeFileSync(tempFile2, png2);

  try {
    const result = await collectChunks(concatPngs({
      inputs: [tempFile1, tempFile2],
      layout: { rows: 2 }
    }));

    const header = parsePngHeader(result);
    assert.strictEqual(header.width, 10);
    assert.strictEqual(header.height, 20);
  } finally {
    unlinkSync(tempFile1);
    unlinkSync(tempFile2);
  }
});
