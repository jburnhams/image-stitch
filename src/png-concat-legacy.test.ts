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

test('concatPngs supports arbitrary dimensions with padding', async () => {
  // This test verifies that images with different dimensions now work
  const png1 = createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  // Should use max width of images in each column (20 + 20 = 40)
  // and max height of row (20)
  assert.strictEqual(header.width, 30); // 10 + 20
  assert.strictEqual(header.height, 20); // max(10, 20)
  assert.strictEqual(header.colorType, ColorType.RGBA);
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

// ===== NEW TESTS FOR ARBITRARY IMAGE SIZES =====

test('concatPngs with different heights in same row', async () => {
  const png1 = createTestPng(10, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 15, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));

  const result = await concatPngs({
    inputs: [png1, png2, png3],
    layout: { columns: 3 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 30); // 10 + 10 + 10
  assert.strictEqual(header.height, 15); // max(5, 15, 10)
});

test('concatPngs with different widths in same column', async () => {
  const png1 = createTestPng(5, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(15, 10, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { rows: 2 }
  });

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

  const result = await concatPngs({
    inputs: [png1, png2, png3, png4],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  // Row 1: max width col0=10, col1=20, height=max(10,15)=15
  // Row 2: max width col0=15, col1=25, height=max(20,25)=25
  // Total width: max(10+20, 15+25) = 40
  // Total height: 15 + 25 = 40
  assert.strictEqual(header.width, 40);
  assert.strictEqual(header.height, 40);
});

test('concatPngs with pixel width limit wraps to new row', async () => {
  const png1 = createTestPng(30, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(30, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(30, 10, new Uint8Array([0, 0, 255, 255]));

  const result = await concatPngs({
    inputs: [png1, png2, png3],
    layout: { width: 70 } // Can fit 2 images per row (30+30=60 < 70)
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 60); // 30 + 30 (row 1 has 2 images)
  assert.strictEqual(header.height, 20); // 10 (row 1) + 10 (row 2)
});

test('concatPngs with pixel height limit stops adding rows', async () => {
  const png1 = createTestPng(10, 30, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 30, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(10, 30, new Uint8Array([0, 0, 255, 255]));

  const result = await concatPngs({
    inputs: [png1, png2, png3],
    layout: { height: 70, columns: 1 } // Can fit 2 images (30+30=60 < 70)
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 60); // Only 2 images fit
});

test('concatPngs with mixed sizes and transparent padding', async () => {
  // Small and large images - should pad with transparency
  const png1 = createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(20, 20, new Uint8Array([0, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 25); // 5 + 20
  assert.strictEqual(header.height, 20); // max(5, 20)

  // Extract pixel data to verify padding (transparent for RGBA is 0,0,0,0)
  const chunks = parsePngChunks(result);
  const pixels = await import('./png-decompress.js').then(m => m.extractPixelData(chunks, header));

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

  const result = await concatPngs({
    inputs: [png1, png2, png3],
    layout: { columns: 1 } // Vertical stack
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 10);
  assert.strictEqual(header.height, 30); // 5 + 10 + 15
});

test('concatPngs with rows layout and variable widths', async () => {
  const png1 = createTestPng(5, 10, new Uint8Array([255, 0, 0, 255]));
  const png2 = createTestPng(10, 10, new Uint8Array([0, 255, 0, 255]));
  const png3 = createTestPng(15, 10, new Uint8Array([0, 0, 255, 255]));
  const png4 = createTestPng(20, 10, new Uint8Array([255, 255, 0, 255]));

  const result = await concatPngs({
    inputs: [png1, png2, png3, png4],
    layout: { rows: 2 } // 2 rows, 2 columns (column-first placement)
  });

  const header = parsePngHeader(result);
  // Column-first placement: Row 0: [png1(5), png3(15)], Row 1: [png2(10), png4(20)]
  // Col 0: max(5, 10) = 10
  // Col 1: max(15, 20) = 20
  // Total: 10 + 20 = 30
  assert.strictEqual(header.width, 30);
  assert.strictEqual(header.height, 20); // 10 + 10
});
