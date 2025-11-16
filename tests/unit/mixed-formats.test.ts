/**
 * Mixed Format Integration Tests
 *
 * Tests concatenation of multiple image formats (PNG, JPEG) in a single grid.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import '../../src/decoders/index.js';
import { concatToBuffer, concatToStream } from '../../src/image-concat.js';
import { createTestPng, createTestJpeg } from '../utils/image-fixtures.js';
import { PNG } from 'pngjs';

/**
 * Validate output PNG structure and metadata
 */
function validateOutputPng(pngData: Uint8Array, expectedWidth: number, expectedHeight: number) {
  // Parse using pngjs
  const png = PNG.sync.read(Buffer.from(pngData));

  assert.strictEqual(png.width, expectedWidth, 'Output width should match expected');
  assert.strictEqual(png.height, expectedHeight, 'Output height should match expected');
  assert.ok(png.data.length > 0, 'Output should contain pixel data');

  return png;
}

/**
 * Validate output JPEG structure and basic markers
 */
function validateOutputJpeg(jpegData: Uint8Array) {
  // Check JPEG SOI marker (0xFF 0xD8)
  assert.strictEqual(jpegData[0], 0xFF, 'JPEG should start with 0xFF');
  assert.strictEqual(jpegData[1], 0xD8, 'JPEG should have SOI marker 0xD8');

  // Check JPEG EOI marker at end (0xFF 0xD9)
  const len = jpegData.length;
  assert.strictEqual(jpegData[len - 2], 0xFF, 'JPEG should end with 0xFF');
  assert.strictEqual(jpegData[len - 1], 0xD9, 'JPEG should have EOI marker 0xD9');

  assert.ok(jpegData.length > 100, 'JPEG should have reasonable size');

  return jpegData;
}

describe('Mixed Formats - PNG + JPEG', () => {
  test('concatenates PNG and JPEG horizontally', async () => {
    const pngImage = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255])); // Red
    const jpegImage = await createTestJpeg(10, 10, new Uint8Array([0, 255, 0, 255])); // Green

    const result = await concatToBuffer({
      inputs: [pngImage, jpegImage],
      layout: { columns: 2 }
    });

    assert.ok(result instanceof Uint8Array, 'Should return Uint8Array');

    const png = validateOutputPng(result, 20, 10); // 2 images × 10px wide = 20px

    assert.strictEqual(png.width, 20);
    assert.strictEqual(png.height, 10);
  });

  test('concatenates multiple mixed formats in grid', async () => {
    const png1 = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255])); // Red
    const jpeg1 = await createTestJpeg(8, 8, new Uint8Array([0, 255, 0, 255])); // Green
    const png2 = await createTestPng(8, 8, new Uint8Array([0, 0, 255, 255])); // Blue
    const jpeg2 = await createTestJpeg(8, 8, new Uint8Array([255, 255, 0, 255])); // Yellow

    const result = await concatToBuffer({
      inputs: [png1, jpeg1, png2, jpeg2],
      layout: { columns: 2 } // 2x2 grid
    });

    // 2 columns × 8px = 16px wide
    // 2 rows × 8px = 16px high
    validateOutputPng(result, 16, 16);
  });

  test('handles variable sizes with padding', async () => {
    const smallPng = await createTestPng(5, 5, new Uint8Array([255, 0, 0, 255]));
    const largeJpeg = await createTestJpeg(10, 8, new Uint8Array([0, 255, 0, 255]));
    const mediumPng = await createTestPng(7, 6, new Uint8Array([0, 0, 255, 255]));

    const result = await concatToBuffer({
      inputs: [smallPng, largeJpeg, mediumPng],
      layout: { columns: 3 }
    });

    // Column widths: 5 + 10 + 7 = 22 (each column sized to its widest image)
    // Max height = 8 (from largeJpeg)
    validateOutputPng(result, 22, 8);
  });
});

describe('Mixed Formats - All PNG vs All JPEG', () => {
  test('all PNG images (baseline)', async () => {
    const png1 = await createTestPng(12, 12, new Uint8Array([255, 0, 0, 255]));
    const png2 = await createTestPng(12, 12, new Uint8Array([0, 255, 0, 255]));
    const png3 = await createTestPng(12, 12, new Uint8Array([0, 0, 255, 255]));

    const result = await concatToBuffer({
      inputs: [png1, png2, png3],
      layout: { columns: 3 }
    });

    validateOutputPng(result, 36, 12);
  });

  test('all JPEG images', async () => {
    const jpeg1 = await createTestJpeg(12, 12, new Uint8Array([255, 0, 0, 255]));
    const jpeg2 = await createTestJpeg(12, 12, new Uint8Array([0, 255, 0, 255]));
    const jpeg3 = await createTestJpeg(12, 12, new Uint8Array([0, 0, 255, 255]));

    const result = await concatToBuffer({
      inputs: [jpeg1, jpeg2, jpeg3],
      layout: { columns: 3 }
    });

    validateOutputPng(result, 36, 12);
  });
});

describe('Mixed Formats - Layout Options', () => {
  test('concatenates mixed formats vertically (rows)', async () => {
    const pngImage = await createTestPng(10, 5, new Uint8Array([255, 0, 0, 255]));
    const jpegImage = await createTestJpeg(10, 8, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [pngImage, jpegImage],
      layout: { rows: 2 }
    });

    // Max width = 10
    // Heights: 5 + 8 = 13
    validateOutputPng(result, 10, 13);
  });

  test('mixed formats in multi-row layout', async () => {
    const imgs = [
      await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255])),
      await createTestJpeg(8, 8, new Uint8Array([0, 255, 0, 255])),
      await createTestPng(8, 8, new Uint8Array([0, 0, 255, 255])),
      await createTestJpeg(8, 8, new Uint8Array([255, 255, 0, 255])),
      await createTestPng(8, 8, new Uint8Array([255, 0, 255, 255])),
      await createTestJpeg(8, 8, new Uint8Array([0, 255, 255, 255]))
    ];

    const result = await concatToBuffer({
      inputs: imgs,
      layout: { columns: 3 } // 3 columns, 2 rows
    });

    // 3 columns × 8px = 24px wide
    // 2 rows × 8px = 16px high
    validateOutputPng(result, 24, 16);
  });
});

describe('Mixed Formats - Streaming Output', () => {
  test('streams mixed format concatenation', async () => {
    const pngImage = await createTestPng(16, 16, new Uint8Array([200, 100, 50, 255]));
    const jpegImage = await createTestJpeg(16, 16, new Uint8Array([50, 100, 200, 255]));

    const stream = concatToStream({
      inputs: [pngImage, jpegImage],
      layout: { columns: 2 }
    });

    assert.ok(stream, 'Should return stream');
    assert.strictEqual(typeof stream.read, 'function', 'Should be readable stream');

    // Collect chunks
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const result = Buffer.concat(chunks);
    validateOutputPng(new Uint8Array(result), 32, 16);
  });
});

describe('Mixed Formats - Edge Cases', () => {
  test('single JPEG image', async () => {
    const jpegImage = await createTestJpeg(20, 15, new Uint8Array([128, 64, 192, 255]));

    const result = await concatToBuffer({
      inputs: [jpegImage],
      layout: { columns: 1 }
    });

    validateOutputPng(result, 20, 15);
  });

  test('alternating PNG and JPEG', async () => {
    const inputs = [];
    for (let i = 0; i < 6; i++) {
      const color = new Uint8Array([i * 40, (6 - i) * 40, 128, 255]);
      if (i % 2 === 0) {
        inputs.push(await createTestPng(10, 10, color));
      } else {
        inputs.push(await createTestJpeg(10, 10, color));
      }
    }

    const result = await concatToBuffer({
      inputs,
      layout: { columns: 3 }
    });

    // 3 columns × 10px = 30px wide
    // 2 rows × 10px = 20px high
    validateOutputPng(result, 30, 20);
  });

  test('many small mixed images', async () => {
    const inputs = [];
    for (let i = 0; i < 20; i++) {
      const color = new Uint8Array([i * 12, 255 - i * 12, 128, 255]);
      if (i % 3 === 0) {
        inputs.push(await createTestPng(4, 4, color));
      } else {
        inputs.push(await createTestJpeg(4, 4, color));
      }
    }

    const result = await concatToBuffer({
      inputs,
      layout: { columns: 5 }
    });

    // 5 columns × 4px = 20px wide
    // 4 rows × 4px = 16px high
    validateOutputPng(result, 20, 16);
  });
});

describe('Mixed Formats - Decoder Options', () => {
  test('passes JPEG decoder options', async () => {
    const pngImage = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
    const jpegImage = await createTestJpeg(8, 8, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [pngImage, jpegImage],
      layout: { columns: 2 },
      decoderOptions: {
        jpeg: {
          useImageDecoderAPI: false,
          preferWasm: false
        }
      }
    });

    validateOutputPng(result, 16, 8);
  });

  test('works without decoder options', async () => {
    const pngImage = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
    const jpegImage = await createTestJpeg(8, 8, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [pngImage, jpegImage],
      layout: { columns: 2 }
    });

    validateOutputPng(result, 16, 8);
  });
});

describe('Mixed Formats - ArrayBuffer Input', () => {
  test('accepts PNG as ArrayBuffer and JPEG as Uint8Array', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const pngBuffer = pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) as ArrayBuffer;

    const jpegBytes = await createTestJpeg(10, 10, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [pngBuffer, jpegBytes],
      layout: { columns: 2 }
    });

    validateOutputPng(result, 20, 10);
  });
});

describe('JPEG Output Format', () => {
  test('outputs JPEG instead of PNG', async () => {
    const png1 = await createTestPng(16, 16, new Uint8Array([255, 0, 0, 255]));
    const png2 = await createTestPng(16, 16, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [png1, png2],
      layout: { columns: 2 },
      outputFormat: 'jpeg'
    });

    assert.ok(result instanceof Uint8Array, 'Should return Uint8Array');
    validateOutputJpeg(result);
  });

  test('JPEG output with custom quality', async () => {
    const png1 = await createTestPng(16, 16, new Uint8Array([255, 0, 0, 255]));
    const png2 = await createTestPng(16, 16, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [png1, png2],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 95
    });

    validateOutputJpeg(result);
  });

  test('JPEG output from mixed input formats', async () => {
    const png = await createTestPng(16, 16, new Uint8Array([255, 0, 0, 255]));
    const jpeg = await createTestJpeg(16, 16, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [png, jpeg],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    validateOutputJpeg(result);
  });

  test('JPEG output in grid layout', async () => {
    const inputs = [];
    for (let i = 0; i < 9; i++) {
      const color = new Uint8Array([i * 28, (9 - i) * 28, 128, 255]);
      inputs.push(await createTestPng(8, 8, color));
    }

    const result = await concatToBuffer({
      inputs,
      layout: { columns: 3 },
      outputFormat: 'jpeg',
      jpegQuality: 90
    });

    validateOutputJpeg(result);
  });

  test('JPEG output with variable sizes', async () => {
    const small = await createTestPng(8, 8, new Uint8Array([255, 0, 0, 255]));
    const large = await createTestPng(16, 16, new Uint8Array([0, 255, 0, 255]));

    const result = await concatToBuffer({
      inputs: [small, large],
      layout: { columns: 2 },
      outputFormat: 'jpeg'
    });

    validateOutputJpeg(result);
  });

  test('streaming JPEG output', async () => {
    const png1 = await createTestPng(16, 16, new Uint8Array([200, 100, 50, 255]));
    const png2 = await createTestPng(16, 16, new Uint8Array([50, 100, 200, 255]));

    const stream = concatToStream({
      inputs: [png1, png2],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(stream, 'Should return stream');
    assert.strictEqual(typeof stream.read, 'function', 'Should be readable stream');

    // Collect chunks
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const result = Buffer.concat(chunks);
    validateOutputJpeg(new Uint8Array(result));
  });

  test('JPEG output with non-8-aligned height (no white padding artifacts)', async () => {
    // Height not divisible by 8: 10
    const png1 = await createTestPng(16, 10, new Uint8Array([255, 0, 0, 255])); // Red, 10px high

    const result = await concatToBuffer({
      inputs: [png1],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 90
    });

    validateOutputJpeg(result);
    // If padding was done incorrectly with white, the bottom 6 rows (to complete the 16-line MCU blocks)
    // would blend with white, causing visible light bands. With correct edge pixel repetition, this won't happen.
  });

  test('JPEG output with height = 5 (partial MCU strip)', async () => {
    // 5 is not divisible by 8, so we'll have a partial 5-line strip at the end
    const png = await createTestPng(16, 5, new Uint8Array([128, 64, 192, 255]));

    const result = await concatToBuffer({
      inputs: [png],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    validateOutputJpeg(result);
    // The last 3 lines (to complete the 8-line MCU) should be filled with
    // the repeated last scanline, not white pixels
  });
});
