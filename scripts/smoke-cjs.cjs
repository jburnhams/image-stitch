const path = require('node:path');
const assert = require('node:assert');

const cjsPath = path.join(__dirname, '..', 'dist', 'cjs', 'index.cjs');
const mod = require(cjsPath);

assert.strictEqual(typeof mod.concat, 'function', 'CJS build should export concat');
assert.strictEqual(typeof mod.StreamingConcatenator, 'function', 'CJS build should export StreamingConcatenator');

console.log('cjs smoke test passed');
