import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import './decoders/index.js';
import { concat } from './image-concat.js';
import { ColorType } from './types.js';

/**
 * PngSuite Integration Tests
 *
 * PngSuite is a comprehensive test suite created by Willem van Schaik
 * that contains 175+ PNG test images covering various formats and edge cases.
 *
 * These tests validate that our PNG library can correctly parse and process
 * the diverse PNG formats in the suite.
 *
 * File naming convention in PngSuite:
 * - First character(s): test feature (e.g., 'bas' = basic, 'g' = gamma, 's' = size)
 * - 'i' or 'n': interlaced or non-interlaced
 * - Color type: 0g (grayscale), 2c (RGB), 3p (indexed), 4a (gray+alpha), 6a (RGBA)
 * - Bit depth: 01, 02, 04, 08, 16
 */

const PNGSUITE_PATH = join(process.cwd(), 'pngsuite', 'png');

// Helper to load a PngSuite test image
function loadPngSuite(filename: string): Uint8Array {
  const path = join(PNGSUITE_PATH, filename);
  return new Uint8Array(readFileSync(path));
}

// Helper to check if file exists and can be loaded
function canLoadPngSuite(filename: string): boolean {
  try {
    loadPngSuite(filename);
    return true;
  } catch {
    return false;
  }
}

// Test basic non-interlaced images (basn prefix)
test('PngSuite: Parse basic grayscale 8-bit (basn0g08.png)', () => {
  const png = loadPngSuite('basn0g08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.GRAYSCALE);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic grayscale 16-bit (basn0g16.png)', () => {
  const png = loadPngSuite('basn0g16.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.GRAYSCALE);
  assert.strictEqual(header.bitDepth, 16);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic RGB 8-bit (basn2c08.png)', () => {
  const png = loadPngSuite('basn2c08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGB);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic RGB 16-bit (basn2c16.png)', () => {
  const png = loadPngSuite('basn2c16.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGB);
  assert.strictEqual(header.bitDepth, 16);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic grayscale+alpha 8-bit (basn4a08.png)', () => {
  const png = loadPngSuite('basn4a08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.GRAYSCALE_ALPHA);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic grayscale+alpha 16-bit (basn4a16.png)', () => {
  const png = loadPngSuite('basn4a16.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.GRAYSCALE_ALPHA);
  assert.strictEqual(header.bitDepth, 16);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic RGBA 8-bit (basn6a08.png)', () => {
  const png = loadPngSuite('basn6a08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 0);
});

test('PngSuite: Parse basic RGBA 16-bit (basn6a16.png)', () => {
  const png = loadPngSuite('basn6a16.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 16);
  assert.strictEqual(header.interlaceMethod, 0);
});

// Test interlaced images (basi prefix)
test('PngSuite: Parse interlaced grayscale 8-bit (basi0g08.png)', () => {
  const png = loadPngSuite('basi0g08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.GRAYSCALE);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 1); // Adam7 interlacing
});

test('PngSuite: Parse interlaced RGB 8-bit (basi2c08.png)', () => {
  const png = loadPngSuite('basi2c08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGB);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 1);
});

test('PngSuite: Parse interlaced RGBA 8-bit (basi6a08.png)', () => {
  const png = loadPngSuite('basi6a08.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
  assert.strictEqual(header.interlaceMethod, 1);
});

// Test size variations (s prefix)
test('PngSuite: Parse 1x1 pixel image (s01n3p01.png)', () => {
  if (!canLoadPngSuite('s01n3p01.png')) {
    // Skip if file doesn't exist
    return;
  }

  const png = loadPngSuite('s01n3p01.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 1);
  assert.strictEqual(header.height, 1);
});

test('PngSuite: Parse 9x9 pixel image (s09n3p02.png)', () => {
  if (!canLoadPngSuite('s09n3p02.png')) {
    return;
  }

  const png = loadPngSuite('s09n3p02.png');
  const header = parsePngHeader(png);

  assert.strictEqual(header.width, 9);
  assert.strictEqual(header.height, 9);
});

// Test chunk reading
test('PngSuite: All basic images have valid chunks', () => {
  const basicFiles = [
    'basn0g08.png',
    'basn2c08.png',
    'basn4a08.png',
    'basn6a08.png'
  ];

  for (const filename of basicFiles) {
    const png = loadPngSuite(filename);
    const chunks = parsePngChunks(png);

    // Should have at least IHDR, IDAT, and IEND
    assert.ok(chunks.length >= 3, `${filename} should have at least 3 chunks`);
    assert.strictEqual(chunks[0].type, 'IHDR', `${filename} should start with IHDR`);
    assert.strictEqual(chunks[chunks.length - 1].type, 'IEND', `${filename} should end with IEND`);

    // Should have at least one IDAT chunk
    const hasIDAT = chunks.some(chunk => chunk.type === 'IDAT');
    assert.ok(hasIDAT, `${filename} should have IDAT chunk(s)`);
  }
});

// Test concatenation with PngSuite images
test('PngSuite: Concatenate two identical grayscale images', async () => {
  const png1 = loadPngSuite('basn0g08.png');
  const png2 = loadPngSuite('basn0g08.png');

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 64); // 32 * 2
  assert.strictEqual(header.height, 32);
  // Now converts to RGBA for consistency
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
});

test('PngSuite: Concatenate two identical RGB images', async () => {
  const png1 = loadPngSuite('basn2c08.png');
  const png2 = loadPngSuite('basn2c08.png');

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 64); // 32 * 2
  assert.strictEqual(header.height, 32);
  // Now converts to RGBA for consistency
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
});

test('PngSuite: Concatenate two identical RGBA images', async () => {
  const png1 = loadPngSuite('basn6a08.png');
  const png2 = loadPngSuite('basn6a08.png');

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 64); // 32 * 2
  assert.strictEqual(header.height, 32);
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
});

test('PngSuite: Concatenate four RGBA images in a 2x2 grid', async () => {
  const png = loadPngSuite('basn6a08.png');

  const result = await concat({
    inputs: [png, png, png, png],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 64); // 32 * 2
  assert.strictEqual(header.height, 64); // 32 * 2
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
});

test('PngSuite: Concatenate 16-bit RGB images', async () => {
  const png1 = loadPngSuite('basn2c16.png');
  const png2 = loadPngSuite('basn2c16.png');

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 64); // 32 * 2
  assert.strictEqual(header.height, 32);
  // Now converts to RGBA for consistency
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 16);
});

test('PngSuite: Concatenate vertical layout', async () => {
  const png1 = loadPngSuite('basn6a08.png');
  const png2 = loadPngSuite('basn6a08.png');
  const png3 = loadPngSuite('basn6a08.png');

  const result = await concat({
    inputs: [png1, png2, png3],
    layout: { rows: 3 }
  });

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 32);
  assert.strictEqual(header.height, 96); // 32 * 3
  assert.strictEqual(header.colorType, ColorType.RGBA);
  assert.strictEqual(header.bitDepth, 8);
});

// Test that interlaced PNGs work correctly
test('PngSuite: Concatenate interlaced grayscale PNG (basi0g08.png)', async () => {
  const png = loadPngSuite('basi0g08.png');

  // Verify it's parsed as interlaced
  const header = parsePngHeader(png);
  assert.strictEqual(header.interlaceMethod, 1);

  // Should successfully process interlaced image
  const result = await concat({
    inputs: [png],
    layout: { columns: 1 }
  });

  const resultHeader = parsePngHeader(result);
  assert.strictEqual(resultHeader.width, 32);
  assert.strictEqual(resultHeader.height, 32);
  assert.ok(result.length > 0, 'Result should have data');
});

test('PngSuite: Concatenate interlaced RGB PNG (basi2c08.png)', async () => {
  const png = loadPngSuite('basi2c08.png');

  const header = parsePngHeader(png);
  assert.strictEqual(header.interlaceMethod, 1);

  const result = await concat({
    inputs: [png],
    layout: { columns: 1 }
  });

  const resultHeader = parsePngHeader(result);
  assert.strictEqual(resultHeader.width, 32);
  assert.strictEqual(resultHeader.height, 32);
});

test('PngSuite: Concatenate two interlaced images', async () => {
  const png1 = loadPngSuite('basi0g08.png');
  const png2 = loadPngSuite('basi2c08.png');

  const result = await concat({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const resultHeader = parsePngHeader(result);
  assert.strictEqual(resultHeader.width, 64); // 32 * 2
  assert.strictEqual(resultHeader.height, 32);
  assert.strictEqual(resultHeader.colorType, ColorType.RGBA);
});

test('PngSuite: Mix interlaced and non-interlaced PNGs', async () => {
  const interlacedPng = loadPngSuite('basi0g08.png');
  const normalPng = loadPngSuite('basn0g08.png');

  // Should handle mixed interlaced and non-interlaced
  const result = await concat({
    inputs: [normalPng, interlacedPng],
    layout: { columns: 2 }
  });

  const resultHeader = parsePngHeader(result);
  assert.strictEqual(resultHeader.width, 64); // 32 * 2
  assert.strictEqual(resultHeader.height, 32);
});

// Summary test to validate available images
test('PngSuite: Verify basic test suite is available', () => {
  const requiredFiles = [
    'basn0g08.png',  // Grayscale 8-bit
    'basn0g16.png',  // Grayscale 16-bit
    'basn2c08.png',  // RGB 8-bit
    'basn2c16.png',  // RGB 16-bit
    'basn4a08.png',  // Grayscale+Alpha 8-bit
    'basn4a16.png',  // Grayscale+Alpha 16-bit
    'basn6a08.png',  // RGBA 8-bit
    'basn6a16.png',  // RGBA 16-bit
  ];

  for (const filename of requiredFiles) {
    assert.doesNotThrow(
      () => loadPngSuite(filename),
      `Required PngSuite file ${filename} should be available`
    );
  }
});
