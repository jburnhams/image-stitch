/**
 * Simple usage example with the unified API
 *
 * The library automatically chooses the best approach based on your images!
 */

import { writeFileSync, createWriteStream } from 'node:fs';
import { concatPngs, concatPngsToFile } from '../dist/index.js';
import { createIHDR, createIEND, createChunk, buildPng } from '../dist/index.js';
import { compressImageData } from '../dist/index.js';
import { PngHeader, ColorType } from '../dist/index.js';

/**
 * Helper to create test images
 */
async function createColoredPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
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
    pixelData[i * 4] = r;
    pixelData[i * 4 + 1] = g;
    pixelData[i * 4 + 2] = b;
    pixelData[i * 4 + 3] = 255;
  }

  const compressed = await compressImageData(pixelData, header);
  return buildPng([createIHDR(header), createChunk('IDAT', compressed), createIEND()]);
}

async function main() {
  console.log('PNG Concatenation - Simple Unified API\n');

  // Create test images
  const red = await createColoredPng(100, 100, 255, 0, 0);
  const green = await createColoredPng(100, 100, 0, 255, 0);
  const blue = await createColoredPng(100, 100, 0, 0, 255);
  const yellow = await createColoredPng(100, 100, 255, 255, 0);

  // ===================================================================
  // Example 1: Simple - Just get the result
  // ===================================================================
  console.log('Example 1: Simple concatenation\n');

  const result = await concatPngs({
    inputs: [red, green, blue, yellow],
    layout: { columns: 2 }
  });

  writeFileSync('examples/simple-output.png', result);
  console.log('✓ Created simple-output.png (2x2 grid)\n');

  // ===================================================================
  // Example 2: Stream to file (good for large outputs)
  // ===================================================================
  console.log('Example 2: Stream to file\n');

  const stream = await concatPngsToFile({
    inputs: [red, green, blue, yellow],
    layout: { rows: 4 }
  });

  stream.pipe(createWriteStream('examples/simple-stream.png'));
  await new Promise<void>((resolve) => stream.on('end', () => resolve()));

  console.log('✓ Created simple-stream.png (4x1 strip)\n');

  // ===================================================================
  // Example 3: Explicit optimization hints
  // ===================================================================
  console.log('Example 3: With optimization hints\n');

  // Force memory-efficient mode
  const memoryOptimized = await concatPngs({
    inputs: [red, green],
    layout: { columns: 2 },
    optimize: 'memory' // Uses true streaming internally
  });

  writeFileSync('examples/simple-memory.png', memoryOptimized);
  console.log('✓ Created simple-memory.png (memory-optimized)\n');

  // Force speed mode
  const speedOptimized = await concatPngs({
    inputs: [red, green],
    layout: { columns: 2 },
    optimize: 'speed' // Uses fast in-memory mode
  });

  writeFileSync('examples/simple-speed.png', speedOptimized);
  console.log('✓ Created simple-speed.png (speed-optimized)\n');

  // ===================================================================
  // Example 4: Auto mode with memory budget
  // ===================================================================
  console.log('Example 4: Auto mode with custom memory budget\n');

  const autoOptimized = await concatPngs({
    inputs: [red, green, blue, yellow],
    layout: { columns: 2 },
    optimize: 'auto',
    maxMemoryMB: 10 // Library will use true streaming if estimated memory > 10MB
  });

  writeFileSync('examples/simple-auto.png', autoOptimized);
  console.log('✓ Created simple-auto.png (auto-optimized)\n');

  // ===================================================================
  // Summary
  // ===================================================================
  console.log('═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log('\nThe unified API automatically:');
  console.log('  • Chooses the best implementation');
  console.log('  • Uses true streaming for large images');
  console.log('  • Falls back to fast mode for small images');
  console.log('  • Respects memory budget hints');
  console.log('\nYou just call concatPngs() and it figures it out!');
  console.log('\n✨ No need to understand internals or choose modes!\n');

  console.log('Files created:');
  console.log('  • examples/simple-output.png');
  console.log('  • examples/simple-stream.png');
  console.log('  • examples/simple-memory.png');
  console.log('  • examples/simple-speed.png');
  console.log('  • examples/simple-auto.png\n');
}

main().catch(console.error);
