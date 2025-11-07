import { test } from 'node:test';
import assert from 'node:assert';
import { concatStreaming, concatToStream, concat, concatToFile, StreamingConcatenator } from './image-concat.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData, extractPixelData } from './png-decompress.js';
import { PngHeader, ColorType } from './types.js';
import { Readable } from 'node:stream';
import { writeFileSync, unlinkSync } from 'node:fs';

/**
 * Create a simple test PNG with solid color
 */
async function createTestPng(width: number, height: number, color: Uint8Array): Promise<Uint8Array> {
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

  const compressed = await compressImageData(pixelData, header);
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

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}

// ===== BASIC FUNCTIONALITY TESTS =====

test('concat throws on empty inputs', async () => {
  await assert.rejects(
    async () => {
      const gen = concatStreaming({ inputs: [], layout: { columns: 1 } });
      await collectChunks(gen);
    },
    /At least one input image is required/
  );
});

test('concat throws on missing layout', async () => {
  const testPng = await createTestPng(2, 2, new Uint8Array([255, 0, 0, 255]));

  await assert.rejects(
    async () => {
      const gen = concatStreaming({ inputs: [testPng], layout: {} });
      await collectChunks(gen);
    },
    /Must specify layout/
  );
});

test('concat concatenates single image (Uint8Array)', async () => {
  const testPng = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [testPng],
    layout: { columns: 1 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 10);
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('concat concatenates single image (file path)', async () => {
  const testPng = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const tempFile = '/tmp/test-single-streaming.png';
  writeFileSync(tempFile, testPng);

  try {
    const result = await collectChunks(concatStreaming({
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

test('concat concatenates two images horizontally', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concat concatenates two images vertically', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { rows: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 20);
});

test('concat concatenates four images in 2x2 grid', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));
  const png4 = await createTestPng(10, 10, new Uint8Array([255, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3, png4],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 20);
});

// ===== VALIDATION TESTS =====

test('concat automatically converts mixed bit depths', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));

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
  const compressed2 = await compressImageData(pixelData2, header2);
  const png2 = buildPng([
    createIHDR(header2),
    createChunk('IDAT', compressed2),
    createIEND()
  ]);

  // Should successfully concatenate and use the highest bit depth (16-bit)
  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.bitDepth, 16, 'Should use highest bit depth');
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

// ===== VARIABLE IMAGE SIZE TESTS =====

test('concat supports arbitrary dimensions with padding', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30); // 10 + 20
  assert.strictEqual(header.height, 20); // max(10, 20)
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('concat with 6 images in 3 columns', async () => {
  const pngs = [];
  for (let i = 0; i < 6; i++) {
    pngs.push(await createTestPng(5, 5, new Uint8Array([i * 40, i * 40, i * 40, 255])));
  }

  const result = await collectChunks(concatStreaming({
    inputs: pngs,
    layout: { columns: 3 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 15); // 3 columns * 5 pixels
  assert.strictEqual(header.height, 10); // 2 rows * 5 pixels
});

test('concat result is valid PNG', async () => {
  const png1 = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(8, 8, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
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

test('StreamingConcatenator validates options', () => {
  assert.throws(
    () => new StreamingConcatenator({ inputs: [], layout: { columns: 1 } }),
    /At least one input image is required/
  );
});

test('concat with RGB images converts to RGBA', async () => {
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
    createChunk('IDAT', await compressImageData(pixelData1, header)),
    createIEND()
  ]);

  const png2 = buildPng([
    createIHDR(header),
    createChunk('IDAT', await compressImageData(pixelData2, header)),
    createIEND()
  ]);

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header_result = parsePngHeader(result);
  assert.strictEqual(header_result.width, 10);
  assert.strictEqual(header_result.height, 5);
  // RGB images are converted to RGBA for maximum compatibility
  assert.strictEqual(header_result.colorType, ColorType.RGBA);
});

test('concat with different heights in same row', async () => {
  const png1 = await createTestPng(10, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 15, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3],
    layout: { columns: 3 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30); // 10 + 10 + 10
  assert.strictEqual(header.height, 15); // max(5, 15, 10)
});

test('concat with different widths in same column', async () => {
  const png1 = await createTestPng(5, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(15, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { rows: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 15); // max(5, 15)
  assert.strictEqual(header.height, 20); // 10 + 10
});

test('concat with variable sizes in grid layout', async () => {
  // Create a 2x2 grid with different sizes
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(20, 15, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(15, 20, new Uint8Array([0, 0, 255, 255]));
  const png4 = await createTestPng(25, 25, new Uint8Array([255, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3, png4],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 40);
  assert.strictEqual(header.height, 40);
});

test('concat with pixel width limit wraps to new row', async () => {
  const png1 = await createTestPng(30, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(30, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(30, 10, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3],
    layout: { width: 70 } // Can fit 2 images per row (30+30=60 < 70)
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 60); // 30 + 30 (row 1 has 2 images)
  assert.strictEqual(header.height, 20); // 10 (row 1) + 10 (row 2)
});

test('concat with pixel height limit stops adding rows', async () => {
  const png1 = await createTestPng(10, 30, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 30, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(10, 30, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3],
    layout: { height: 70, columns: 1 } // Can fit 2 images (30+30=60 < 70)
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 60); // Only 2 images fit
});

test('concat with mixed sizes and transparent padding', async () => {
  // Small and large images - should pad with transparency
  const png1 = await createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 25); // 5 + 20
  assert.strictEqual(header.height, 20); // max(5, 20)

  // Extract pixel data to verify padding (transparent for RGBA is 0,0,0,0)
  const chunks = parsePngChunks(result);
  const pixels = await extractPixelData(chunks, header);

  // Check that padding area has transparent pixels
  // Pixel at (2, 10) should be transparent (below first image's 5x5, in padding area)
  const bytesPerPixel = 4;
  const offset = (10 * header.width + 2) * bytesPerPixel;
  assert.strictEqual(pixels[offset], 0); // R
  assert.strictEqual(pixels[offset + 1], 0); // G
  assert.strictEqual(pixels[offset + 2], 0); // B
  assert.strictEqual(pixels[offset + 3], 0); // A (transparent)
});

test('concat with three rows of different heights', async () => {
  const png1 = await createTestPng(10, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(10, 15, new Uint8Array([0, 0, 255, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3],
    layout: { columns: 1 } // Vertical stack
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 30); // 5 + 10 + 15
});

test('concat with rows layout and variable widths', async () => {
  const png1 = await createTestPng(5, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(15, 10, new Uint8Array([0, 0, 255, 255]));
  const png4 = await createTestPng(20, 10, new Uint8Array([255, 255, 0, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [png1, png2, png3, png4],
    layout: { rows: 2 } // 2 rows, 2 columns (column-first placement)
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30);
  assert.strictEqual(header.height, 20); // 10 + 10
});

// ===== STREAMING API TESTS =====

test('concatToStream returns a Readable stream', async () => {
  const png1 = await createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(5, 5, new Uint8Array([0, 255, 0, 255]));

  const stream = concatToStream({
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

test('concat yields chunks in correct order', async () => {
  const png1 = await createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));

  const chunks: Uint8Array[] = [];
  for await (const chunk of concatStreaming({
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
  const result = await collectChunks(concatStreaming({
    inputs: [png1],
    layout: { columns: 1 }
  }));

  assert.doesNotThrow(() => parsePngHeader(result));
});

test('concat handles multiple images in grid (streaming)', async () => {
  const pngs = [
    await createTestPng(4, 4, new Uint8Array([255, 0, 0, 255])),
    await createTestPng(4, 4, new Uint8Array([0, 255, 0, 255])),
    await createTestPng(4, 4, new Uint8Array([0, 0, 255, 255])),
    await createTestPng(4, 4, new Uint8Array([255, 255, 0, 255]))
  ];

  const result = await collectChunks(concatStreaming({
    inputs: pngs,
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 8); // 2 columns * 4 pixels
  assert.strictEqual(header.height, 8); // 2 rows * 4 pixels
});

// ===== MIXED INPUT TYPE TESTS =====

test('concat supports mixed input types (file + Uint8Array)', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const tempFile = '/tmp/test-mixed-input.png';
  writeFileSync(tempFile, png1);

  try {
    const result = await collectChunks(concatStreaming({
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

test('concat accepts async iterable inputs', async () => {
  const png1 = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(8, 8, new Uint8Array([0, 0, 255, 255]));

  async function* inputStream() {
    yield png1;
    yield png2;
  }

  const result = await concat({
    inputs: inputStream(),
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result as Uint8Array);
  assert.strictEqual(header.width, 16);
  assert.strictEqual(header.height, 8);
});

test('concat supports ArrayBuffer inputs (streaming)', async () => {
  const png1 = await createTestPng(12, 12, new Uint8Array([120, 45, 200, 255]));
  const png2 = await createTestPng(12, 12, new Uint8Array([45, 200, 120, 255]));

  const result = await collectChunks(concatStreaming({
    inputs: [toArrayBuffer(png1), toArrayBuffer(png2)],
    layout: { columns: 2 }
  }));

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 24);
  assert.strictEqual(header.height, 12);
});

test('concat supports multiple file inputs', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const tempFile1 = '/tmp/test-multi-file-1.png';
  const tempFile2 = '/tmp/test-multi-file-2.png';
  writeFileSync(tempFile1, png1);
  writeFileSync(tempFile2, png2);

  try {
    const result = await collectChunks(concatStreaming({
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

// ===== UNIFIED API TESTS =====

test('concat (unified API) returns Uint8Array by default', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Uint8Array);

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 20);
  assert.strictEqual(header.height, 10);
});

test('concat (unified API) returns stream when requested', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 },
    stream: true
  });

  assert.ok(result instanceof Readable);
});

test('concat (unified API) with small images', async () => {
  const png1 = await createTestPng(50, 50, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(50, 50, new Uint8Array([0, 255, 0, 255]));

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Uint8Array);

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 100);
  assert.strictEqual(header.height, 50);
});

test('concat (unified API) with file paths', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const tempFile1 = '/tmp/test-png1.png';
  const tempFile2 = '/tmp/test-png2.png';
  writeFileSync(tempFile1, png1);
  writeFileSync(tempFile2, png2);

  try {
    const result = await concat({
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

test('concat (unified API) accepts ArrayBuffer inputs', async () => {
  const png1 = await createTestPng(16, 8, new Uint8Array([5, 100, 200, 255]));
  const png2 = await createTestPng(16, 8, new Uint8Array([200, 5, 100, 255]));

  const result = await concat({
    inputs: [toArrayBuffer(png1), toArrayBuffer(png2)],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Uint8Array);
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 8);
});

test('concatToFile returns a stream', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatToFile({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  assert.ok(result instanceof Readable);
});

test('concat (unified API) handles vertical layout', async () => {
  const png1 = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concat({
    inputs: [png1, png2],
    layout: { rows: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 20);
});

test('concat with width limit wrapping produces valid PNG', async () => {
  // Create images that will wrap to multiple rows
  const png1 = await createTestPng(40, 30, new Uint8Array([255, 0, 0, 255]));   // Red
  const png2 = await createTestPng(40, 30, new Uint8Array([0, 255, 0, 255]));   // Green
  const png3 = await createTestPng(40, 30, new Uint8Array([0, 0, 255, 255]));   // Blue
  const png4 = await createTestPng(40, 30, new Uint8Array([255, 255, 0, 255])); // Yellow

  // Width limit of 100 should create:
  // Row 1: png1 (40) + png2 (40) = 80 pixels
  // Row 2: png3 (40) + png4 (40) = 80 pixels
  // But if the next image would exceed 100, it wraps
  const result = await concat({
    inputs: [png1, png2, png3, png4],
    layout: { width: 100 }
  });

  // Verify it's a valid PNG by parsing the header
  const header = parsePngHeader(result);
  assert.ok(header.width > 0, 'Width should be greater than 0');
  assert.ok(header.height > 0, 'Height should be greater than 0');

  // Verify we can decompress the image data without errors
  const chunks = parsePngChunks(result);
  const pixelData = await extractPixelData(chunks, header);

  // Verify pixel data size matches header dimensions
  const expectedSize = header.width * header.height * 4; // RGBA
  assert.strictEqual(pixelData.length, expectedSize, 'Pixel data size should match header dimensions');
});

test('concat with width limit - different row widths', async () => {
  // Create a scenario where rows have different widths
  const png1 = await createTestPng(50, 20, new Uint8Array([255, 0, 0, 255]));   // Red - 50px
  const png2 = await createTestPng(50, 20, new Uint8Array([0, 255, 0, 255]));   // Green - 50px
  const png3 = await createTestPng(30, 20, new Uint8Array([0, 0, 255, 255]));   // Blue - 30px

  // Width limit of 80 should create:
  // Row 1: png1 (50) + png2 (50) = 100 > 80, so only png1 fits
  // Row 2: png2 (50)
  // Row 3: png3 (30)
  // This creates rows with widths: 50, 50, 30
  // totalWidth should be 50 (the max)
  const result = await concat({
    inputs: [png1, png2, png3],
    layout: { width: 80 }
  });

  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);

  // This should not throw "Unexpected end of decompressed data"
  const pixelData = await extractPixelData(chunks, header);

  // Verify pixel data size matches header dimensions
  const expectedSize = header.width * header.height * 4; // RGBA
  assert.strictEqual(pixelData.length, expectedSize, 'Pixel data size should match header dimensions');
});

test('concat with width limit - single image per row', async () => {
  // Edge case: width limit forces each image to its own row
  const png1 = await createTestPng(60, 15, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(70, 15, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(50, 15, new Uint8Array([0, 0, 255, 255]));

  // Width limit of 65 means:
  // Row 1: png1 (60)
  // Row 2: png2 (70) > 65, but it's the first in the row so it still fits
  // Row 3: png3 (50)
  // totalWidth should be 70 (the max)
  const result = await concat({
    inputs: [png1, png2, png3],
    layout: { width: 65 }
  });

  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);
  const pixelData = await extractPixelData(chunks, header);

  assert.strictEqual(header.width, 70, 'Width should be the max row width');
  assert.strictEqual(header.height, 45, 'Height should be sum of all row heights');
  assert.strictEqual(pixelData.length, 70 * 45 * 4, 'Pixel data size should match header');
});

test('concat with width limit - extreme size differences', async () => {
  // Edge case: very different image sizes
  const png1 = await createTestPng(100, 50, new Uint8Array([255, 0, 0, 255]));  // Large
  const png2 = await createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));   // Small
  const png3 = await createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));   // Small

  // Width limit of 150 should create:
  // Row 1: png1 (100) + png2 (10) + png3 (10) = 120
  // totalWidth = 120
  const result = await concat({
    inputs: [png1, png2, png3],
    layout: { width: 150 }
  });

  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);
  const pixelData = await extractPixelData(chunks, header);

  assert.strictEqual(header.width, 120);
  assert.strictEqual(header.height, 50); // Max height in row
  assert.strictEqual(pixelData.length, 120 * 50 * 4);
});

test('concat with width limit - last row much narrower', async () => {
  // Specific edge case: last row is significantly narrower than others
  const png1 = await createTestPng(80, 25, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(80, 25, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(5, 25, new Uint8Array([0, 0, 255, 255]));

  // Width limit of 100 should create:
  // Row 1: png1 (80), then try adding png2 (80): 80 + 80 = 160 > 100, so no
  // Row 2: png2 (80), then try adding png3 (5): 80 + 5 = 85 <= 100, so yes
  // Final layout: Row 1 = [png1] (80px), Row 2 = [png2, png3] (85px)
  // totalWidth = 85 (max of 80 and 85)
  const result = await concat({
    inputs: [png1, png2, png3],
    layout: { width: 100 }
  });

  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);
  const pixelData = await extractPixelData(chunks, header);

  assert.strictEqual(header.width, 85); // Max of row widths
  assert.strictEqual(header.height, 50); // 25 + 25 (two rows)
  assert.strictEqual(pixelData.length, 85 * 50 * 4);
});

test('concat with width and height limits', async () => {
  // Test both width and height limits together
  const png1 = await createTestPng(40, 30, new Uint8Array([255, 0, 0, 255]));
  const png2 = await createTestPng(40, 30, new Uint8Array([0, 255, 0, 255]));
  const png3 = await createTestPng(40, 30, new Uint8Array([0, 0, 255, 255]));
  const png4 = await createTestPng(40, 30, new Uint8Array([255, 255, 0, 255]));

  // Width limit 70, height limit 50 should create:
  // Row 1: png1 (40) + png2 (40) = 80 > 70, so only png1, height = 30
  // Row 2: png2 (40), height = 30, total = 60 > 50
  // So only row 1 fits
  const result = await concat({
    inputs: [png1, png2, png3, png4],
    layout: { width: 70, height: 50 }
  });

  const header = parsePngHeader(result);
  const chunks = parsePngChunks(result);
  const pixelData = await extractPixelData(chunks, header);

  assert.ok(header.width <= 70, 'Width should respect limit');
  assert.ok(header.height <= 50, 'Height should respect limit');
  assert.strictEqual(pixelData.length, header.width * header.height * 4);
});
