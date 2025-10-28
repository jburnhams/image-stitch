#!/usr/bin/env node

/**
 * Build a browser-compatible bundle of png-concat
 * This script combines all the modules into a single file for browser use
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, '..', 'dist');
const docsSourceDir = path.join(__dirname, '..', 'docs');
const docsDistDir = path.join(__dirname, '..', 'docs-dist');
const outputFile = path.join(docsDistDir, 'image-stitch.bundle.js');

// Read all the source files (order matters - dependencies first)
const modules = {
  'types.js': fs.readFileSync(path.join(distDir, 'types.js'), 'utf8'),
  'utils.js': fs.readFileSync(path.join(distDir, 'utils.js'), 'utf8'),
  'png-parser.js': fs.readFileSync(path.join(distDir, 'png-parser.js'), 'utf8'),
  'png-writer.js': fs.readFileSync(path.join(distDir, 'png-writer.js'), 'utf8'),
  'png-filter.js': fs.readFileSync(path.join(distDir, 'png-filter.js'), 'utf8'),
  'png-decompress.js': fs.readFileSync(path.join(distDir, 'png-decompress.js'), 'utf8'),
  'pixel-ops.js': fs.readFileSync(path.join(distDir, 'pixel-ops.js'), 'utf8'),
  'png-input-adapter.js': fs.readFileSync(path.join(distDir, 'png-input-adapter.js'), 'utf8'),
  'png-concat.js': fs.readFileSync(path.join(distDir, 'png-concat.js'), 'utf8'),
};

// Process each module to inline imports
function processModule(code, moduleName) {
  // Remove export declarations but keep the code
  code = code.replace(/^export \{[^}]+\};?\s*$/gm, '');

  // Remove ALL import statements - we're inlining everything
  code = code.replace(/^import .+ from ['"][^'"]+['"];?\s*$/gm, '');

  // Keep export declarations for the final API
  if (moduleName === 'png-concat.js') {
    // This is our main export module
    return code;
  } else {
    // For other modules, convert exports to regular declarations
    code = code.replace(/^export (const|let|var|function|class|async function)/gm, '$1');
    code = code.replace(/^export default /gm, '');
  }

  return code;
}

// Build the bundle
console.log('Building browser bundle...');

let bundle = `/**
 * image-stitch browser bundle
 * Generated on ${new Date().toISOString()}
 * Uses Web Compression Streams API (works in Node.js 20+ and modern browsers)
 */

`;

// Add all modules except the main one
for (const [moduleName, code] of Object.entries(modules)) {
  if (moduleName !== 'png-concat.js') {
    bundle += `\n// ===== ${moduleName} =====\n`;
    bundle += processModule(code, moduleName);
    bundle += '\n';
  }
}

// Add the main export module last
bundle += '\n// ===== Main API =====\n';
bundle += processModule(modules['png-concat.js'], 'png-concat.js');

// Create docs-dist directory
fs.mkdirSync(docsDistDir, { recursive: true });

// Copy all files from docs source to docs-dist
function copyRecursive(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying docs source files...');
copyRecursive(docsSourceDir, docsDistDir);

// Copy sample images from pngsuite to docs-dist/images
console.log('Copying sample images from pngsuite...');
const pngsuiteDir = path.join(__dirname, '..', 'pngsuite', 'png');
const imagesDistDir = path.join(docsDistDir, 'images');
fs.mkdirSync(imagesDistDir, { recursive: true });

const requiredImages = [
  'basn2c08.png',
  'basn0g08.png',
  'basn6a08.png',
  'basn4a08.png',
  'basn2c16.png',
  'basn0g16.png',
  'basn0g01.png',
  'basn0g04.png',
  'basi2c08.png',
  'f00n2c08.png',
  'f01n2c08.png',
  'f02n2c08.png',
  'f03n2c08.png',
  'f04n2c08.png',
  'g03n2c08.png',
  'g04n2c08.png',
  'g05n2c08.png',
];

for (const imageName of requiredImages) {
  const srcPath = path.join(pngsuiteDir, imageName);
  const destPath = path.join(imagesDistDir, imageName);
  fs.copyFileSync(srcPath, destPath);
}

console.log(`Copied ${requiredImages.length} images`);

// Write the bundle
fs.writeFileSync(outputFile, bundle);

console.log(`Bundle created: ${outputFile}`);
console.log(`Size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);
