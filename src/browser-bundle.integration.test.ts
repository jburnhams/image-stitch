import { test } from 'node:test';
import * as assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const bundlePath = path.join(projectRoot, 'dist', 'bundles', 'image-stitch.esm.js');
const fixturesDir = path.join(projectRoot, 'pngsuite', 'png');

const SAMPLE_NAMES = ['basi0g08.png', 'basi2c08.png', 'basi4a16.png'];

async function loadBundle() {
  assert.ok(
    fs.existsSync(bundlePath),
    'Browser bundle is missing. Run `npm run build` before executing tests.'
  );

  const moduleUrl = pathToFileURL(bundlePath).href;
  return await import(moduleUrl);
}

test('browser ESM bundle stitches pngsuite samples', async () => {
  const { concatPngs, parsePngHeader } = await loadBundle();

  assert.strictEqual(typeof concatPngs, 'function', 'concatPngs should be exported from the bundle');

  const inputs = SAMPLE_NAMES.map((name) => {
    const absolute = path.join(fixturesDir, name);
    assert.ok(fs.existsSync(absolute), `Fixture ${name} should exist for bundle tests`);
    return fs.readFileSync(absolute);
  });

  const result = await concatPngs({
    inputs,
    layout: { columns: SAMPLE_NAMES.length }
  });

  assert.ok(result instanceof Uint8Array, 'Bundle concatPngs should resolve to bytes');

  const header = parsePngHeader(result);
  assert.strictEqual(header.width, 32 * SAMPLE_NAMES.length, 'Stitched width should add each sample width');
  assert.strictEqual(header.height, 32, 'Stitched output should keep sample height');
});
