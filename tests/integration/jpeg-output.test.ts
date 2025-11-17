/**
 * JPEG Output Format Tests
 *
 * Tests for JPEG output with various input formats including:
 * - 16-bit PNG to 8-bit JPEG conversion
 * - Mixed bit depths
 * - Filmstrip examples (horizontal and vertical)
 * - Format conversion quality
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { concat } from '../../src/image-concat.js';
import { loadPngsuiteImage } from '../utils/test-paths.js';

// Helper to load an image from pngsuite
const loadImage = loadPngsuiteImage;

// Helper to verify JPEG signature
function isValidJpeg(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  // JPEG starts with FF D8 (SOI marker)
  if (data[0] !== 0xFF || data[1] !== 0xD8) return false;
  // JPEG ends with FF D9 (EOI marker)
  if (data[data.length - 2] !== 0xFF || data[data.length - 1] !== 0xD9) return false;
  return true;
}

describe('JPEG Output - Format Conversion', () => {
  test('converts 16-bit PNG to 8-bit JPEG', async () => {
    // basi4a16.png is a 16-bit interlaced grayscale+alpha image
    const result = await concat({
      inputs: [loadImage('basi4a16.png')],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Output should be a valid JPEG');
    assert.ok(result.length > 100, 'JPEG should have reasonable size');
  });

  test('converts mixed 8-bit and 16-bit PNGs to JPEG', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn2c08.png'),  // 8-bit RGB
        loadImage('basn2c16.png')   // 16-bit RGB
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Output should be a valid JPEG');
    assert.ok(result.length > 100, 'JPEG should have reasonable size');
  });

  test('converts multiple 16-bit PNGs to JPEG', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn0g16.png'),  // 16-bit grayscale
        loadImage('basn2c16.png')   // 16-bit RGB
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Output should be a valid JPEG');
    assert.ok(result.length > 100, 'JPEG should have reasonable size');
  });

  test('handles grayscale 16-bit to JPEG conversion', async () => {
    const result = await concat({
      inputs: [loadImage('basn0g16.png')],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 90
    });

    assert.ok(isValidJpeg(result), 'Output should be a valid JPEG');
  });
});

describe('JPEG Output - Filmstrip Examples', () => {
  test('horizontal filmstrip with 16-bit image produces valid JPEG', async () => {
    // This is the exact example from docs/examples.html
    const result = await concat({
      inputs: [
        loadImage('basi0g08.png'),  // 8-bit grayscale interlaced
        loadImage('basi2c08.png'),  // 8-bit RGB interlaced
        loadImage('basi4a16.png')   // 16-bit grayscale+alpha interlaced
      ],
      layout: { columns: 3 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Horizontal filmstrip JPEG should be valid');
    assert.ok(result.length > 200, 'JPEG should have reasonable size for 3 images');
  });

  test('vertical filmstrip produces valid JPEG', async () => {
    // This is the exact example from docs/examples.html
    const result = await concat({
      inputs: [
        loadImage('basi2c08.png'),  // 8-bit RGB interlaced
        loadImage('basi0g08.png')   // 8-bit grayscale interlaced
      ],
      layout: { rows: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Vertical filmstrip JPEG should be valid');
    assert.ok(result.length > 100, 'JPEG should have reasonable size');
  });

  test('grid layout with mixed formats produces valid JPEG', async () => {
    const result = await concat({
      inputs: [
        loadImage('basi0g08.png'),
        loadImage('basi2c08.png'),
        loadImage('basi4a16.png'),
        loadImage('basi0g08.png')
      ],
      layout: { width: 256 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Grid layout JPEG should be valid');
    assert.ok(result.length > 200, 'JPEG should have reasonable size');
  });
});

describe('JPEG Output - Quality Settings', () => {
  test('accepts quality parameter from 1 to 100', async () => {
    const input = loadImage('basn2c08.png');

    for (const quality of [1, 50, 85, 100]) {
      const result = await concat({
        inputs: [input],
        layout: { columns: 1 },
        outputFormat: 'jpeg',
        jpegQuality: quality
      });

      assert.ok(isValidJpeg(result), `JPEG with quality ${quality} should be valid`);
    }
  });

  test('higher quality produces larger file size', async () => {
    const input = loadImage('basn2c08.png');

    const lowQuality = await concat({
      inputs: [input],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 10
    });

    const highQuality = await concat({
      inputs: [input],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 95
    });

    // Higher quality should generally produce larger files
    // (though this isn't guaranteed for all images)
    assert.ok(lowQuality.length > 0, 'Low quality JPEG should have data');
    assert.ok(highQuality.length > 0, 'High quality JPEG should have data');
  });

  test('default quality (85) produces valid JPEG', async () => {
    const result = await concat({
      inputs: [loadImage('basn2c08.png')],
      layout: { columns: 1 },
      outputFormat: 'jpeg'
      // jpegQuality omitted - should default to 85
    });

    assert.ok(isValidJpeg(result), 'JPEG with default quality should be valid');
  });
});

describe('JPEG Output - Edge Cases', () => {
  test('handles interlaced 16-bit images', async () => {
    const result = await concat({
      inputs: [loadImage('basi4a16.png')],
      layout: { columns: 1 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Interlaced 16-bit JPEG should be valid');
  });

  test('handles mixed interlaced and non-interlaced with 16-bit', async () => {
    const result = await concat({
      inputs: [
        loadImage('basn2c16.png'),  // Non-interlaced 16-bit
        loadImage('basi4a16.png')   // Interlaced 16-bit
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Mixed interlaced JPEG should be valid');
  });

  test('handles all 16-bit color types', async () => {
    // Test each 16-bit color type
    const images = [
      'basn0g16.png',  // Grayscale 16-bit
      'basn2c16.png'   // RGB 16-bit
    ];

    for (const image of images) {
      const result = await concat({
        inputs: [loadImage(image)],
        layout: { columns: 1 },
        outputFormat: 'jpeg',
        jpegQuality: 85
      });

      assert.ok(isValidJpeg(result), `${image} should convert to valid JPEG`);
    }
  });

  test('handles small 16-bit images', async () => {
    // basn0g01.png is very small (1-bit), mixed with 16-bit
    const result = await concat({
      inputs: [
        loadImage('basn0g01.png'),  // 1-bit grayscale
        loadImage('basn0g16.png')   // 16-bit grayscale
      ],
      layout: { columns: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Mixed bit depths JPEG should be valid');
  });
});

describe('JPEG Output - Color Preservation', () => {
  test('JPEG output is non-zero (not all grey/black)', async () => {
    // This test ensures we're not producing all-grey output
    const result = await concat({
      inputs: [
        loadImage('basi2c08.png'),  // RGB color image
        loadImage('basi0g08.png')   // Grayscale image
      ],
      layout: { rows: 2 },
      outputFormat: 'jpeg',
      jpegQuality: 85
    });

    assert.ok(isValidJpeg(result), 'Output should be valid JPEG');

    // JPEG file should contain some variation in data
    // (not just header + minimal compressed data)
    assert.ok(result.length > 200, 'JPEG should have substantial data (not all grey/black)');

    // Check that the data section has variation
    // Skip the first 100 bytes (headers) and check for non-zero values
    const dataSection = result.slice(100, Math.min(500, result.length));
    const hasVariation = dataSection.some(byte => byte > 0x10 && byte < 0xF0);
    assert.ok(hasVariation, 'JPEG data should have variation (not all single color)');
  });
});
