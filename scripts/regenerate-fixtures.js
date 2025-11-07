#!/usr/bin/env node

/**
 * Regenerate test fixtures using the new Web Compression Streams API implementation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { concat } from './image-concat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pngsuiteDir = path.join(__dirname, '..', 'pngsuite', 'png');
const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures', 'expected-outputs');

function loadImage(filename) {
  return fs.readFileSync(path.join(pngsuiteDir, filename));
}

async function regenerateFixtures() {
  console.log('Regenerating test fixtures...\n');

  // Example 1: Horizontal concatenation
  console.log('Generating example1.png (horizontal concatenation)...');
  const result1 = await concat({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png')
    ],
    layout: { columns: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example1.png'), result1);
  console.log(`✓ example1.png (${result1.length} bytes)`);

  // Example 2: Vertical concatenation
  console.log('Generating example2.png (vertical concatenation)...');
  const result2 = await concat({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png')
    ],
    layout: { rows: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example2.png'), result2);
  console.log(`✓ example2.png (${result2.length} bytes)`);

  // Example 3: Grid layout
  console.log('Generating example3.png (grid layout)...');
  const result3 = await concat({
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
  fs.writeFileSync(path.join(fixturesDir, 'example3.png'), result3);
  console.log(`✓ example3.png (${result3.length} bytes)`);

  // Example 4: Different image sizes
  console.log('Generating example4.png (different sizes)...');
  const result4 = await concat({
    inputs: [
      loadImage('basn0g01.png'),
      loadImage('basn0g04.png'),
      loadImage('basn2c08.png')
    ],
    layout: { columns: 3 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example4.png'), result4);
  console.log(`✓ example4.png (${result4.length} bytes)`);

  // Example 5: Width limit with wrapping
  console.log('Generating example5.png (width limit)...');
  const result5 = await concat({
    inputs: [
      loadImage('basn2c08.png'),
      loadImage('basn0g08.png'),
      loadImage('basn6a08.png'),
      loadImage('basn4a08.png')
    ],
    layout: { width: 100 }
  });
  fs.writeFileSync(path.join(fixturesDir, 'example5.png'), result5);
  console.log(`✓ example5.png (${result5.length} bytes)`);

  console.log('\n✅ All fixtures regenerated successfully!');
}

regenerateFixtures().catch(err => {
  console.error('Error regenerating fixtures:', err);
  process.exit(1);
});
