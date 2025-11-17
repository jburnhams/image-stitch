/**
 * JPEG Structure Validation Tests
 *
 * These tests validate that JPEG output has correct structure:
 * - Exactly ONE SOI marker (ff d8)
 * - Exactly ONE EOI marker (ff d9)
 * - No embedded duplicate JPEG files
 * - Valid decodable output
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { JpegEncoder } from '../../src/jpeg-encoder.js';
import * as jpegjs from 'jpeg-js';

// Helper to count JPEG markers
function countMarkers(data: Uint8Array): { soi: number; eoi: number; soiOffsets: number[]; eoiOffsets: number[] } {
  const soiOffsets: number[] = [];
  const eoiOffsets: number[] = [];

  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0xFF) {
      if (data[i + 1] === 0xD8) {
        soiOffsets.push(i);
      } else if (data[i + 1] === 0xD9) {
        eoiOffsets.push(i);
      }
    }
  }

  return {
    soi: soiOffsets.length,
    eoi: eoiOffsets.length,
    soiOffsets,
    eoiOffsets
  };
}

// Helper to create test image data
function createTestImage(width: number, height: number, color: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return data;
}

describe('JPEG Structure Validation', () => {
  test('JPEG output has exactly one SOI marker', async () => {
    const data = createTestImage(64, 32, [255, 0, 0, 255]); // Red
    const encoder = new JpegEncoder({ width: 64, height: 32, quality: 85 });
    const result = await encoder.encodeToBuffer(data);

    const markers = countMarkers(result);
    assert.strictEqual(markers.soi, 1, `Expected exactly 1 SOI marker, found ${markers.soi} at offsets: ${markers.soiOffsets.join(', ')}`);
  });

  test('JPEG output has exactly one EOI marker', async () => {
    const data = createTestImage(64, 32, [255, 0, 0, 255]); // Red
    const encoder = new JpegEncoder({ width: 64, height: 32, quality: 85 });
    const result = await encoder.encodeToBuffer(data);

    const markers = countMarkers(result);
    assert.strictEqual(markers.eoi, 1, `Expected exactly 1 EOI marker, found ${markers.eoi} at offsets: ${markers.eoiOffsets.join(', ')}`);
  });

  test('SOI marker is at offset 0', async () => {
    const data = createTestImage(64, 32, [255, 0, 0, 255]); // Red
    const encoder = new JpegEncoder({ width: 64, height: 32, quality: 85 });
    const result = await encoder.encodeToBuffer(data);

    const markers = countMarkers(result);
    assert.strictEqual(markers.soiOffsets[0], 0, 'SOI marker should be at offset 0');
  });

  test('EOI marker is at the end of file', async () => {
    const data = createTestImage(64, 32, [255, 0, 0, 255]); // Red
    const encoder = new JpegEncoder({ width: 64, height: 32, quality: 85 });
    const result = await encoder.encodeToBuffer(data);

    const markers = countMarkers(result);
    assert.strictEqual(markers.eoiOffsets[0], result.length - 2, 'EOI marker should be at end of file (last 2 bytes)');
  });

  test('JPEG is decodable by jpeg-js', async () => {
    const data = createTestImage(64, 32, [255, 0, 0, 255]); // Red
    const encoder = new JpegEncoder({ width: 64, height: 32, quality: 85 });
    const result = await encoder.encodeToBuffer(data);

    // This will throw if JPEG is malformed
    assert.doesNotThrow(() => {
      const decoded = jpegjs.decode(Buffer.from(result));
      assert.strictEqual(decoded.width, 64, 'Decoded width should match');
      assert.strictEqual(decoded.height, 32, 'Decoded height should match');
    }, 'JPEG should be decodable without errors');
  });

  test('JPEG contains actual color data (not all grey)', async () => {
    const data = createTestImage(64, 32, [255, 0, 0, 255]); // Red
    const encoder = new JpegEncoder({ width: 64, height: 32, quality: 85 });
    const result = await encoder.encodeToBuffer(data);

    const decoded = jpegjs.decode(Buffer.from(result));
    const pixels = decoded.data;

    // Check that we have red pixels
    let hasRed = false;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      // Allow some tolerance for JPEG compression
      if (r > 200 && g < 50 && b < 50) {
        hasRed = true;
        break;
      }
    }

    assert.ok(hasRed, 'JPEG should contain red pixels (not all grey/black)');
  });

  test('Different sized images produce valid JPEGs', async () => {
    const sizes = [
      [32, 32],
      [64, 32],
      [100, 100],
      [256, 128]
    ];

    for (const [width, height] of sizes) {
      const data = createTestImage(width, height, [0, 0, 255, 255]); // Blue
      const encoder = new JpegEncoder({ width, height, quality: 85 });
      const result = await encoder.encodeToBuffer(data);

      const markers = countMarkers(result);
      assert.strictEqual(markers.soi, 1, `${width}x${height}: Expected 1 SOI marker`);
      assert.strictEqual(markers.eoi, 1, `${width}x${height}: Expected 1 EOI marker`);

      // Verify decodable
      const decoded = jpegjs.decode(Buffer.from(result));
      assert.strictEqual(decoded.width, width, `${width}x${height}: Decoded width should match`);
      assert.strictEqual(decoded.height, height, `${width}x${height}: Decoded height should match`);
    }
  });

  test('Different quality settings produce valid JPEGs', async () => {
    const qualities = [10, 50, 85, 95];
    const data = createTestImage(64, 32, [0, 255, 0, 255]); // Green

    for (const quality of qualities) {
      const encoder = new JpegEncoder({ width: 64, height: 32, quality });
      const result = await encoder.encodeToBuffer(data);

      const markers = countMarkers(result);
      assert.strictEqual(markers.soi, 1, `Quality ${quality}: Expected 1 SOI marker`);
      assert.strictEqual(markers.eoi, 1, `Quality ${quality}: Expected 1 EOI marker`);

      // Verify decodable
      const decoded = jpegjs.decode(Buffer.from(result));
      assert.strictEqual(decoded.width, 64, `Quality ${quality}: Decoded width should match`);
      assert.strictEqual(decoded.height, 32, `Quality ${quality}: Decoded height should match`);
    }
  });

  test('encodeStrip method does not output SOI markers', async () => {
    const width = 64;
    const height = 32;
    const data = createTestImage(width, height, [255, 255, 0, 255]); // Yellow
    const encoder = new JpegEncoder({ width, height, quality: 85 });

    // Collect all chunks from header, strips, and footer
    const headerChunks: Uint8Array[] = [];
    const stripChunks: Uint8Array[] = [];
    const footerChunks: Uint8Array[] = [];

    // Header
    for await (const chunk of encoder.header()) {
      headerChunks.push(chunk);
    }

    // Strips
    const stripHeight = 8;
    for (let y = 0; y < height; y += stripHeight) {
      const remainingLines = Math.min(stripHeight, height - y);
      const offset = y * width * 4;
      const size = width * remainingLines * 4;
      const strip = data.subarray(offset, offset + size);

      for await (const chunk of encoder.encodeStrip(strip, null)) {
        stripChunks.push(chunk);
      }
    }

    // Footer
    for await (const chunk of encoder.finish()) {
      footerChunks.push(chunk);
    }

    // Verify no strip chunks contain SOI markers
    for (let i = 0; i < stripChunks.length; i++) {
      const chunk = stripChunks[i];
      const markers = countMarkers(chunk);
      assert.strictEqual(
        markers.soi,
        0,
        `Strip chunk ${i} should not contain SOI markers (found ${markers.soi} at offsets: ${markers.soiOffsets.join(', ')})`
      );
    }

    // Verify exactly one SOI in header
    const headerData = Buffer.concat(headerChunks.map(c => Buffer.from(c)));
    const headerMarkers = countMarkers(new Uint8Array(headerData));
    assert.strictEqual(headerMarkers.soi, 1, 'Header should contain exactly 1 SOI marker');

    // Verify exactly one EOI in footer
    const footerData = Buffer.concat(footerChunks.map(c => Buffer.from(c)));
    const footerMarkers = countMarkers(new Uint8Array(footerData));
    assert.strictEqual(footerMarkers.eoi, 1, 'Footer should contain exactly 1 EOI marker');
  });
});
