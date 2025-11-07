/**
 * HEIC Decoder Tests
 *
 * Tests for HEIC/HEIF image decoding.
 *
 * Note: These tests require optional dependencies (sharp with libheif or libheif-js).
 * Tests will be skipped if dependencies are not available.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { HeicBufferDecoder } from '../decoders/index.js';
import { createMagicBytesTest } from '../test-utils/image-fixtures.js';

// Check if HEIC support is available
let heicSupported = false;
try {
  // Try to import optional HEIC dependencies
  if (typeof process !== 'undefined' && process?.versions?.node) {
    // Node.js - try sharp
    try {
      // @ts-expect-error - optional peer dependency
      await import('sharp');
      heicSupported = true;
    } catch {
      // Try heic-decode fallback
      try {
        // @ts-expect-error - optional peer dependency
        await import('heic-decode');
        heicSupported = true;
      } catch {
        heicSupported = false;
      }
    }
  } else {
    // Browser - try libheif-js
    try {
      // @ts-expect-error - optional peer dependency
      await import('libheif-js');
      heicSupported = true;
    } catch {
      heicSupported = false;
    }
  }
} catch {
  heicSupported = false;
}

if (!heicSupported) {
  console.warn('⚠️  HEIC decoder tests skipped: Optional dependencies not installed');
  console.warn('   Install with: npm install sharp (Node.js) or npm install libheif-js (Browser)');
}

describe('HEIC Decoder - Format Detection', () => {
  test('recognizes HEIC magic bytes', () => {
    const heicBytes = createMagicBytesTest('heic');

    assert.ok(heicBytes.length >= 12, 'HEIC test bytes should be at least 12 bytes');

    // Verify ftyp box signature
    assert.strictEqual(heicBytes[4], 0x66); // 'f'
    assert.strictEqual(heicBytes[5], 0x74); // 't'
    assert.strictEqual(heicBytes[6], 0x79); // 'y'
    assert.strictEqual(heicBytes[7], 0x70); // 'p'
  });
});

describe('HEIC Decoder - Constructor', () => {
  test('can create HeicBufferDecoder instance', () => {
    const heicBytes = createMagicBytesTest('heic');
    const decoder = new HeicBufferDecoder(heicBytes);

    assert.ok(decoder, 'Should create decoder instance');
    assert.strictEqual(typeof decoder.getHeader, 'function');
    assert.strictEqual(typeof decoder.scanlines, 'function');
    assert.strictEqual(typeof decoder.close, 'function');
  });

  test('accepts decoder options', () => {
    const heicBytes = createMagicBytesTest('heic');
    const decoder = new HeicBufferDecoder(heicBytes, {
      useNativeIfAvailable: true,
      wasmPath: '/custom/path/to/libheif.wasm'
    });

    assert.ok(decoder, 'Should create decoder with options');
  });
});

// Conditional tests that only run if HEIC support is available
if (heicSupported) {
  describe('HEIC Decoder - Header Parsing (requires dependencies)', () => {
    test.skip('parses HEIC header (requires real HEIC file)', async () => {
      // This test is skipped because we don't have a real HEIC file in test fixtures
      // To enable: add a real HEIC file to test fixtures and read it here
      assert.ok(true, 'Test skipped - requires real HEIC file');
    });
  });

  describe('HEIC Decoder - Decoding (requires dependencies)', () => {
    test.skip('decodes HEIC image (requires real HEIC file)', async () => {
      // This test is skipped because we don't have a real HEIC file in test fixtures
      assert.ok(true, 'Test skipped - requires real HEIC file');
    });
  });
} else {
  describe('HEIC Decoder - Dependency Checks', () => {
    test('provides helpful error when dependencies missing', async () => {
      const heicBytes = createMagicBytesTest('heic');
      const decoder = new HeicBufferDecoder(heicBytes);

      // Should fail with helpful error message about missing dependencies
      await assert.rejects(
        async () => {
          await decoder.getHeader();
        },
        /HEIC|sharp|libheif|heic-decode/i,
        'Should mention HEIC or dependency names in error'
      );
    });
  });
}

describe('HEIC Decoder - Error Handling', () => {
  test('handles invalid HEIC data gracefully', async () => {
    const invalidHeic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x68, 0x65, 0x69, 0x63, // 'heic'
      // ... truncated/invalid data
      ...new Array(100).fill(0x00)
    ]);

    const decoder = new HeicBufferDecoder(invalidHeic);

    await assert.rejects(
      async () => {
        await decoder.getHeader();
      },
      Error,
      'Should reject invalid HEIC data'
    );
  });

  test('close() can be called without error', async () => {
    const heicBytes = createMagicBytesTest('heic');
    const decoder = new HeicBufferDecoder(heicBytes);

    await decoder.close();
    await decoder.close(); // Should be safe to call multiple times

    assert.ok(true, 'close() should not throw');
  });
});

describe('HEIC Decoder - Integration Notes', () => {
  test('documents required dependencies', () => {
    const requiredDeps = {
      nodejs: ['sharp', 'heic-decode'],
      browser: ['libheif-js']
    };

    assert.ok(requiredDeps.nodejs.length > 0, 'Should document Node.js dependencies');
    assert.ok(requiredDeps.browser.length > 0, 'Should document browser dependencies');

    // This test serves as documentation
    console.log('HEIC decoding requires optional peer dependencies:');
    console.log('  Node.js:', requiredDeps.nodejs.join(' or '));
    console.log('  Browser:', requiredDeps.browser.join(' or '));
  });
});
