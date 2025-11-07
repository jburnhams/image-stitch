/**
 * JPEG Decoder Tests
 *
 * Tests for JPEG image decoding with various formats and options.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { JpegBufferDecoder, JpegFileDecoder } from '../decoders/index.js';
import { createTestJpeg } from '../test-utils/image-fixtures.js';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('JPEG Decoder - Header Parsing', () => {
  test('parses JPEG header correctly', async () => {
    const jpegBytes = await createTestJpeg(64, 48, new Uint8Array([255, 128, 64, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    const header = await decoder.getHeader();

    assert.strictEqual(header.format, 'jpeg');
    assert.strictEqual(header.width, 64);
    assert.strictEqual(header.height, 48);
    assert.strictEqual(header.bitDepth, 8, 'JPEG is always 8-bit per channel');
    assert.strictEqual(header.channels, 4, 'Should decode to RGBA');

    await decoder.close();
  });

  test('handles square images', async () => {
    const jpegBytes = await createTestJpeg(32, 32, new Uint8Array([100, 150, 200, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    const header = await decoder.getHeader();

    assert.strictEqual(header.width, 32);
    assert.strictEqual(header.height, 32);

    await decoder.close();
  });

  test('handles different aspect ratios', async () => {
    const jpegBytes = await createTestJpeg(100, 50, new Uint8Array([200, 100, 50, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    const header = await decoder.getHeader();

    assert.strictEqual(header.width, 100);
    assert.strictEqual(header.height, 50);

    await decoder.close();
  });
});

describe('JPEG Decoder - Scanline Iteration', () => {
  test('yields correct number of scanlines', async () => {
    const width = 16;
    const height = 12;
    const jpegBytes = await createTestJpeg(width, height, new Uint8Array([255, 0, 0, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    let count = 0;
    for await (const scanline of decoder.scanlines()) {
      assert.ok(scanline instanceof Uint8Array);
      assert.strictEqual(scanline.length, width * 4, 'Scanline should be RGBA');
      count++;
    }

    assert.strictEqual(count, height, 'Should yield all scanlines');

    await decoder.close();
  });

  test('scanlines contain valid pixel data', async () => {
    const width = 8;
    const height = 8;
    const color = new Uint8Array([100, 150, 200, 255]);
    const jpegBytes = await createTestJpeg(width, height, color);
    const decoder = new JpegBufferDecoder(jpegBytes);

    let firstScanline: Uint8Array | null = null;
    for await (const scanline of decoder.scanlines()) {
      if (!firstScanline) {
        firstScanline = scanline;
      }

      // Check that scanline has pixel data (may not match exactly due to JPEG compression)
      assert.ok(scanline.some(byte => byte > 0), 'Scanline should contain non-zero pixel data');
    }

    assert.ok(firstScanline, 'Should have at least one scanline');

    await decoder.close();
  });

  test('can call scanlines() twice', async () => {
    const jpegBytes = await createTestJpeg(8, 8, new Uint8Array([255, 255, 0, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    // First iteration
    let count1 = 0;
    for await (const _ of decoder.scanlines()) {
      count1++;
    }

    // Second iteration (should re-decode)
    let count2 = 0;
    for await (const _ of decoder.scanlines()) {
      count2++;
    }

    assert.strictEqual(count1, 8);
    assert.strictEqual(count2, 8);

    await decoder.close();
  });
});

describe('JPEG Decoder - Memory Management', () => {
  test('close() releases decoded buffer', async () => {
    const jpegBytes = await createTestJpeg(50, 50, new Uint8Array([200, 100, 150, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    // Decode image
    await decoder.getHeader();
    for await (const _ of decoder.scanlines()) {
      // Iterate through all scanlines
    }

    // Close should release memory
    await decoder.close();

    // Should be able to call close multiple times
    await decoder.close();
    await decoder.close();

    assert.ok(true, 'Multiple close calls should not error');
  });

  test('can create new decoder after closing', async () => {
    const jpegBytes = await createTestJpeg(10, 10, new Uint8Array([100, 200, 50, 255]));

    const decoder1 = new JpegBufferDecoder(jpegBytes);
    const header1 = await decoder1.getHeader();
    await decoder1.close();

    const decoder2 = new JpegBufferDecoder(jpegBytes);
    const header2 = await decoder2.getHeader();
    await decoder2.close();

    assert.strictEqual(header1.width, header2.width);
    assert.strictEqual(header1.height, header2.height);
  });
});

describe('JPEG Decoder - File-based Input', () => {
  test('decodes JPEG from file path', async () => {
    const jpegBytes = await createTestJpeg(24, 16, new Uint8Array([150, 75, 225, 255]));

    // Write to temp file
    const tempPath = join(tmpdir(), `test-${Date.now()}.jpg`);
    await writeFile(tempPath, jpegBytes);

    try {
      const decoder = new JpegFileDecoder(tempPath);
      const header = await decoder.getHeader();

      assert.strictEqual(header.width, 24);
      assert.strictEqual(header.height, 16);
      assert.strictEqual(header.format, 'jpeg');

      let scanlineCount = 0;
      for await (const scanline of decoder.scanlines()) {
        assert.ok(scanline instanceof Uint8Array);
        scanlineCount++;
      }

      assert.strictEqual(scanlineCount, 16);

      await decoder.close();
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });
});

describe('JPEG Decoder - Decoder Options', () => {
  test('accepts decoder options without error', async () => {
    const jpegBytes = await createTestJpeg(16, 16, new Uint8Array([128, 128, 128, 255]));

    const decoder = new JpegBufferDecoder(jpegBytes, {
      useImageDecoderAPI: false,
      preferWasm: true
    });

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'jpeg');

    await decoder.close();
  });

  test('works with empty options', async () => {
    const jpegBytes = await createTestJpeg(16, 16, new Uint8Array([64, 192, 96, 255]));

    const decoder = new JpegBufferDecoder(jpegBytes, {});

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'jpeg');

    await decoder.close();
  });

  test('works without any options', async () => {
    const jpegBytes = await createTestJpeg(16, 16, new Uint8Array([255, 128, 64, 255]));

    const decoder = new JpegBufferDecoder(jpegBytes);

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'jpeg');

    await decoder.close();
  });
});

describe('JPEG Decoder - Color Variations', () => {
  test('decodes red image', async () => {
    const jpegBytes = await createTestJpeg(8, 8, new Uint8Array([255, 0, 0, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    let hasRedPixels = false;
    for await (const scanline of decoder.scanlines()) {
      // JPEG compression may not preserve exact colors, but should be predominantly red
      const avgRed = scanline.filter((_, i) => i % 4 === 0).reduce((a, b) => a + b, 0) / 8;
      if (avgRed > 100) {
        hasRedPixels = true;
      }
    }

    assert.ok(hasRedPixels, 'Should have red-ish pixels');

    await decoder.close();
  });

  test('decodes green image', async () => {
    const jpegBytes = await createTestJpeg(8, 8, new Uint8Array([0, 255, 0, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    let hasGreenPixels = false;
    for await (const scanline of decoder.scanlines()) {
      const avgGreen = scanline.filter((_, i) => i % 4 === 1).reduce((a, b) => a + b, 0) / 8;
      if (avgGreen > 100) {
        hasGreenPixels = true;
      }
    }

    assert.ok(hasGreenPixels, 'Should have green-ish pixels');

    await decoder.close();
  });

  test('decodes blue image', async () => {
    const jpegBytes = await createTestJpeg(8, 8, new Uint8Array([0, 0, 255, 255]));
    const decoder = new JpegBufferDecoder(jpegBytes);

    let hasBluePixels = false;
    for await (const scanline of decoder.scanlines()) {
      const avgBlue = scanline.filter((_, i) => i % 4 === 2).reduce((a, b) => a + b, 0) / 8;
      if (avgBlue > 100) {
        hasBluePixels = true;
      }
    }

    assert.ok(hasBluePixels, 'Should have blue-ish pixels');

    await decoder.close();
  });
});
