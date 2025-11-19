import { test } from 'node:test';
import assert from 'node:assert';
import '../../src/decoders/index.js';
import { concatToBuffer } from '../../src/image-concat.js';
import type { PositionedImage } from '../../src/decoders/types.js';
import { parsePngHeader } from '../../src/png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from '../../src/png-writer.js';
import { compressImageData } from '../../src/png-decompress.js';
import { PngHeader, ColorType } from '../../src/types.js';

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

test('Positioned images: non-overlapping layout', async () => {
  // Create test images
  const redImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));
  const greenImage = await createTestPng(50, 50, new Uint8Array([0, 255, 0, 255]));
  const blueImage = await createTestPng(75, 75, new Uint8Array([0, 0, 255, 255]));

  // Position images on canvas (non-overlapping)
  const inputs: PositionedImage[] = [
    { x: 0, y: 0, source: redImage },      // Top-left
    { x: 150, y: 0, source: greenImage },  // Top-right
    { x: 0, y: 150, source: blueImage }    // Bottom-left
  ];

  const result = await concatToBuffer({
    inputs,
    layout: {} // Layout is determined by positioned images
  });

  // Verify output
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 200); // 150 + 50
  assert.strictEqual(header.height, 225); // 150 + 75
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('Positioned images: overlapping with alpha blending', async () => {
  // Create semi-transparent test images
  const redImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 128])); // 50% transparent
  const blueImage = await createTestPng(100, 100, new Uint8Array([0, 0, 255, 128])); // 50% transparent

  // Position images to overlap
  const inputs: PositionedImage[] = [
    { x: 0, y: 0, source: redImage },
    { x: 50, y: 50, source: blueImage }  // Overlaps with red
  ];

  const result = await concatToBuffer({
    inputs,
    layout: {},
    enableAlphaBlending: true
  });

  // Verify output
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 150); // 50 + 100
  assert.strictEqual(header.height, 150); // 50 + 100
  assert.strictEqual(header.colorType, ColorType.RGBA);
});

test('Positioned images: explicit canvas size', async () => {
  const redImage = await createTestPng(50, 50, new Uint8Array([255, 0, 0, 255]));

  // Position image in center of 200x200 canvas
  const inputs: PositionedImage[] = [
    { x: 75, y: 75, source: redImage }
  ];

  const result = await concatToBuffer({
    inputs,
    layout: {
      width: 200,
      height: 200
    }
  });

  // Verify output
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 200);
  assert.strictEqual(header.height, 200);
});

test('Positioned images: clipping outside canvas', async () => {
  const redImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));

  // Position image partially outside canvas (should be clipped)
  const inputs: PositionedImage[] = [
    { x: -25, y: -25, source: redImage }  // 25px outside on left and top
  ];

  const result = await concatToBuffer({
    inputs,
    layout: {
      width: 100,
      height: 100
    }
  });

  // Verify output - should be 100x100 with only visible portion
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 100);
  assert.strictEqual(header.height, 100);
});

test('Positioned images: JPEG output', async () => {
  const redImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));
  const blueImage = await createTestPng(100, 100, new Uint8Array([0, 0, 255, 255]));

  const inputs: PositionedImage[] = [
    { x: 0, y: 0, source: redImage },
    { x: 100, y: 0, source: blueImage }
  ];

  const result = await concatToBuffer({
    inputs,
    layout: {},
    outputFormat: 'jpeg',
    jpegQuality: 90
  });

  // Verify JPEG output (starts with FF D8 FF)
  assert.strictEqual(result[0], 0xFF);
  assert.strictEqual(result[1], 0xD8);
  assert.strictEqual(result[2], 0xFF);
});

test('Positioned images: cannot mix with non-positioned', async () => {
  const redImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));
  const blueImage = await createTestPng(100, 100, new Uint8Array([0, 0, 255, 255]));

  const inputs = [
    { x: 0, y: 0, source: redImage },  // Positioned
    blueImage  // Non-positioned
  ];

  await assert.rejects(
    async () => {
      await concatToBuffer({
        inputs,
        layout: { columns: 2 }
      });
    },
    (err: Error) => {
      return err.message.includes('Cannot mix positioned and non-positioned');
    }
  );
});

test('Positioned images: no alpha blending (replace mode)', async () => {
  const redImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));
  const blueImage = await createTestPng(100, 100, new Uint8Array([0, 0, 255, 255]));

  // Position images to overlap
  const inputs: PositionedImage[] = [
    { x: 0, y: 0, source: redImage },
    { x: 50, y: 50, source: blueImage }
  ];

  const result = await concatToBuffer({
    inputs,
    layout: {},
    enableAlphaBlending: false  // Replace mode (faster)
  });

  // Verify output
  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 150);
  assert.strictEqual(header.height, 150);
});
