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
const docsDir = path.join(__dirname, '..', 'docs');
const outputFile = path.join(docsDir, 'png-concat.bundle.js');

// Read all the source files
const modules = {
  'types.js': fs.readFileSync(path.join(distDir, 'types.js'), 'utf8'),
  'utils.js': fs.readFileSync(path.join(distDir, 'utils.js'), 'utf8'),
  'png-parser.js': fs.readFileSync(path.join(distDir, 'png-parser.js'), 'utf8'),
  'png-writer.js': fs.readFileSync(path.join(distDir, 'png-writer.js'), 'utf8'),
  'png-filter.js': fs.readFileSync(path.join(distDir, 'png-filter.js'), 'utf8'),
  'png-decompress.js': fs.readFileSync(path.join(distDir, 'png-decompress.js'), 'utf8'),
  'pixel-ops.js': fs.readFileSync(path.join(distDir, 'pixel-ops.js'), 'utf8'),
  'png-concat-unified.js': fs.readFileSync(path.join(distDir, 'png-concat-unified.js'), 'utf8'),
};

// Process each module to inline imports
function processModule(code, moduleName) {
  // Remove export declarations but keep the code
  code = code.replace(/^export \{[^}]+\};?\s*$/gm, '');

  // Remove import statements - we'll inline everything
  code = code.replace(/^import .+ from ['"][^'"]+['"];?\s*$/gm, '');

  // Keep export declarations for the final API
  if (moduleName === 'png-concat-unified.js') {
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
 * png-concat browser bundle
 * Generated on ${new Date().toISOString()}
 */

`;

// Add all modules except the main one
for (const [moduleName, code] of Object.entries(modules)) {
  if (moduleName !== 'png-concat-unified.js') {
    bundle += `\n// ===== ${moduleName} =====\n`;
    bundle += processModule(code, moduleName);
    bundle += '\n';
  }
}

// Add the main export module last
bundle += '\n// ===== Main API =====\n';
bundle += processModule(modules['png-concat-unified.js'], 'png-concat-unified.js');

// Write the bundle
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(outputFile, bundle);

console.log(`Bundle created: ${outputFile}`);
console.log(`Size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);
