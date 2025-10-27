/**
 * Basic usage example for png-concat
 *
 * This example shows how to concatenate PNG images
 */

import { writeFileSync } from 'node:fs';
import { concatPngs } from '../dist/index.js';
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

  // Create 4 colored PNG images (100x100 each)
  const redPng = createColoredPng(100, 100, 255, 0, 0);
  const greenPng = createColoredPng(100, 100, 0, 255, 0);
  const bluePng = createColoredPng(100, 100, 0, 0, 255);
  const yellowPng = createColoredPng(100, 100, 255, 255, 0);

  console.log('Concatenating images in a 2x2 grid...');

  // Concatenate into a 2x2 grid
  const result = await concatPngs({
    inputs: [redPng, greenPng, bluePng, yellowPng],
    layout: { columns: 2 }
  });

  // Save the result
  writeFileSync('examples/output-grid-2x2.png', result);
  console.log('✓ Saved: examples/output-grid-2x2.png (200x200, 2x2 grid)');

  // Example 2: Horizontal strip
  console.log('\nConcatenating images horizontally...');
  const horizontal = await concatPngs({
    inputs: [redPng, greenPng, bluePng, yellowPng],
    layout: { columns: 4 }
  });

  writeFileSync('examples/output-horizontal.png', horizontal);
  console.log('✓ Saved: examples/output-horizontal.png (400x100, 1x4 strip)');

  // Example 3: Vertical strip
  console.log('\nConcatenating images vertically...');
  const vertical = await concatPngs({
    inputs: [redPng, greenPng, bluePng, yellowPng],
    layout: { rows: 4 }
  });

  writeFileSync('examples/output-vertical.png', vertical);
  console.log('✓ Saved: examples/output-vertical.png (100x400, 4x1 strip)');

  console.log('\n✓ All examples completed successfully!');
  console.log('\nGenerated files:');
  console.log('  - examples/output-grid-2x2.png');
  console.log('  - examples/output-horizontal.png');
  console.log('  - examples/output-vertical.png');
}

main().catch(console.error);
