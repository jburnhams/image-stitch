/**
 * Format Detection Tests
 *
 * Tests for automatic image format detection from magic bytes.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  detectImageFormat,
  detectFormat,
  validateFormat,
  readMagicBytes
} from '../decoders/format-detection.js';
import { createMagicBytesTest, createTestPng, createTestJpeg } from '../test-utils/image-fixtures.js';

describe('Format Detection - Magic Bytes', () => {
  test('detects PNG format from signature', () => {
    const pngBytes = createMagicBytesTest('png');
    const format = detectImageFormat(pngBytes);
    assert.strictEqual(format, 'png', 'Should detect PNG format');
  });

  test('detects JPEG format from SOI marker', () => {
    const jpegBytes = createMagicBytesTest('jpeg');
    const format = detectImageFormat(jpegBytes);
    assert.strictEqual(format, 'jpeg', 'Should detect JPEG format');
  });

  test('detects HEIC format from ftyp box', () => {
    const heicBytes = createMagicBytesTest('heic');
    const format = detectImageFormat(heicBytes);
    assert.strictEqual(format, 'heic', 'Should detect HEIC format');
  });

  test('returns unknown for invalid format', () => {
    const invalidBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const format = detectImageFormat(invalidBytes);
    assert.strictEqual(format, 'unknown', 'Should return unknown for invalid format');
  });

  test('handles truncated input gracefully', () => {
    const truncated = new Uint8Array([0x89, 0x50]); // Incomplete PNG signature
    const format = detectImageFormat(truncated);
    assert.strictEqual(format, 'unknown', 'Should return unknown for truncated input');
  });

  test('detects PNG from real image bytes', async () => {
    const pngImage = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const format = detectImageFormat(pngImage);
    assert.strictEqual(format, 'png', 'Should detect PNG from real image');
  });

  test('detects JPEG from real image bytes', async () => {
    const jpegImage = await createTestJpeg(10, 10, new Uint8Array([0, 255, 0, 255]));
    const format = detectImageFormat(jpegImage);
    assert.strictEqual(format, 'jpeg', 'Should detect JPEG from real image');
  });
});

describe('Format Detection - detectFormat function', () => {
  test('detects format from Uint8Array', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const format = await detectFormat(pngBytes);
    assert.strictEqual(format, 'png');
  });

  test('detects format from ArrayBuffer', async () => {
    const pngBytes = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const buffer = pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) as ArrayBuffer;
    const format = await detectFormat(buffer);
    assert.strictEqual(format, 'png');
  });
});

describe('Format Validation', () => {
  test('validateFormat accepts valid formats', () => {
    assert.doesNotThrow(() => validateFormat('png'));
    assert.doesNotThrow(() => validateFormat('jpeg'));
    assert.doesNotThrow(() => validateFormat('heic'));
  });

  test('validateFormat rejects unknown format', () => {
    assert.throws(
      () => validateFormat('unknown'),
      /Unknown or unsupported image format/,
      'Should throw for unknown format'
    );
  });
});

describe('Magic Bytes Reading', () => {
  test('reads magic bytes from Uint8Array', async () => {
    const fullImage = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));
    const magicBytes = await readMagicBytes(fullImage);

    assert.strictEqual(magicBytes.length, 32, 'Should read 32 bytes');
    assert.strictEqual(magicBytes[0], 0x89, 'Should have correct first byte');
    assert.strictEqual(magicBytes[1], 0x50, 'Should have correct second byte');
  });

  test('reads magic bytes from ArrayBuffer', async () => {
    const fullImage = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const buffer = fullImage.buffer.slice(fullImage.byteOffset, fullImage.byteOffset + fullImage.byteLength) as ArrayBuffer;
    const magicBytes = await readMagicBytes(buffer);

    assert.ok(magicBytes instanceof Uint8Array, 'Should return Uint8Array');
    assert.ok(magicBytes.length <= 32, 'Should read up to 32 bytes');
  });

  test('handles small files correctly', async () => {
    const smallBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const magicBytes = await readMagicBytes(smallBytes);

    assert.strictEqual(magicBytes.length, 4, 'Should read available bytes');
  });
});

describe('HEIC Brand Variations', () => {
  test('detects heic brand', () => {
    const heicBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x68, 0x65, 0x69, 0x63, // heic
      ...new Array(20).fill(0)
    ]);
    assert.strictEqual(detectImageFormat(heicBytes), 'heic');
  });

  test('detects heix brand', () => {
    const heixBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x68, 0x65, 0x69, 0x78, // heix
      ...new Array(20).fill(0)
    ]);
    assert.strictEqual(detectImageFormat(heixBytes), 'heic');
  });

  test('detects mif1 brand (HEIF)', () => {
    const mif1Bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x6d, 0x69, 0x66, 0x31, // mif1
      ...new Array(20).fill(0)
    ]);
    assert.strictEqual(detectImageFormat(mif1Bytes), 'heic');
  });
});

describe('JPEG Marker Variations', () => {
  test('detects JPEG with JFIF marker (FF D8 FF E0)', () => {
    const jfifBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(28).fill(0)]);
    assert.strictEqual(detectImageFormat(jfifBytes), 'jpeg');
  });

  test('detects JPEG with EXIF marker (FF D8 FF E1)', () => {
    const exifBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...new Array(28).fill(0)]);
    assert.strictEqual(detectImageFormat(exifBytes), 'jpeg');
  });

  test('detects JPEG with generic marker', () => {
    const genericBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, ...new Array(28).fill(0)]);
    assert.strictEqual(detectImageFormat(genericBytes), 'jpeg');
  });
});
