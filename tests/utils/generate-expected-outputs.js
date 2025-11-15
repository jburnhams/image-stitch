#!/usr/bin/env node

/**
 * Generate expected output images for browser integration tests
 * This creates the reference images that the tests will compare against
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { concatToBuffer } from '../../src/image-concat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, 'fixtures', 'expected-outputs');
const pngsuiteDir = path.join(__dirname, '..', '..', 'pngsuite', 'png');

// Create fixtures directory
fs.mkdirSync(fixturesDir, { recursive: true });

console.log('Generating expected output images...\n');

// Helper to load an image
function loadImage(filename) {
  return fs.readFileSync(path.join(pngsuiteDir, filename));
}

// Example 1: Horizontal Concatenation (3 images in a row)
async function generateExample1() {
  console.log('Example 1: Horizontal concatenation...');
  const result = await concatToBuffer({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png')
    ],
    layout: { columns: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example1.png'), result);
  console.log(`  ✓ Saved example1.png (${result.length} bytes)`);
}

// Example 2: Vertical Concatenation (3 images stacked)
async function generateExample2() {
  console.log('Example 2: Vertical concatenation...');
  const result = await concatToBuffer({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png')
    ],
    layout: { rows: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example2.png'), result);
  console.log(`  ✓ Saved example2.png (${result.length} bytes)`);
}

// Example 3: Grid Layout (2x3 grid)
async function generateExample3() {
  console.log('Example 3: Grid layout...');
  const result = await concatToBuffer({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png'),
      loadImage('basn4a08.png'),
      loadImage('basn2c16.png'),
      loadImage('basn0g16.png')
    ],
    layout: { columns: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example3.png'), result);
  console.log(`  ✓ Saved example3.png (${result.length} bytes)`);
}

// Example 4: Different Image Sizes
async function generateExample4() {
  console.log('Example 4: Different image sizes...');
  const result = await concatToBuffer({
    inputs: [
      loadImage('basn0g01.png'),
      loadImage('basn0g04.png'),
      loadImage('basn2c08.png')
    ],
    layout: { columns: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example4.png'), result);
  console.log(`  ✓ Saved example4.png (${result.length} bytes)`);
}

// Example 5: Width Limit with Wrapping
async function generateExample5() {
  console.log('Example 5: Width limit with wrapping...');
  const result = await concatToBuffer({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png'),
      loadImage('basn4a08.png')
    ],
    layout: { width: 100 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example5.png'), result);
  console.log(`  ✓ Saved example5.png (${result.length} bytes)`);
}

// Generate all examples
(async () => {
  try {
    await generateExample1();
    await generateExample2();
    await generateExample3();
    await generateExample4();
    await generateExample5();
    console.log('\n✅ All expected output images generated successfully!');
    console.log(`   Location: ${fixturesDir}`);
  } catch (error) {
    console.error('❌ Error generating images:', error);
    process.exit(1);
  }
})();
