import { test } from 'node:test';
import assert from 'node:assert';
import { compositeScanline, extractScanlinePortion } from '../../src/pixel-ops.js';

test('compositeScanline: simple copy without blending (8-bit)', () => {
  const dest = new Uint8Array([
    0, 0, 0, 0,  // Transparent black
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);
  const source = new Uint8Array([
    255, 0, 0, 255  // Opaque red
  ]);

  compositeScanline(dest, source, 1, 1, 4, false);

  // Should copy source to position 1
  assert.strictEqual(dest[4], 255);  // R
  assert.strictEqual(dest[5], 0);    // G
  assert.strictEqual(dest[6], 0);    // B
  assert.strictEqual(dest[7], 255);  // A
});

test('compositeScanline: opaque source over opaque dest (8-bit)', () => {
  const dest = new Uint8Array([
    0, 0, 255, 255  // Opaque blue
  ]);
  const source = new Uint8Array([
    255, 0, 0, 255  // Opaque red
  ]);

  compositeScanline(dest, source, 0, 1, 4, true);

  // Opaque red should replace blue
  assert.strictEqual(dest[0], 255);  // R
  assert.strictEqual(dest[1], 0);    // G
  assert.strictEqual(dest[2], 0);    // B
  assert.strictEqual(dest[3], 255);  // A
});

test('compositeScanline: semi-transparent over opaque (8-bit)', () => {
  const dest = new Uint8Array([
    0, 0, 255, 255  // Opaque blue
  ]);
  const source = new Uint8Array([
    255, 0, 0, 128  // 50% transparent red
  ]);

  compositeScanline(dest, source, 0, 1, 4, true);

  // Should blend 50% red with 50% blue
  // Expected: (255*0.5 + 0*0.5, 0*0.5 + 0*0.5, 0*0.5 + 255*0.5, 255)
  assert.ok(dest[0] >= 127 && dest[0] <= 128, `R=${dest[0]} should be 127-128`);
  assert.strictEqual(dest[1], 0);    // G
  assert.ok(dest[2] >= 127 && dest[2] <= 128, `B=${dest[2]} should be 127-128`);
  assert.strictEqual(dest[3], 255);  // A (fully opaque)
});

test('compositeScanline: transparent source (no change)', () => {
  const dest = new Uint8Array([
    100, 100, 100, 255  // Opaque gray
  ]);
  const source = new Uint8Array([
    255, 0, 0, 0  // Fully transparent red
  ]);

  compositeScanline(dest, source, 0, 1, 4, true);

  // Dest should remain unchanged
  assert.strictEqual(dest[0], 100);
  assert.strictEqual(dest[1], 100);
  assert.strictEqual(dest[2], 100);
  assert.strictEqual(dest[3], 255);
});

test('compositeScanline: semi-transparent over semi-transparent (8-bit)', () => {
  const dest = new Uint8Array([
    0, 0, 255, 128  // 50% transparent blue
  ]);
  const source = new Uint8Array([
    255, 0, 0, 128  // 50% transparent red
  ]);

  compositeScanline(dest, source, 0, 1, 4, true);

  // Alpha: 0.5 + 0.5 * (1 - 0.5) = 0.75
  // R: (255 * 0.5 + 0 * 0.5 * 0.5) / 0.75 = 170
  // B: (0 * 0.5 + 255 * 0.5 * 0.5) / 0.75 = 85
  assert.ok(dest[0] >= 169 && dest[0] <= 171, `R=${dest[0]} should be ~170`);
  assert.strictEqual(dest[1], 0);    // G
  assert.ok(dest[2] >= 84 && dest[2] <= 86, `B=${dest[2]} should be ~85`);
  assert.ok(dest[3] >= 191 && dest[3] <= 192, `A=${dest[3]} should be ~191`);  // 0.75 * 255 = 191.25
});

test('compositeScanline: multiple pixels (8-bit)', () => {
  const dest = new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);
  const source = new Uint8Array([
    255, 0, 0, 255,    // Red
    0, 255, 0, 255     // Green
  ]);

  compositeScanline(dest, source, 0, 2, 4, true);

  // First pixel: red
  assert.strictEqual(dest[0], 255);
  assert.strictEqual(dest[1], 0);
  assert.strictEqual(dest[2], 0);
  assert.strictEqual(dest[3], 255);

  // Second pixel: green
  assert.strictEqual(dest[4], 0);
  assert.strictEqual(dest[5], 255);
  assert.strictEqual(dest[6], 0);
  assert.strictEqual(dest[7], 255);
});

test('compositeScanline: 16-bit opaque source over opaque dest', () => {
  const dest = new Uint8Array([
    0, 0,     // R
    0, 0,     // G
    255, 255, // B (65535 in 16-bit)
    255, 255  // A (65535 in 16-bit)
  ]);
  const source = new Uint8Array([
    255, 255, // R (65535)
    0, 0,     // G
    0, 0,     // B
    255, 255  // A (65535)
  ]);

  compositeScanline(dest, source, 0, 1, 8, true);

  // Opaque red should replace blue
  assert.strictEqual(dest[0], 255);  // R high
  assert.strictEqual(dest[1], 255);  // R low
  assert.strictEqual(dest[2], 0);    // G high
  assert.strictEqual(dest[3], 0);    // G low
  assert.strictEqual(dest[4], 0);    // B high
  assert.strictEqual(dest[5], 0);    // B low
  assert.strictEqual(dest[6], 255);  // A high
  assert.strictEqual(dest[7], 255);  // A low
});

test('compositeScanline: 16-bit semi-transparent blending', () => {
  const dest = new Uint8Array([
    0, 0,     // R
    0, 0,     // G
    255, 255, // B (65535 in 16-bit)
    255, 255  // A (65535 in 16-bit)
  ]);
  const source = new Uint8Array([
    255, 255, // R (65535)
    0, 0,     // G
    0, 0,     // B
    128, 0    // A (32768 in 16-bit, ~50%)
  ]);

  compositeScanline(dest, source, 0, 1, 8, true);

  // Should blend approximately 50%
  const r = (dest[0] << 8) | dest[1];
  const b = (dest[4] << 8) | dest[5];
  const a = (dest[6] << 8) | dest[7];

  // R should be around 32768 (50% of 65535)
  assert.ok(r >= 32000 && r <= 33500, `R value ${r} not in expected range`);

  // B should be around 32768 (50% of 65535)
  assert.ok(b >= 32000 && b <= 33500, `B value ${b} not in expected range`);

  // A should be 65535 (fully opaque)
  assert.strictEqual(a, 65535);
});

test('compositeScanline: position offset (8-bit)', () => {
  const dest = new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);
  const source = new Uint8Array([
    255, 0, 0, 255  // Red
  ]);

  // Composite at position 2
  compositeScanline(dest, source, 2, 1, 4, true);

  // First two pixels should be unchanged
  assert.strictEqual(dest[0], 0);
  assert.strictEqual(dest[4], 0);

  // Third pixel should be red
  assert.strictEqual(dest[8], 255);   // R
  assert.strictEqual(dest[9], 0);     // G
  assert.strictEqual(dest[10], 0);    // B
  assert.strictEqual(dest[11], 255);  // A

  // Fourth pixel should be unchanged
  assert.strictEqual(dest[12], 0);
});

test('extractScanlinePortion: extract middle portion (8-bit)', () => {
  const scanline = new Uint8Array([
    255, 0, 0, 255,    // Red
    0, 255, 0, 255,    // Green
    0, 0, 255, 255,    // Blue
    255, 255, 0, 255   // Yellow
  ]);

  const portion = extractScanlinePortion(scanline, 1, 2, 4);

  // Should extract green and blue
  assert.strictEqual(portion.length, 8);
  assert.strictEqual(portion[0], 0);     // Green R
  assert.strictEqual(portion[1], 255);   // Green G
  assert.strictEqual(portion[2], 0);     // Green B
  assert.strictEqual(portion[3], 255);   // Green A
  assert.strictEqual(portion[4], 0);     // Blue R
  assert.strictEqual(portion[5], 0);     // Blue G
  assert.strictEqual(portion[6], 255);   // Blue B
  assert.strictEqual(portion[7], 255);   // Blue A
});

test('extractScanlinePortion: extract beginning (8-bit)', () => {
  const scanline = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255
  ]);

  const portion = extractScanlinePortion(scanline, 0, 1, 4);

  assert.strictEqual(portion.length, 4);
  assert.strictEqual(portion[0], 255);
  assert.strictEqual(portion[1], 0);
  assert.strictEqual(portion[2], 0);
  assert.strictEqual(portion[3], 255);
});

test('extractScanlinePortion: extract end (8-bit)', () => {
  const scanline = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255
  ]);

  const portion = extractScanlinePortion(scanline, 1, 1, 4);

  assert.strictEqual(portion.length, 4);
  assert.strictEqual(portion[0], 0);
  assert.strictEqual(portion[1], 255);
  assert.strictEqual(portion[2], 0);
  assert.strictEqual(portion[3], 255);
});

test('extractScanlinePortion: 16-bit pixels', () => {
  const scanline = new Uint8Array([
    255, 255, 0, 0, 0, 0, 255, 255,    // Red (16-bit)
    0, 0, 255, 255, 0, 0, 255, 255     // Green (16-bit)
  ]);

  const portion = extractScanlinePortion(scanline, 1, 1, 8);

  assert.strictEqual(portion.length, 8);
  assert.strictEqual(portion[0], 0);     // R high
  assert.strictEqual(portion[1], 0);     // R low
  assert.strictEqual(portion[2], 255);   // G high
  assert.strictEqual(portion[3], 255);   // G low
  assert.strictEqual(portion[4], 0);     // B high
  assert.strictEqual(portion[5], 0);     // B low
  assert.strictEqual(portion[6], 255);   // A high
  assert.strictEqual(portion[7], 255);   // A low
});

test('compositeScanline: nearly opaque source (edge case)', () => {
  const dest = new Uint8Array([
    0, 0, 255, 255  // Blue
  ]);
  const source = new Uint8Array([
    255, 0, 0, 254  // Almost opaque red (254/255)
  ]);

  compositeScanline(dest, source, 0, 1, 4, true);

  // Should be nearly all red
  assert.ok(dest[0] >= 250, `R=${dest[0]} should be >= 250`);
  assert.ok(dest[2] <= 5, `B=${dest[2]} should be <= 5`);
  assert.strictEqual(dest[3], 255);
});

test('compositeScanline: very transparent source (edge case)', () => {
  const dest = new Uint8Array([
    100, 100, 100, 255  // Gray
  ]);
  const source = new Uint8Array([
    255, 0, 0, 1  // Almost transparent red (1/255)
  ]);

  compositeScanline(dest, source, 0, 1, 4, true);

  // Should be almost unchanged
  assert.ok(dest[0] <= 105, `R=${dest[0]} should be <= 105`);
  assert.ok(dest[0] >= 95, `R=${dest[0]} should be >= 95`);
  assert.strictEqual(dest[3], 255);
});
