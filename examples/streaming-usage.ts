/**
 * Streaming usage example for png-concat
 *
 * This example shows how to concatenate PNG images using streaming output
 * to avoid loading the entire result into memory.
 */

import { createWriteStream } from 'node:fs';
import { concatPngsStream, concatPngsToStream } from '../dist/index.js';
import { createIHDR, createIEND, createChunk, buildPng } from '../dist/index.js';
import { compressImageData } from '../dist/index.js';
import { PngHeader, ColorType } from '../dist/index.js';

/**
 * Helper function to create a test PNG with a solid color
 */
function createColoredPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 255
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

  // Create pixel data with solid color
  const pixelData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixelData[i * 4] = r;
    pixelData[i * 4 + 1] = g;
    pixelData[i * 4 + 2] = b;
    pixelData[i * 4 + 3] = a;
  }

  // Compress and build PNG
  const compressed = compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

async function main() {
  console.log('Creating test images...');

  // Create 4 colored PNG images (200x200 each for larger files)
  const redPng = createColoredPng(200, 200, 255, 0, 0);
  const greenPng = createColoredPng(200, 200, 0, 255, 0);
  const bluePng = createColoredPng(200, 200, 0, 0, 255);
  const yellowPng = createColoredPng(200, 200, 255, 255, 0);

  console.log('Input sizes:');
  console.log(`  Red:    ${redPng.length} bytes`);
  console.log(`  Green:  ${greenPng.length} bytes`);
  console.log(`  Blue:   ${bluePng.length} bytes`);
  console.log(`  Yellow: ${yellowPng.length} bytes`);

  // Example 1: Using async generator with manual writes
  console.log('\n[Example 1] Using async generator...');
  const writeStream1 = createWriteStream('examples/output-stream-generator.png');

  let totalBytesWritten = 0;
  for await (const chunk of concatPngsStream({
    inputs: [redPng, greenPng, bluePng, yellowPng],
    layout: { columns: 2 }
  })) {
    writeStream1.write(chunk);
    totalBytesWritten += chunk.length;
    console.log(`  Wrote chunk: ${chunk.length} bytes (total: ${totalBytesWritten})`);
  }

  writeStream1.end();
  await new Promise<void>(resolve => writeStream1.on('finish', () => resolve()));
  console.log('✓ Saved: examples/output-stream-generator.png');

  // Example 2: Using Node.js stream with pipe
  console.log('\n[Example 2] Using Node.js stream with pipe...');
  const readStream = concatPngsToStream({
    inputs: [redPng, greenPng, bluePng, yellowPng],
    layout: { rows: 4 }
  });

  const writeStream2 = createWriteStream('examples/output-stream-pipe.png');

  let pipeBytes = 0;
  readStream.on('data', (chunk) => {
    pipeBytes += chunk.length;
    console.log(`  Streaming chunk: ${chunk.length} bytes (total: ${pipeBytes})`);
  });

  readStream.pipe(writeStream2);

  await new Promise<void>((resolve, reject) => {
    writeStream2.on('finish', () => resolve());
    writeStream2.on('error', reject);
    readStream.on('error', reject);
  });

  console.log('✓ Saved: examples/output-stream-pipe.png');

  console.log('\n✓ All streaming examples completed successfully!');
  console.log('\nGenerated files:');
  console.log('  - examples/output-stream-generator.png (400x400, 2x2 grid)');
  console.log('  - examples/output-stream-pipe.png (200x800, 4x1 strip)');
  console.log('\nNote: Current implementation still processes the full output');
  console.log('      before streaming. Chunks are streamed as they are serialized.');
}

main().catch(console.error);
