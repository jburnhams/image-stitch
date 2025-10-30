import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const esmPath = path.join(__dirname, '..', 'dist', 'esm', 'index.js');
const mod = await import(pathToFileURL(esmPath).href);

assert.strictEqual(typeof mod.concatPngs, 'function', 'ESM build should export concatPngs');
assert.strictEqual(typeof mod.StreamingConcatenator, 'function', 'ESM build should export StreamingConcatenator');

console.log('esm smoke test passed');
