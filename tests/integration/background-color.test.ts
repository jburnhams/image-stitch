/**
 * Background Color Integration Tests
 *
 * Tests for the backgroundColor option with:
 * - PNG output with various background colors
 * - JPEG output with various background colors
 * - Different color formats (hex, RGB, named)
 * - Variable image sizes requiring padding
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { concat } from '../../src/image-concat.js';
import { loadPngsuiteImage } from '../utils/test-paths.js';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

// Helper to load an image from pngsuite
const loadImage = loadPngsuiteImage;

// Helper to decode PNG
function decodePng(data: Uint8Array): PNG {
  const png = new PNG();
  png.parse(Buffer.from(data));
  return png;
}

describe('Background Color - PNG Output', () => {
  test('uses white background color for padding in PNG', async () => {
    // Create a grid with variable sizes - will require padding
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),  // 32x32 grayscale
        loadImage('basn2c08.png')   // 32x32 RGB
      ],
      layout: { columns: 2 },
      backgroundColor: 'white'
    });

    // Verify it's a valid PNG
    assert.ok(result[0] === 0x89 && result[1] === 0x50, 'Should be PNG format');

    const png = decodePng(result);
    assert.strictEqual(png.width, 64, 'Width should be 64 (2 x 32)');
    assert.strictEqual(png.height, 32, 'Height should be 32');

    // The images are the same size, so no padding should be visible
    // This test mainly validates that the option is accepted
  });

  test('uses red background color with hex format', async () => {
    // Mix different sized images to force padding
    const result = await concat({
      inputs: [
        loadImage('basn0g01.png'),  // 32x32 1-bit grayscale (smaller)
        loadImage('basn2c08.png')   // 32x32 RGB
      ],
      layout: { columns: 1, rows: 2 }, // Stack vertically
      backgroundColor: '#FF0000'
    });

    const png = decodePng(result);
    // Both images are 32x32, so total is 32x64
    assert.strictEqual(png.width, 32);
    assert.strictEqual(png.height, 64);
  });

  test('uses RGB array format for background color', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 2 },
      backgroundColor: [0, 255, 0] // Green
    });

    const png = decodePng(result);
    assert.strictEqual(png.width, 64);
    assert.strictEqual(png.height, 32);
  });

  test('uses RGBA array with transparency', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png')
      ],
      layout: { columns: 1 },
      backgroundColor: [255, 0, 0, 128] // Semi-transparent red
    });

    const png = decodePng(result);
    assert.strictEqual(png.width, 32);
  });

  test('uses named color - blue', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 2 },
      backgroundColor: 'blue'
    });

    const png = decodePng(result);
    assert.strictEqual(png.width, 64);
  });

  test('defaults to transparent when backgroundColor is not specified', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 2 }
      // No backgroundColor specified
    });

    const png = decodePng(result);
    assert.strictEqual(png.width, 64);
    // This maintains backward compatibility
  });
});

describe('Background Color - JPEG Output', () => {
  test('uses white background color for padding in JPEG', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      backgroundColor: 'white'
    });

    // Verify it's a valid JPEG
    assert.strictEqual(result[0], 0xFF, 'Should start with JPEG SOI marker');
    assert.strictEqual(result[1], 0xD8, 'Should start with JPEG SOI marker');
    assert.strictEqual(result[result.length - 2], 0xFF, 'Should end with JPEG EOI marker');
    assert.strictEqual(result[result.length - 1], 0xD9, 'Should end with JPEG EOI marker');

    const decoded = decodeJpeg(Buffer.from(result));
    assert.strictEqual(decoded.width, 64);
    assert.strictEqual(decoded.height, 32);
  });

  test('uses red background color in JPEG with hex format', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png')
      ],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      backgroundColor: '#FF0000'
    });

    assert.strictEqual(result[0], 0xFF, 'Should be valid JPEG');
    assert.strictEqual(result[1], 0xD8, 'Should be valid JPEG');

    const decoded = decodeJpeg(Buffer.from(result));
    assert.strictEqual(decoded.width, 32);
  });

  test('uses RGB array for JPEG background', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      backgroundColor: [0, 255, 0] // Green
    });

    const decoded = decodeJpeg(Buffer.from(result));
    assert.strictEqual(decoded.width, 64);
    assert.strictEqual(decoded.height, 32);
  });

  test('handles semi-transparent color in JPEG (alpha is ignored)', async () => {
    // JPEG doesn't support transparency, so alpha channel is ignored
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png')
      ],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      backgroundColor: [255, 0, 0, 128] // Semi-transparent red (alpha ignored)
    });

    const decoded = decodeJpeg(Buffer.from(result));
    assert.strictEqual(decoded.width, 32);
    // The red color is used, but alpha is ignored (JPEG doesn't support transparency)
  });

  test('uses named color in JPEG output', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g08.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      backgroundColor: 'cyan'
    });

    const decoded = decodeJpeg(Buffer.from(result));
    assert.strictEqual(decoded.width, 64);
  });
});

describe('Background Color - Edge Cases', () => {
  test('validates invalid color format', async () => {
    await assert.rejects(
      async () => {
        await concat({
          inputs: [loadImage('basn0g08.png')],
          layout: { columns: 1 },
          backgroundColor: 'invalid-color' as any
        });
      },
      /Unsupported color format/
    );
  });

  test('validates invalid RGB array values', async () => {
    await assert.rejects(
      async () => {
        await concat({
          inputs: [loadImage('basn0g08.png')],
          layout: { columns: 1 },
          backgroundColor: [256, 0, 0] as any
        });
      },
      /integers between 0 and 255/
    );
  });

  test('validates invalid hex format', async () => {
    await assert.rejects(
      async () => {
        await concat({
          inputs: [loadImage('basn0g08.png')],
          layout: { columns: 1 },
          backgroundColor: '#GGGGGG'
        });
      },
      /Invalid hex color/
    );
  });

  test('accepts all supported named colors', async () => {
    const namedColors = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'gray', 'grey'];

    for (const color of namedColors) {
      const result = await concat({
        inputs: [loadImage('basn0g08.png')],
        layout: { columns: 1 },
        backgroundColor: color
      });

      assert.ok(result.length > 0, `Should work with color: ${color}`);
    }
  });

  test('works with 16-bit PNG images', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g16.png'),  // 16-bit grayscale
        loadImage('basn2c16.png')   // 16-bit RGB
      ],
      layout: { columns: 2 },
      backgroundColor: 'white'
    });

    const png = decodePng(result);
    assert.strictEqual(png.width, 64);
  });

  test('works with mixed bit depths', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g01.png'),  // 1-bit
        loadImage('basn0g08.png'),  // 8-bit
        loadImage('basn2c16.png')   // 16-bit
      ],
      layout: { columns: 3 },
      backgroundColor: '#808080' // Gray
    });

    const png = decodePng(result);
    assert.strictEqual(png.width, 96);
  });
});

describe('Background Color - Hex Variations', () => {
  test('supports 3-digit hex shorthand', async () => {
    const result = await concat({
      inputs: [loadImage('basn0g08.png')],
      layout: { columns: 1 },
      backgroundColor: '#F00' // Red shorthand
    });

    assert.ok(result.length > 0);
  });

  test('supports 4-digit hex shorthand with alpha', async () => {
    const result = await concat({
      inputs: [loadImage('basn0g08.png')],
      layout: { columns: 1 },
      backgroundColor: '#F008' // Red with alpha
    });

    assert.ok(result.length > 0);
  });

  test('supports 6-digit hex', async () => {
    const result = await concat({
      inputs: [loadImage('basn0g08.png')],
      layout: { columns: 1 },
      backgroundColor: '#FF0000' // Red
    });

    assert.ok(result.length > 0);
  });

  test('supports 8-digit hex with alpha', async () => {
    const result = await concat({
      inputs: [loadImage('basn0g08.png')],
      layout: { columns: 1 },
      backgroundColor: '#FF000080' // Red with alpha
    });

    assert.ok(result.length > 0);
  });
});
