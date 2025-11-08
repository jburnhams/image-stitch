/**
 * Decoder Factory Tests
 *
 * Tests for automatic decoder creation and format detection.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createDecoder,
  createDecoders,
  PngBufferDecoder,
  JpegBufferDecoder,
  pngDecoder,
  jpegDecoder,
  heicDecoder
} from '../decoders/index.js';
import {
  clearDefaultDecoderPlugins,
  setDefaultDecoderPlugins
} from '../decoders/plugin-registry.js';
import { createTestPng, createTestJpeg } from '../test-utils/image-fixtures.js';

describe('Decoder Factory - createDecoder', () => {
  test('creates PNG decoder from PNG bytes', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const decoder = await createDecoder(pngBytes);

    assert.ok(decoder, 'Should create decoder');
    assert.ok(decoder instanceof PngBufferDecoder, 'Should be PNG decoder');

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'png');
    assert.strictEqual(header.width, 10);
    assert.strictEqual(header.height, 10);

    await decoder.close();
  });

  test('creates JPEG decoder from JPEG bytes', async () => {
    const jpegBytes = await createTestJpeg(20, 20, new Uint8Array([0, 255, 0, 255]));
    const decoder = await createDecoder(jpegBytes);

    assert.ok(decoder, 'Should create decoder');
    assert.ok(decoder instanceof JpegBufferDecoder, 'Should be JPEG decoder');

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'jpeg');
    assert.strictEqual(header.width, 20);
    assert.strictEqual(header.height, 20);

    await decoder.close();
  });

  test('creates decoder from ArrayBuffer', async () => {
    const pngBytes = await createTestPng(15, 15, new Uint8Array([0, 0, 255, 255]));
    const buffer = pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) as ArrayBuffer;

    const decoder = await createDecoder(buffer);

    assert.ok(decoder instanceof PngBufferDecoder);

    const header = await decoder.getHeader();
    assert.strictEqual(header.width, 15);
    assert.strictEqual(header.height, 15);

    await decoder.close();
  });

  test('auto-registers PNG decoder when defaults are cleared', async () => {
    clearDefaultDecoderPlugins();

    try {
      const pngBytes = await createTestPng(6, 4, new Uint8Array([255, 255, 255, 255]));
      const decoder = await createDecoder(pngBytes);

      assert.ok(decoder instanceof PngBufferDecoder);

      await decoder.close();
    } finally {
      setDefaultDecoderPlugins([pngDecoder, jpegDecoder, heicDecoder]);
    }
  });

  test('returns existing decoder instance as-is', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const originalDecoder = await createDecoder(pngBytes);

    const returnedDecoder = await createDecoder(originalDecoder);

    assert.strictEqual(returnedDecoder, originalDecoder, 'Should return same decoder instance');

    await originalDecoder.close();
  });

  test('throws error for unknown format', async () => {
    const invalidBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, ...new Array(28).fill(0)]);

    await assert.rejects(
      async () => await createDecoder(invalidBytes),
      /Unknown or unsupported image format/,
      'Should throw for unknown format'
    );
  });

  test('throws error for unsupported input type', async () => {
    await assert.rejects(
      async () => await createDecoder(123 as any),
      /Unsupported input type/,
      'Should throw for invalid input'
    );
  });

  test('supports explicit decoder plugin list', async () => {
    const jpegBytes = await createTestJpeg(12, 12, new Uint8Array([255, 255, 0, 255]));
    const decoder = await createDecoder(jpegBytes, {}, [jpegDecoder]);

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'jpeg');

    await decoder.close();
  });

  test('throws when plugin for format is missing', async () => {
    const jpegBytes = await createTestJpeg(8, 8, new Uint8Array([0, 0, 0, 255]));

    await assert.rejects(
      async () => await createDecoder(jpegBytes, {}, [pngDecoder]),
      /No decoder registered for format/,
      'Should throw when decoder plugin is unavailable'
    );
  });
});

describe('Decoder Factory - createDecoders (array)', () => {
  test('creates multiple decoders from mixed formats', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const jpegBytes = await createTestJpeg(20, 20, new Uint8Array([0, 255, 0, 255]));

    const decoders = await createDecoders([pngBytes, jpegBytes, pngBytes]);

    assert.strictEqual(decoders.length, 3, 'Should create 3 decoders');

    const headers = await Promise.all(decoders.map(d => d.getHeader()));

    assert.strictEqual(headers[0].format, 'png');
    assert.strictEqual(headers[0].width, 10);

    assert.strictEqual(headers[1].format, 'jpeg');
    assert.strictEqual(headers[1].width, 20);

    assert.strictEqual(headers[2].format, 'png');
    assert.strictEqual(headers[2].width, 10);

    // Cleanup
    await Promise.all(decoders.map(d => d.close()));
  });

  test('handles empty array', async () => {
    const decoders = await createDecoders([]);
    assert.strictEqual(decoders.length, 0, 'Should return empty array');
  });

  test('handles single decoder', async () => {
    const pngBytes = await createTestPng(5, 5, new Uint8Array([128, 128, 128, 255]));
    const decoders = await createDecoders([pngBytes]);

    assert.strictEqual(decoders.length, 1);

    const header = await decoders[0].getHeader();
    assert.strictEqual(header.width, 5);

    await decoders[0].close();
  });
});

describe('Decoder Factory - Format-specific options', () => {
  test('passes JPEG options to decoder', async () => {
    const jpegBytes = await createTestJpeg(10, 10, new Uint8Array([255, 0, 0, 255]));

    const decoder = await createDecoder(jpegBytes, {
      jpeg: {
        useImageDecoderAPI: false,
        preferWasm: true
      }
    });

    assert.ok(decoder instanceof JpegBufferDecoder);

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'jpeg');

    await decoder.close();
  });

  test('creates decoders without options', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));

    const decoder = await createDecoder(pngBytes);

    const header = await decoder.getHeader();
    assert.strictEqual(header.format, 'png');

    await decoder.close();
  });
});

describe('Decoder Factory - Scanline iteration', () => {
  test('PNG decoder yields correct scanlines', async () => {
    const width = 5;
    const height = 3;
    const pngBytes = await createTestPng(width, height, new Uint8Array([255, 0, 0, 255]));

    const decoder = await createDecoder(pngBytes);
    await decoder.getHeader(); // Load header

    let scanlineCount = 0;
    for await (const scanline of decoder.scanlines()) {
      assert.ok(scanline instanceof Uint8Array, 'Scanline should be Uint8Array');
      // PNG decoder returns scanlines in their native format (RGBA for this test)
      assert.ok(scanline.length > 0, 'Scanline should have data');
      scanlineCount++;
    }

    assert.strictEqual(scanlineCount, height, 'Should yield correct number of scanlines');

    await decoder.close();
  });

  test('JPEG decoder yields correct scanlines', async () => {
    const width = 8;
    const height = 8;
    const jpegBytes = await createTestJpeg(width, height, new Uint8Array([0, 255, 0, 255]));

    const decoder = await createDecoder(jpegBytes);

    let scanlineCount = 0;
    for await (const scanline of decoder.scanlines()) {
      assert.ok(scanline instanceof Uint8Array, 'Scanline should be Uint8Array');
      assert.strictEqual(
        scanline.length,
        width * 4, // RGBA
        'Scanline should have correct length'
      );
      scanlineCount++;
    }

    assert.strictEqual(scanlineCount, height, 'Should yield correct number of scanlines');

    await decoder.close();
  });

  test('can iterate scanlines multiple times after close/reopen', async () => {
    const pngBytes = await createTestPng(3, 3, new Uint8Array([128, 128, 128, 255]));

    // First iteration
    const decoder1 = await createDecoder(pngBytes);
    let count1 = 0;
    for await (const _ of decoder1.scanlines()) {
      count1++;
    }
    await decoder1.close();

    // Second iteration with new decoder
    const decoder2 = await createDecoder(pngBytes);
    let count2 = 0;
    for await (const _ of decoder2.scanlines()) {
      count2++;
    }
    await decoder2.close();

    assert.strictEqual(count1, 3);
    assert.strictEqual(count2, 3);
  });
});

describe('Decoder Factory - Header extraction', () => {
  test('extracts PNG header without full decode', async () => {
    const width = 100;
    const height = 100;
    const pngBytes = await createTestPng(width, height, new Uint8Array([255, 255, 0, 255]));

    const decoder = await createDecoder(pngBytes);
    const header = await decoder.getHeader();

    assert.strictEqual(header.width, width);
    assert.strictEqual(header.height, height);
    assert.strictEqual(header.channels, 4); // RGBA
    assert.strictEqual(header.bitDepth, 8);
    assert.strictEqual(header.format, 'png');

    await decoder.close();
  });

  test('extracts JPEG header without full decode', async () => {
    const width = 50;
    const height = 75;
    const jpegBytes = await createTestJpeg(width, height, new Uint8Array([200, 100, 50, 255]));

    const decoder = await createDecoder(jpegBytes);
    const header = await decoder.getHeader();

    assert.strictEqual(header.width, width);
    assert.strictEqual(header.height, height);
    assert.strictEqual(header.bitDepth, 8);
    assert.strictEqual(header.format, 'jpeg');

    await decoder.close();
  });
});
