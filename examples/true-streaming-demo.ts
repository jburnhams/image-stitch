/**
 * True Streaming Demo - Demonstrating scanline-by-scanline processing
 *
 * This example shows the memory usage difference between:
 * 1. Regular concatenation (loads everything)
 * 2. Streaming output (streams serialized chunks)
 * 3. True streaming (processes scanline-by-scanline)
 */

import { writeFileSync, createWriteStream } from 'node:fs';
import { concatPngs } from '../dist/index.js';
import { concatPngsStream } from '../dist/index.js';
import { concatPngsTrueStreaming } from '../dist/png-concat-true-streaming.js';
import { createIHDR, createIEND, createChunk, buildPng } from '../dist/index.js';
import { compressImageData } from '../dist/index.js';
import { PngHeader, ColorType } from '../dist/index.js';

/**
 * Helper to create larger test images
 */
function createLargeColoredPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  pattern: 'solid' | 'gradient' | 'checkerboard' = 'solid'
): Uint8Array {
  const header: PngHeader = {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  console.log(`  Creating ${width}x${height} image (${(width * height * 4 / 1024 / 1024).toFixed(1)} MB uncompressed)...`);

  const pixelData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      switch (pattern) {
        case 'gradient':
          pixelData[i] = Math.floor(r * x / width);
          pixelData[i + 1] = Math.floor(g * y / height);
          pixelData[i + 2] = b;
          pixelData[i + 3] = 255;
          break;

        case 'checkerboard':
          const checker = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) === 0;
          pixelData[i] = checker ? r : 255 - r;
          pixelData[i + 1] = checker ? g : 255 - g;
          pixelData[i + 2] = checker ? b : 255 - b;
          pixelData[i + 3] = 255;
          break;

        case 'solid':
        default:
          pixelData[i] = r;
          pixelData[i + 1] = g;
          pixelData[i + 2] = b;
          pixelData[i + 3] = 255;
          break;
      }
    }
  }

  const compressed = compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  const png = buildPng([ihdr, idat, iend]);
  console.log(`  Compressed to ${(png.length / 1024).toFixed(1)} KB`);

  return png;
}

async function measureMemory(label: string) {
  if (global.gc) {
    global.gc();
  }
  await new Promise(resolve => setTimeout(resolve, 100));

  const usage = process.memoryUsage();
  console.log(`\n[${label}] Memory Usage:`);
  console.log(`  RSS:      ${(usage.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap:     ${(usage.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  External: ${(usage.external / 1024 / 1024).toFixed(1)} MB`);

  return usage;
}

async function main() {
  console.log('='.repeat(80));
  console.log('TRUE STREAMING DEMONSTRATION');
  console.log('='.repeat(80));

  // Create moderately sized test images
  const imageSize = 800; // 800x800 pixels
  console.log(`\nCreating test images (${imageSize}x${imageSize} each)...`);

  const red = createLargeColoredPng(imageSize, imageSize, 255, 0, 0, 'gradient');
  const green = createLargeColoredPng(imageSize, imageSize, 0, 255, 0, 'gradient');
  const blue = createLargeColoredPng(imageSize, imageSize, 0, 0, 255, 'gradient');
  const yellow = createLargeColoredPng(imageSize, imageSize, 255, 255, 0, 'checkerboard');

  // Save test images
  writeFileSync('examples/test-red.png', red);
  writeFileSync('examples/test-green.png', green);
  writeFileSync('examples/test-blue.png', blue);
  writeFileSync('examples/test-yellow.png', yellow);

  const inputs = [
    'examples/test-red.png',
    'examples/test-green.png',
    'examples/test-blue.png',
    'examples/test-yellow.png'
  ];

  const layout = { columns: 2 };

  await measureMemory('Initial');

  // =========================================================================
  // Method 1: Regular concatenation (loads everything)
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('METHOD 1: Regular Concatenation (loads everything)');
  console.log('='.repeat(80));

  const startRegular = Date.now();
  const regularResult = await concatPngs({ inputs, layout });
  const timeRegular = Date.now() - startRegular;

  writeFileSync('examples/output-regular.png', regularResult);
  console.log(`\nCompleted in ${timeRegular}ms`);
  console.log(`Output size: ${(regularResult.length / 1024).toFixed(1)} KB`);

  const memRegular = await measureMemory('After Regular');

  // =========================================================================
  // Method 2: Streaming output (streams serialized chunks)
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('METHOD 2: Streaming Output (streams serialized chunks)');
  console.log('='.repeat(80));

  const startStream = Date.now();
  const streamOutput = createWriteStream('examples/output-stream.png');

  let streamBytes = 0;
  for await (const chunk of concatPngsStream({ inputs, layout })) {
    streamOutput.write(chunk);
    streamBytes += chunk.length;
  }
  streamOutput.end();

  await new Promise((resolve) => streamOutput.on('finish', resolve));
  const timeStream = Date.now() - startStream;

  console.log(`\nCompleted in ${timeStream}ms`);
  console.log(`Output size: ${(streamBytes / 1024).toFixed(1)} KB`);

  const memStream = await measureMemory('After Streaming');

  // =========================================================================
  // Method 3: True streaming (scanline-by-scanline)
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('METHOD 3: True Streaming (scanline-by-scanline)');
  console.log('='.repeat(80));

  const startTrueStream = Date.now();
  const trueStreamOutput = createWriteStream('examples/output-true-stream.png');

  let trueStreamBytes = 0;
  let chunksYielded = 0;

  for await (const chunk of concatPngsTrueStreaming({ inputs, layout })) {
    trueStreamOutput.write(chunk);
    trueStreamBytes += chunk.length;
    chunksYielded++;

    if (chunksYielded % 10 === 0) {
      process.stdout.write(`\r  Progress: ${chunksYielded} chunks, ${(trueStreamBytes / 1024).toFixed(1)} KB`);
    }
  }
  trueStreamOutput.end();

  await new Promise((resolve) => trueStreamOutput.on('finish', resolve));
  const timeTrueStream = Date.now() - startTrueStream;

  console.log(`\n\nCompleted in ${timeTrueStream}ms`);
  console.log(`Output size: ${(trueStreamBytes / 1024).toFixed(1)} KB`);
  console.log(`Chunks yielded: ${chunksYielded}`);

  const memTrueStream = await measureMemory('After True Streaming');

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  console.log('\nPerformance:');
  console.log(`  Regular:        ${timeRegular}ms`);
  console.log(`  Streaming:      ${timeStream}ms`);
  console.log(`  True Streaming: ${timeTrueStream}ms`);

  console.log('\nPeak Memory (Heap Used):');
  console.log(`  Regular:        ${(memRegular.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Streaming:      ${(memStream.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  True Streaming: ${(memTrueStream.heapUsed / 1024 / 1024).toFixed(1)} MB`);

  console.log('\nOutput Files:');
  console.log('  examples/output-regular.png');
  console.log('  examples/output-stream.png');
  console.log('  examples/output-true-stream.png');

  console.log('\nNote: Run with --expose-gc for accurate memory measurements:');
  console.log('  node --expose-gc examples/true-streaming-demo.js');

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
