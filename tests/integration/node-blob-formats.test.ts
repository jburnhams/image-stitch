import { test } from 'node:test';
import assert from 'node:assert';
import { concatToBuffer } from '../../src/index.js';
import { createTestJpeg } from '../utils/image-fixtures.js';

// Minimal HEIC structure for testing detection (may not decode fully)
const minimalHeicBase64 = 'AAAAGGZyeXBoZWljAAAADGhlYzEAAAANTmF2aWdhdG9yAAAAIm1ldGFoZGxyAAAAAAAAAAAAAAAAAAAAAAAAAAAAIm1ldGFoZGxyAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const minimalHeicBytes = Uint8Array.from(atob(minimalHeicBase64), c => c.charCodeAt(0));

// Fix 'fryp' to 'ftyp' (the base64 seems to have a typo or uses a variant not recognized by our detector)
if (minimalHeicBytes[5] === 0x72) { // 'r'
    minimalHeicBytes[5] = 0x74; // 't'
}

test('concatToBuffer supports JPEG Blob inputs', async () => {
    const width = 20;
    const height = 20;
    // Create a simple green JPEG
    const jpegBytes = await createTestJpeg(width, height, new Uint8Array([0, 255, 0, 255]));

    // Wrap in Blob
    const blob = new Blob([jpegBytes as unknown as BlobPart], { type: 'image/jpeg' });

    const result = await concatToBuffer({
        inputs: [blob],
        layout: { columns: 1 }
    });

    assert.ok(result instanceof Uint8Array);
    assert.ok(result.length > 0);
});

test('concatToBuffer supports HEIC Blob inputs', async (t) => {
    // Wrap minimal HEIC in Blob
    const blob = new Blob([minimalHeicBytes as unknown as BlobPart], { type: 'image/heic' });

    try {
        await concatToBuffer({
            inputs: [blob],
            layout: { columns: 1 }
        });
        // If it succeeds, great!
    } catch (err) {
        const error = err as Error;
        // Check if the error indicates that HEIC detection worked but decoding failed
        // (which is expected for this invalid minimal HEIC)
        // Or if 'heic-decode' failed to decode it.

        // If the error is "No decoder registered for format", that's a failure of Blob detection.
        if (error.message.includes('No decoder registered')) {
            assert.fail('HEIC Blob was not detected correctly: ' + error.message);
        }

        // If it's "Failed to decode HEIC image", it means detection worked and it tried to decode.
        // This confirms Blob support is working for HEIC path.
        if (
            error.message.includes('Failed to decode HEIC image') ||
            error.message.includes('heic-decode') ||
            error.message.includes('HEIF image not found') ||
            error.message.includes('Insufficient input data')
        ) {
            // Test passed (conceptually) - we proved Blob was handled.
            // We can mark this test as passing or just log.
            t.diagnostic('HEIC Blob detected but decode failed (expected for minimal fixture): ' + error.message);
            return;
        }

        // Rethrow other errors
        throw err;
    }
});
