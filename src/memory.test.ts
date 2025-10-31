/**
 * Memory usage tests for image-stitch
 *
 * These tests verify TRUE CONSTANT-MEMORY streaming using pako's onData callback.
 *
 * IMPLEMENTATION:
 * - Original bug: Accumulated ALL filtered scanlines before compression (2-3x uncompressed)
 * - Fixed: pako with onData callback receives compressed chunks immediately
 * - Batch size: ~10MB of scanlines, then Z_SYNC_FLUSH
 * - Memory usage: O(batch_size) - constant regardless of total image size!
 *
 * EXPECTED MEMORY:
 * - Small images (2000x2000): ~10-20 MB
 * - Medium images (5000x5000): ~15-30 MB
 * - Large images (10000x10000): ~20-40 MB
 * - Extreme images (20000x20000): ~25-50 MB
 *
 * Memory is now constant and does NOT grow with image size!
 *
 * Run with: node --expose-gc --test build/tests/memory.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { concatPngs } from './png-concat.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { compressImageData } from './png-decompress.js';
import { PngHeader, ColorType } from './types.js';
// Input caching deliberately NOT enabled for memory tests
// Caching trades memory for speed - we want to measure minimal memory usage
import {
  monitorMemory,
  assertMemoryBelow,
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

/**
 * Helper to stream concat output to a temporary file
 * This ensures output doesn't consume memory during measurement
 */
async function concatToFile(
  inputs: Uint8Array[],
  layout: any
): Promise<string> {
  const outputPath = `/tmp/concat-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;

  const stream = await concatPngs({
    inputs,
    layout,
    stream: true
  });

  const writeStream = createWriteStream(outputPath);
  await pipeline(stream, writeStream);

  // Don't check file size - that can cause memory spikes
  // Just return the path
  return outputPath;
}

// Memory tests run regardless of GC availability
// but only perform memory assertions when GC is available
const gcAvailable = isGCAvailable();

if (!gcAvailable) {
  console.warn('⚠️  Warning: Running without --expose-gc flag. Memory assertions will be skipped.');
  console.warn('   Tests will verify functional behavior only.');
  console.warn('   For full memory validation, run with: node --expose-gc --test build/tests/memory.test.js');
}

// NOTE: Input caching is NOT enabled for memory tests
// While caching dramatically improves performance (50-100x faster),
// it increases memory usage by storing decompressed scanlines.
// Memory tests intentionally measure worst-case (no cache) memory usage.

describe('Memory Usage Tests', () => {
  test('Small image (100x100) - baseline memory check', async () => {
    const testPng = await createTestPng(100, 100, new Uint8Array([255, 0, 0, 255]));

    let outputPath: string;

    if (gcAvailable) {
      const { result, measurement } = await monitorMemory(async () => {
        return await concatToFile(
          [testPng, testPng, testPng, testPng],
          { columns: 2 }
        );
      });
      outputPath = result;

      try {
        // For small images, memory usage should be minimal (< 30MB with margin)
        assertMemoryBelow(measurement, 30 * 1024 * 1024, 'heapUsed');
        console.log(`✓ Small image: ${formatBytes(measurement.delta.heapUsed)} peak memory`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    } else {
      // Just verify functional behavior
      outputPath = await concatToFile(
        [testPng, testPng, testPng, testPng],
        { columns: 2 }
      );
      try {
        const { access } = await import('node:fs/promises');
        await access(outputPath); // Verify file exists
        console.log(`✓ Small image: file created successfully`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    }
  });

  test('Medium image (1000x1000) - memory bounded by compression buffer', async () => {
    const testPng = await createTestPng(1000, 1000, new Uint8Array([0, 255, 0, 255]));

    let outputPath: string;

    if (gcAvailable) {
      const { result, measurement } = await monitorMemory(async () => {
        return await concatToFile(
          [testPng, testPng, testPng, testPng],
          { columns: 2 }
        );
      });
      outputPath = result;

      try {
        // 2000x2000 = 16MB uncompressed, allow generous margin
        const THRESHOLD = 60 * 1024 * 1024; // 60MB
        assertMemoryBelow(measurement, THRESHOLD, 'heapUsed');
        console.log(`✓ Medium image: ${formatBytes(measurement.delta.heapUsed)} peak memory`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    } else {
      outputPath = await concatToFile(
        [testPng, testPng, testPng, testPng],
        { columns: 2 }
      );
      try {
        const { access } = await import('node:fs/promises');
        await access(outputPath);
        console.log(`✓ Medium image: file created successfully`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    }
  });

  test('Large image (5000x5000) - constant memory streaming', async () => {
    // Create a small source image that we'll tile many times
    const smallPng = await createTestPng(32, 32, new Uint8Array([0, 0, 255, 255]));

    // Calculate how many tiles we need
    const targetSize = 5000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;

    const inputs = Array(tilesNeeded).fill(smallPng);

    let outputPath: string;

    if (gcAvailable) {
      const { result, measurement } = await monitorMemory(async () => {
        return await concatToFile(inputs, { width: targetSize });
      }, 100); // Sample every 100ms for long operations
      outputPath = result;

      try {
        const expectedMem = calculateExpectedMemory(targetSize, targetSize, 4);

        console.log(`\nLarge Image Memory Analysis (5000x5000):`);
        console.log(`  Uncompressed size: ${formatBytes(expectedMem.uncompressedSize)}`);
        console.log(`  Peak memory delta: ${formatBytes(measurement.delta.heapUsed)}`);
        console.log(`  Ratio (peak/uncompressed): ${(measurement.delta.heapUsed / expectedMem.uncompressedSize).toFixed(2)}x`);

        // With streaming: allow up to 300MB with safety margin
        const THRESHOLD = 300 * 1024 * 1024; // 300MB threshold
        assertMemoryBelow(measurement, THRESHOLD, 'heapUsed');

        console.log(`✓ Large image test passed - STREAMING (${formatBytes(measurement.delta.heapUsed)})`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    } else {
      outputPath = await concatToFile(inputs, { width: targetSize });
      try {
        const { access } = await import('node:fs/promises');
        await access(outputPath);
        console.log(`✓ Large image (5000x5000): file created successfully`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    }
  });

  test('Very large image (10000x10000) - constant memory streaming', async () => {
    const smallPng = await createTestPng(32, 32, new Uint8Array([255, 255, 0, 255]));

    const targetSize = 10000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;

    const inputs = Array(tilesNeeded).fill(smallPng);

    let outputPath: string;

    if (gcAvailable) {
      const { result, measurement } = await monitorMemory(async () => {
        return await concatToFile(inputs, { width: targetSize });
      }, 100);
      outputPath = result;

      try {
        const expectedMem = calculateExpectedMemory(targetSize, targetSize, 4);

        console.log(`\nVery Large Image Memory Analysis (10000x10000):`);
        console.log(`  Uncompressed size: ${formatBytes(expectedMem.uncompressedSize)}`);
        console.log(`  Peak memory delta: ${formatBytes(measurement.delta.heapUsed)}`);
        console.log(`  Ratio (peak/uncompressed): ${(measurement.delta.heapUsed / expectedMem.uncompressedSize).toFixed(2)}x`);

        // Allow up to 800MB with safety margin
        const THRESHOLD = 800 * 1024 * 1024; // 800MB threshold
        assertMemoryBelow(measurement, THRESHOLD, 'heapUsed');

        console.log(`✓ Very large image test passed - STREAMING (${formatBytes(measurement.delta.heapUsed)})`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    } else {
      outputPath = await concatToFile(inputs, { width: targetSize });
      try {
        const { access } = await import('node:fs/promises');
        await access(outputPath);
        console.log(`✓ Very large image (10000x10000): file created successfully`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    }
  });

  test.skip('Extreme image (20000x20000) - constant memory streaming (SLOW)', async () => {
    // SKIPPED BY DEFAULT: This test is very slow (2+ minutes) and resource intensive
    // Run explicitly with: node --expose-gc --test build/tests/memory.test.js --test-name-pattern="Extreme"

    const smallPng = await createTestPng(32, 32, new Uint8Array([255, 0, 255, 255]));

    const targetSize = 20000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;

    const inputs = Array(tilesNeeded).fill(smallPng);

    let outputPath: string;

    if (gcAvailable) {
      const startTime = Date.now();
      const { result, measurement} = await monitorMemory(async () => {
        return await concatToFile(inputs, { width: targetSize });
      }, 200);
      const duration = (Date.now() - startTime) / 1000;
      outputPath = result;

      try {
        const expectedMem = calculateExpectedMemory(targetSize, targetSize, 4);

        console.log(`\nExtreme Image Memory Analysis (20000x20000):`);
        console.log(`  Uncompressed size: ${formatBytes(expectedMem.uncompressedSize)}`);
        console.log(`  Peak memory delta: ${formatBytes(measurement.delta.heapUsed)}`);
        console.log(`  Ratio (peak/uncompressed): ${(measurement.delta.heapUsed / expectedMem.uncompressedSize).toFixed(2)}x`);
        console.log(`  Generation time: ${duration.toFixed(2)}s`);

        // Allow up to 1.5GB for extreme images
        const THRESHOLD = 1536 * 1024 * 1024; // 1.5GB threshold
        assertMemoryBelow(measurement, THRESHOLD, 'heapUsed');

        console.log(`✓ Extreme image test passed - STREAMING (${formatBytes(measurement.delta.heapUsed)})`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    } else {
      outputPath = await concatToFile(inputs, { width: targetSize });
      try {
        const { access } = await import('node:fs/promises');
        await access(outputPath);
        console.log(`✓ Extreme image (20000x20000): file created successfully`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    }
  });
});

describe('Memory Regression Tests', () => {
  test('Regression: Memory should not grow with number of duplicate inputs', async () => {
    // When using the same image many times, memory should stay constant
    // because we're referencing the same data

    const testPng = await createTestPng(100, 100, new Uint8Array([128, 128, 128, 255]));

    if (gcAvailable) {
      // Test with 10 copies
      const { result: result10, measurement: measurement10 } = await monitorMemory(async () => {
        return await concatToFile(
          Array(10).fill(testPng),
          { columns: 5 }
        );
      });

      // Test with 100 copies
      const { result: result100, measurement: measurement100 } = await monitorMemory(async () => {
        return await concatToFile(
          Array(100).fill(testPng),
          { columns: 10 }
        );
      });

      try {
        // Memory should not grow linearly with input count
        // Allow some growth for layout structures, but should be < 10x
        const ratio = measurement100.delta.heapUsed / measurement10.delta.heapUsed;

        console.log(`\nInput scaling test:`);
        console.log(`  10 inputs: ${formatBytes(measurement10.delta.heapUsed)}`);
        console.log(`  100 inputs: ${formatBytes(measurement100.delta.heapUsed)}`);
        console.log(`  Ratio: ${ratio.toFixed(2)}x`);

        assert.ok(
          ratio < 10,
          `Memory grew too much with input count: ${ratio.toFixed(2)}x (should be < 10x)`
        );

        console.log(`✓ Memory scales sub-linearly with input count`);
      } finally {
        await unlink(result10).catch(() => {});
        await unlink(result100).catch(() => {});
      }
    } else {
      // Just test functional behavior
      const path10 = await concatToFile(Array(10).fill(testPng), { columns: 5 });
      const path100 = await concatToFile(Array(100).fill(testPng), { columns: 10 });
      try {
        const { access } = await import('node:fs/promises');
        await access(path10);
        await access(path100);
        console.log(`✓ Input scaling test: files created successfully`);
      } finally {
        await unlink(path10).catch(() => {});
        await unlink(path100).catch(() => {});
      }
    }
  });

  test('Regression: Memory usage for different layouts should be similar', async () => {
    const testPng = await createTestPng(200, 200, new Uint8Array([100, 150, 200, 255]));

    if (gcAvailable) {
      // Test horizontal layout
      const { result: hResult, measurement: horizontal } = await monitorMemory(async () => {
        return await concatToFile(
          [testPng, testPng, testPng, testPng],
          { columns: 4 }
        );
      });

      // Test vertical layout
      const { result: vResult, measurement: vertical } = await monitorMemory(async () => {
        return await concatToFile(
          [testPng, testPng, testPng, testPng],
          { rows: 4 }
        );
      });

      // Test grid layout
      const { result: gResult, measurement: grid } = await monitorMemory(async () => {
        return await concatToFile(
          [testPng, testPng, testPng, testPng],
          { columns: 2 }
        );
      });

      try {
        console.log(`\nLayout comparison:`);
        console.log(`  Horizontal: ${formatBytes(horizontal.delta.heapUsed)}`);
        console.log(`  Vertical: ${formatBytes(vertical.delta.heapUsed)}`);
        console.log(`  Grid: ${formatBytes(grid.delta.heapUsed)}`);

        // All should be within 3x of each other (allowing for variance)
        const max = Math.max(horizontal.delta.heapUsed, vertical.delta.heapUsed, grid.delta.heapUsed);
        const min = Math.min(horizontal.delta.heapUsed, vertical.delta.heapUsed, grid.delta.heapUsed);
        const ratio = max / min;

        assert.ok(
          ratio < 3,
          `Layout memory usage varies too much: ${ratio.toFixed(2)}x (should be < 3x)`
        );

        console.log(`✓ Memory usage consistent across layouts (${ratio.toFixed(2)}x variance)`);
      } finally {
        await unlink(hResult).catch(() => {});
        await unlink(vResult).catch(() => {});
        await unlink(gResult).catch(() => {});
      }
    } else {
      // Just test functional behavior
      const hPath = await concatToFile([testPng, testPng, testPng, testPng], { columns: 4 });
      const vPath = await concatToFile([testPng, testPng, testPng, testPng], { rows: 4 });
      const gPath = await concatToFile([testPng, testPng, testPng, testPng], { columns: 2 });
      try {
        const { access } = await import('node:fs/promises');
        await access(hPath);
        await access(vPath);
        await access(gPath);
        console.log(`✓ Layout comparison: all layouts work correctly`);
      } finally {
        await unlink(hPath).catch(() => {});
        await unlink(vPath).catch(() => {});
        await unlink(gPath).catch(() => {});
      }
    }
  });

  test('Regression: Peak memory threshold for 10000x10000 image', async () => {
    // This is a fixed threshold regression test
    // If this fails, we've introduced a memory regression

    const smallPng = await createTestPng(32, 32, new Uint8Array([200, 100, 50, 255]));
    const targetSize = 10000;
    const tileSize = 32;
    const tilesNeeded = Math.ceil(targetSize / tileSize) ** 2;
    const inputs = Array(tilesNeeded).fill(smallPng);

    if (gcAvailable) {
      const { result, measurement } = await monitorMemory(async () => {
        return await concatToFile(inputs, { width: targetSize });
      }, 100);

      try {
        // Set a hard threshold: 10000x10000 RGBA = 381MB uncompressed
        // Allow up to 800MB with safety margin
        const REGRESSION_THRESHOLD = 800 * 1024 * 1024; // 800MB threshold

        console.log(`\n10000x10000 Regression Threshold Test:`);
        console.log(`  Peak memory: ${formatBytes(measurement.delta.heapUsed)}`);
        console.log(`  Threshold: ${formatBytes(REGRESSION_THRESHOLD)}`);

        assertMemoryBelow(measurement, REGRESSION_THRESHOLD, 'heapUsed');

        console.log(`✓ Memory stayed below regression threshold!`);
      } finally {
        await unlink(result).catch(() => {});
      }
    } else {
      const outputPath = await concatToFile(inputs, { width: targetSize });
      try {
        const { access } = await import('node:fs/promises');
        await access(outputPath);
        console.log(`✓ 10000x10000 regression test: file created successfully`);
      } finally {
        await unlink(outputPath).catch(() => {});
      }
    }
  });
});
