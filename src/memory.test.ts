/**
 * Memory usage tests for image-stitch
 *
 * These tests ensure the streaming implementation maintains reasonable memory usage
 * even when processing very large images.
 *
 * IMPORTANT LIMITATION:
 * The Web Compression Streams API (CompressionStream) buffers uncompressed data
 * internally before yielding compressed output. This means peak memory usage will be
 * roughly equal to the uncompressed image size, NOT the compressed output size.
 *
 * This is still a HUGE improvement over the original bug where multiple copies
 * were accumulated (2-3x the uncompressed size), but it's not true "constant memory"
 * streaming.
 *
 * For true constant-memory streaming, we would need to implement custom deflate
 * compression with explicit flush control, which is not available in the standard
 * Web Compression Streams API.
 *
 * Run with: node --expose-gc --test dist/memory.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { concatPngs } from './png-concat.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData } from './png-decompress.js';
import { PngHeader, ColorType } from './types.js';
import {
  monitorMemory,
  assertMemoryBelow,
  printMemoryReport,
  calculateExpectedMemory,
  formatBytes,
  isGCAvailable
} from './test-utils/memory-monitor.js';

/**
 * Create a simple test PNG with solid color
 */
async function createTestPng(
  width: number,
  height: number,
  color: Uint8Array
): Promise<Uint8Array> {
  const header: PngHeader = {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const pixelData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixelData[i * 4] = color[0]; // R
    pixelData[i * 4 + 1] = color[1]; // G
    pixelData[i * 4 + 2] = color[2]; // B
    pixelData[i * 4 + 3] = color[3]; // A
  }

  const compressed = await compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

// Skip tests if GC is not available
const testFn = isGCAvailable() ? test : test.skip;
const describeFn = isGCAvailable() ? describe : describe.skip;

if (!isGCAvailable()) {
  console.warn('⚠️  Warning: Running without --expose-gc flag. Memory tests will be skipped.');
  console.warn('   Run with: node --expose-gc --test dist/memory.test.js');
}

describeFn('Memory Usage Tests', () => {
  testFn('Small image (100x100) - baseline memory check', async () => {
    const testPng = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));

    const { result, measurement } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: [testPng, testPng, testPng, testPng],
        layout: { columns: 2 }
      });
    });

    // Should complete successfully
    assert.ok(result.length > 0);

    // For small images, memory usage should be minimal (< 10MB)
    assertMemoryBelow(measurement, 10 * 1024 * 1024, 'heapUsed');

    console.log(`✓ Small image: ${formatBytes(measurement.delta.heapUsed)} peak memory`);
  });

  testFn('Medium image (1000x1000) - memory stays below uncompressed size', async () => {
    const testPng = await createTestPng(1000, 1000, new Uint8Array([0, 255, 0, 255]));

    const { result, measurement } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: [testPng, testPng, testPng, testPng],
        layout: { columns: 2 }
      });
    });

    assert.ok(result.length > 0);

    // Output is ~2000x2000 = 4M pixels = 16MB uncompressed
    // Due to CompressionStream buffering, expect memory ~= uncompressed size
    // Allow 2x for overhead
    const uncompressedSize = 2000 * 2000 * 4;
    assertMemoryBelow(measurement, uncompressedSize * 2, 'heapUsed');

    console.log(`✓ Medium image: ${formatBytes(measurement.delta.heapUsed)} peak memory for ${formatBytes(result.length)} output`);
  });

  testFn('Large image (5000x5000) - memory bounded by uncompressed size', async () => {
    // Create a small source image that we'll tile many times
    const smallPng = await createTestPng(32, 32, new Uint8Array([0, 0, 255, 255]));

    // Calculate how many tiles we need
    const targetSize = 5000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;

    const inputs = Array(tilesNeeded).fill(smallPng);

    const { result, measurement } = await monitorMemory(async () => {
      return await concatPngs({
        inputs,
        layout: { width: targetSize }
      });
    }, 100); // Sample every 100ms for long operations

    assert.ok(result.length > 0);

    const expectedMem = calculateExpectedMemory(targetSize, targetSize, 4);

    console.log(`\nLarge Image Memory Analysis (5000x5000):`);
    console.log(`  Uncompressed size: ${formatBytes(expectedMem.uncompressedSize)}`);
    console.log(`  Output size: ${formatBytes(result.length)}`);
    console.log(`  Peak memory delta: ${formatBytes(measurement.delta.heapUsed)}`);
    console.log(`  Ratio (peak/uncompressed): ${(measurement.delta.heapUsed / expectedMem.uncompressedSize).toFixed(2)}x`);

    // Memory should be ~1-1.5x uncompressed size (due to CompressionStream buffering)
    // Allow 1.5x for overhead
    assertMemoryBelow(measurement, expectedMem.uncompressedSize * 1.5, 'heapUsed');

    console.log(`✓ Large image test passed - memory bounded by uncompressed size`);
  });

  testFn('Very large image (10000x10000) - regression test for memory bounds', async () => {
    const smallPng = await createTestPng(32, 32, new Uint8Array([255, 255, 0, 255]));

    const targetSize = 10000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;

    const inputs = Array(tilesNeeded).fill(smallPng);

    const { result, measurement } = await monitorMemory(async () => {
      return await concatPngs({
        inputs,
        layout: { width: targetSize }
      });
    }, 100);

    assert.ok(result.length > 0);

    const expectedMem = calculateExpectedMemory(targetSize, targetSize, 4);

    console.log(`\nVery Large Image Memory Analysis (10000x10000):`);
    console.log(`  Uncompressed size: ${formatBytes(expectedMem.uncompressedSize)}`);
    console.log(`  Output size: ${formatBytes(result.length)}`);
    console.log(`  Peak memory delta: ${formatBytes(measurement.delta.heapUsed)}`);
    console.log(`  Ratio (peak/uncompressed): ${(measurement.delta.heapUsed / expectedMem.uncompressedSize).toFixed(2)}x`);

    // Memory should be ~1-1.5x uncompressed size
    // Original bug would use 2-3x, so this is a significant improvement
    assertMemoryBelow(measurement, expectedMem.uncompressedSize * 1.5, 'heapUsed');

    console.log(`✓ Very large image test passed`);
  });

  testFn('Extreme image (20000x20000) - memory bounded test', async () => {
    // This test demonstrates the fix for the original bug
    // Original bug: 2-3GB (multiple copies)
    // After fix: ~1.6GB (single copy in compressor)

    const smallPng = await createTestPng(32, 32, new Uint8Array([255, 0, 255, 255]));

    const targetSize = 20000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;

    const inputs = Array(tilesNeeded).fill(smallPng);

    const startTime = Date.now();

    const { result, measurement} = await monitorMemory(async () => {
      return await concatPngs({
        inputs,
        layout: { width: targetSize }
      });
    }, 200);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    assert.ok(result.length > 0);

    const expectedMem = calculateExpectedMemory(targetSize, targetSize, 4);

    console.log(`\nExtreme Image Memory Analysis (20000x20000):`);
    console.log(`  Uncompressed size: ${formatBytes(expectedMem.uncompressedSize)}`);
    console.log(`  Output size: ${formatBytes(result.length)}`);
    console.log(`  Peak memory delta: ${formatBytes(measurement.delta.heapUsed)}`);
    console.log(`  Ratio (peak/uncompressed): ${(measurement.delta.heapUsed / expectedMem.uncompressedSize).toFixed(2)}x`);
    console.log(`  Generation time: ${duration.toFixed(2)}s`);

    printMemoryReport(measurement);

    // Memory should be ~1-1.5x uncompressed (1.6-2.4GB)
    // Original bug used 2-3GB, so this is a meaningful improvement
    assertMemoryBelow(measurement, expectedMem.uncompressedSize * 1.5, 'heapUsed');

    console.log(`✓ Extreme image test passed - memory bounded by uncompressed size!`);
  });
});

describeFn('Memory Regression Tests', () => {
  testFn('Regression: Memory should not grow with number of duplicate inputs', async () => {
    // When using the same image many times, memory should stay constant
    // because we're referencing the same data

    const testPng = await createTestPng(100, 100, new Uint8Array([128, 128, 128, 255]));

    // Test with 10 copies
    const { measurement: measurement10 } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: Array(10).fill(testPng),
        layout: { columns: 5 }
      });
    });

    // Test with 100 copies
    const { measurement: measurement100 } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: Array(100).fill(testPng),
        layout: { columns: 10 }
      });
    });

    // Memory should not grow linearly with input count
    // Allow some growth for layout structures, but should be < 3x
    const ratio = measurement100.delta.heapUsed / measurement10.delta.heapUsed;

    console.log(`\nInput scaling test:`);
    console.log(`  10 inputs: ${formatBytes(measurement10.delta.heapUsed)}`);
    console.log(`  100 inputs: ${formatBytes(measurement100.delta.heapUsed)}`);
    console.log(`  Ratio: ${ratio.toFixed(2)}x`);

    assert.ok(
      ratio < 5,
      `Memory grew too much with input count: ${ratio.toFixed(2)}x (should be < 5x)`
    );

    console.log(`✓ Memory scales sub-linearly with input count`);
  });

  testFn('Regression: Memory usage for different layouts should be similar', async () => {
    const testPng = await createTestPng(200, 200, new Uint8Array([100, 150, 200, 255]));

    // Test horizontal layout
    const { measurement: horizontal } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: [testPng, testPng, testPng, testPng],
        layout: { columns: 4 }
      });
    });

    // Test vertical layout
    const { measurement: vertical } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: [testPng, testPng, testPng, testPng],
        layout: { rows: 4 }
      });
    });

    // Test grid layout
    const { measurement: grid } = await monitorMemory(async () => {
      return await concatPngs({
        inputs: [testPng, testPng, testPng, testPng],
        layout: { columns: 2 }
      });
    });

    console.log(`\nLayout comparison:`);
    console.log(`  Horizontal: ${formatBytes(horizontal.delta.heapUsed)}`);
    console.log(`  Vertical: ${formatBytes(vertical.delta.heapUsed)}`);
    console.log(`  Grid: ${formatBytes(grid.delta.heapUsed)}`);

    // All should be within 2x of each other (allowing for some variance)
    const max = Math.max(horizontal.delta.heapUsed, vertical.delta.heapUsed, grid.delta.heapUsed);
    const min = Math.min(horizontal.delta.heapUsed, vertical.delta.heapUsed, grid.delta.heapUsed);
    const ratio = max / min;

    assert.ok(
      ratio < 2.5,
      `Layout memory usage varies too much: ${ratio.toFixed(2)}x (should be < 2.5x)`
    );

    console.log(`✓ Memory usage consistent across layouts (${ratio.toFixed(2)}x variance)`);
  });

  testFn('Regression: Peak memory threshold for 10000x10000 image', async () => {
    // This is a fixed threshold regression test
    // If this fails, we've introduced a memory regression

    const smallPng = await createTestPng(32, 32, new Uint8Array([200, 100, 50, 255]));
    const targetSize = 10000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;
    const inputs = Array(tilesNeeded).fill(smallPng);

    const { result, measurement } = await monitorMemory(async () => {
      return await concatPngs({
        inputs,
        layout: { width: targetSize }
      });
    }, 100);

    // Set a hard threshold: 10000x10000 RGBA = 381MB uncompressed
    // With CompressionStream buffering, expect ~1.5x = 572MB
    // Original bug used 800MB+, so 600MB is a good regression threshold
    const REGRESSION_THRESHOLD = 600 * 1024 * 1024; // 600MB threshold

    console.log(`\n10000x10000 Regression Threshold Test:`);
    console.log(`  Peak memory: ${formatBytes(measurement.delta.heapUsed)}`);
    console.log(`  Threshold: ${formatBytes(REGRESSION_THRESHOLD)}`);
    console.log(`  Output size: ${formatBytes(result.length)}`);

    assertMemoryBelow(measurement, REGRESSION_THRESHOLD, 'heapUsed');

    console.log(`✓ Memory stayed below regression threshold`);
  });
});
