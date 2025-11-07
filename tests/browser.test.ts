import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import { PNG } from 'pngjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the generated docs
const docsDistDir = path.resolve(__dirname, '..', '..', 'docs-dist');
const iifeBundlePath = path.join(docsDistDir, 'image-stitch.min.js');
const esmBundlePath = path.join(docsDistDir, 'image-stitch.esm.js');
const indexPath = path.join(docsDistDir, 'index.html');
const guidesPath = path.join(docsDistDir, 'guides.html');
const examplesPath = path.join(docsDistDir, 'examples.html');
const streamingPath = path.join(docsDistDir, 'streaming.html');
const sampleImagesDir = path.join(docsDistDir, 'images');

async function loadDocument(htmlPath: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
    },
  });

  const { document } = window;
  const html = fs.readFileSync(htmlPath, 'utf8');
  document.write(html);

  return { window, document };
}

describe('Browser Bundle Tests', () => {
  test('IIFE bundle attaches ImageStitch global', () => {
    assert.ok(fs.existsSync(iifeBundlePath), 'Minified bundle should exist. Run `npm run build:docs` first.');

    const bundleCode = fs.readFileSync(iifeBundlePath, 'utf8');
    const context: Record<string, any> = { window: {}, globalThis: {} };
    vm.createContext(context);

    assert.doesNotThrow(() => {
      vm.runInContext(bundleCode, context);
    });

    const imageStitchGlobal = context.window.ImageStitch ?? context.globalThis.ImageStitch;
    assert.ok(imageStitchGlobal, 'Global ImageStitch namespace should exist');
    assert.strictEqual(typeof imageStitchGlobal.concat, 'function');
    assert.strictEqual(typeof imageStitchGlobal.concatToFile, 'function');
  });

  test('ESM bundle can be imported directly', async () => {
    assert.ok(fs.existsSync(esmBundlePath), 'ESM bundle should exist. Run `npm run build:docs` first.');

    const moduleUrl = pathToFileURL(esmBundlePath).href;
    const mod = await import(moduleUrl);

    assert.strictEqual(typeof mod.concat, 'function');
    assert.strictEqual(typeof mod.concatToFile, 'function');
    assert.strictEqual(typeof mod.StreamingConcatenator, 'function');
  });

  test('landing page renders feature overview and navigation', async () => {
    assert.ok(fs.existsSync(indexPath), 'index.html should exist');

    const { window, document } = await loadDocument(indexPath);

    assert.strictEqual(
      document.querySelector('header h1')?.textContent?.trim(),
      'image-stitch',
      'Hero title should display library name'
    );

    const navLinks = Array.from(document.querySelectorAll('nav a')).map((link) => link.getAttribute('href'));
    assert.deepStrictEqual(
      navLinks,
      ['examples.html', 'streaming.html', 'guides.html', 'https://github.com/jburnhams/Png-concat'],
      'Navigation should link to examples, streaming demo, guides, and GitHub'
    );

    assert.ok(document.querySelector('.feature-grid'), 'Feature grid should be present');
    assert.ok(document.querySelectorAll('.card').length >= 2, 'Landing page should include feature cards');

    await window.close();
  });

  test('guides page surfaces installation and API docs', async () => {
    assert.ok(fs.existsSync(guidesPath), 'guides.html should exist');

    const { window, document } = await loadDocument(guidesPath);

    const sections = Array.from(document.querySelectorAll('main section'));
    assert.ok(sections.length >= 5, 'Guides page should include multiple sections');

    const navLinks = Array.from(document.querySelectorAll('nav a')).map((link) => link.getAttribute('href'));
    assert.deepStrictEqual(
      navLinks,
      ['index.html', 'examples.html', 'streaming.html', 'https://github.com/jburnhams/Png-concat'],
      'Guides nav should link to overview, examples, streaming demo, and GitHub'
    );

    const codeSamples = document.querySelectorAll('pre code');
    assert.ok(codeSamples.length >= 3, 'Guides page should highlight code samples');

    const apiHeading = Array.from(document.querySelectorAll('h3')).some((heading) =>
      heading.textContent?.includes('concat')
    );
    assert.ok(apiHeading, 'API reference section should document concat');

    await window.close();
  });

  test('examples page exposes interactive demos and assets', async () => {
    assert.ok(fs.existsSync(examplesPath), 'examples.html should exist');

    const { window, document } = await loadDocument(examplesPath);

    const exampleSections = Array.from(document.querySelectorAll('section.example'));
    assert.strictEqual(exampleSections.length, 4, 'Examples page should render four demos');

    const runTargets = exampleSections
      .flatMap((section) => Array.from(section.querySelectorAll('button[data-run]')))
      .map((button) => button.getAttribute('data-run'))
      .filter(Boolean)
      .sort();
    assert.deepStrictEqual(runTargets, ['custom', 'grid', 'horizontal', 'vertical'], 'Each demo should expose a run button');

    const customInput = document.getElementById('custom-files');
    assert.ok(customInput, 'Custom demo should expose file input');

    const resultContainers = document.querySelectorAll('[data-result]');
    assert.strictEqual(resultContainers.length, 4, 'Each example should render a result container');
    resultContainers.forEach((container) => {
      const img = container.querySelector('img');
      assert.ok(img, 'Result containers should include an image element');
    });

    const moduleScript = document.querySelector('script[type="module"]');
    assert.ok(moduleScript, 'Examples page should include module script');
    assert.ok(
      moduleScript?.textContent?.includes('./image-stitch.esm.js'),
      'Module script should load the local ESM bundle'
    );
    assert.ok(
      moduleScript?.textContent?.includes('SAMPLE_MAP'),
      'Module script should reference bundled sample assets'
    );

    await window.close();
  });

  test('all required images exist', () => {
    assert.ok(fs.existsSync(sampleImagesDir), 'Images directory should exist');

    const requiredImages = [
      'basi0g08.png',
      'basn2c08.png',
      'basn0g08.png',
      'basn6a08.png',
      'basn4a08.png',
      'basn2c16.png',
      'basn0g16.png',
      'basn0g01.png',
      'basn0g04.png',
      'basi2c08.png',
      'basi4a16.png',
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
      const imagePath = path.join(sampleImagesDir, imageName);
      assert.ok(fs.existsSync(imagePath), `Image ${imageName} should exist`);

      // Verify it's a valid PNG (starts with PNG signature)
      const imageData = fs.readFileSync(imagePath);
      assert.ok(imageData.length > 8, `Image ${imageName} should have data`);
      assert.strictEqual(imageData[0], 137, `${imageName} should be PNG`);
      assert.strictEqual(imageData[1], 80, `${imageName} should be PNG`);
      assert.strictEqual(imageData[2], 78, `${imageName} should be PNG`);
      assert.strictEqual(imageData[3], 71, `${imageName} should be PNG`);
    }
  });

  test('interactive examples bundle includes pngsuite samples', () => {
    const requiredAssets = ['basi0g08.png', 'basi2c08.png', 'basi4a16.png'];
    for (const asset of requiredAssets) {
      const assetPath = path.join(sampleImagesDir, asset);
      assert.ok(fs.existsSync(assetPath), `Asset ${asset} should be available for browser demos`);
    }
  });

  test('streaming demo exposes StreamingConcatenator-based workflow', async () => {
    assert.ok(fs.existsSync(streamingPath), 'streaming.html should exist');

    const { window, document } = await loadDocument(streamingPath);

    const navLinks = Array.from(document.querySelectorAll('nav a')).map((link) => link.getAttribute('href'));
    assert.deepStrictEqual(
      navLinks,
      ['index.html', 'examples.html', 'guides.html', 'https://github.com/jburnhams/Png-concat'],
      'Streaming nav should link across docs and GitHub'
    );

    const status = document.getElementById('streaming-status');
    const meta = document.getElementById('streaming-meta');
    const previewImg = document.querySelector('#streaming-result img');
    assert.ok(status, 'Streaming page should surface a status element');
    assert.ok(meta, 'Streaming page should include metadata container');
    assert.ok(previewImg, 'Streaming page should render preview image shell');

    const moduleScript = document.querySelector('script[type="module"]');
    assert.ok(moduleScript, 'Streaming page should include module script');
    const scriptSource = moduleScript?.textContent ?? '';
    assert.ok(scriptSource.includes('./image-stitch.esm.js'), 'Streaming page should load the local ESM bundle');
    assert.ok(
      scriptSource.includes('StreamingConcatenator'),
      'Streaming page should reference the StreamingConcatenator API'
    );
    assert.ok(
      scriptSource.includes('showSaveFilePicker'),
      'Streaming page should mention File System Access streaming'
    );

    await window.close();
  });


  test('examples page provides code samples for each demo', async () => {
    const { window, document } = await loadDocument(examplesPath);

    const codeBlocks = Array.from(document.querySelectorAll('section.example .code-block[data-code]'));
    assert.strictEqual(codeBlocks.length, 4, 'Each example should provide a runnable snippet');

    await window.close();
  });

  test('bundle size is reasonable', () => {
    const stats = fs.statSync(iifeBundlePath);
    const sizeKB = stats.size / 1024;

    // Bundle should be less than 100KB (currently ~27KB)
    assert.ok(sizeKB < 100, `Bundle size (${sizeKB.toFixed(2)}KB) should be less than 100KB`);

    // Bundle should be more than 10KB (sanity check)
    assert.ok(sizeKB > 10, `Bundle size (${sizeKB.toFixed(2)}KB) seems too small`);
  });

});

describe('Functional Tests - Verify Examples Work Correctly', () => {
  const pngsuiteDir = path.resolve(__dirname, '..', '..', 'pngsuite', 'png');
  const fixturesDir = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'expected-outputs');

  // Helper to load the bundle and get its exports exactly as the browser does
  async function loadBundleModule() {
    const moduleUrl = pathToFileURL(esmBundlePath);
    return await import(moduleUrl.href);
  }

  // Helper to load an image
  function loadImage(filename: string): Uint8Array {
    return fs.readFileSync(path.join(pngsuiteDir, filename));
  }

  // Helper to compare two PNG files by pixels (visual equality)
  async function comparePngs(actual: Uint8Array, expected: Uint8Array): Promise<boolean> {
    // First try fast path with pngjs (decodes to RGBA)
    try {
      const actualPng = PNG.sync.read(Buffer.from(actual));
      const expectedPng = PNG.sync.read(Buffer.from(expected));

      if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height) {
        return false;
      }

      // @ts-ignore
      if (actualPng.colorType !== undefined && expectedPng.colorType !== undefined) {
        if (actualPng.colorType !== expectedPng.colorType) return false;
      }
      // @ts-ignore
      if (actualPng.depth !== undefined && expectedPng.depth !== undefined) {
        if (actualPng.depth !== expectedPng.depth) return false;
      }

      const aData = actualPng.data;
      const bData = expectedPng.data;
      if (aData.length !== bData.length) return false;

      for (let i = 0; i < aData.length; i++) {
        if (aData[i] !== bData[i]) return false;
      }

      return true;
    } catch (err) {
      // Fall back to built-in parser + decompressor (more tolerant)
      const parser = await import(path.resolve(__dirname, '..', '..', 'dist', 'esm', 'png-parser.js'));
      const decompressor = await import(path.resolve(__dirname, '..', '..', 'dist', 'esm', 'png-decompress.js'));

      const parsePngChunks = parser.parsePngChunks;
      const parsePngHeader = parser.parsePngHeader;
      const extractPixelData = decompressor.extractPixelData;

      const actualChunks = parsePngChunks(actual);
      const expectedChunks = parsePngChunks(expected);

      const actualHeader = parsePngHeader(actual);
      const expectedHeader = parsePngHeader(expected);

      if (actualHeader.width !== expectedHeader.width || actualHeader.height !== expectedHeader.height) {
        return false;
      }

      const actualPixels = await extractPixelData(actualChunks, actualHeader);
      const expectedPixels = await extractPixelData(expectedChunks, expectedHeader);

      if (actualPixels.length !== expectedPixels.length) return false;

      for (let i = 0; i < actualPixels.length; i++) {
        if (actualPixels[i] !== expectedPixels[i]) return false;
      }

      return true;
    }
  }

  test('Example 1: Horizontal concatenation produces correct output', async () => {
    // Import from the actual bundle exactly as the documentation site does
    const bundle = await loadBundleModule();

    assert.ok(typeof bundle.concat === 'function', 'Browser bundle should export concat');

    const result = await bundle.concat({
      inputs: [
        loadImage('basn2c08.png'),
        loadImage('basn0g08.png'),
        loadImage('basn6a08.png')
      ],
      layout: { columns: 3 }
    });

  const expected = fs.readFileSync(path.join(fixturesDir, 'example1.png'));
  assert.ok(await comparePngs(result, expected), 'Example 1 output should match expected image');
  });

  test('Example 2: Vertical concatenation produces correct output', async () => {
    const bundle = await loadBundleModule();

    const result = await bundle.concat({
      inputs: [
        loadImage('basn2c08.png'),
        loadImage('basn0g08.png'),
        loadImage('basn6a08.png')
      ],
      layout: { rows: 3 }
    });

  const expected = fs.readFileSync(path.join(fixturesDir, 'example2.png'));
  assert.ok(await comparePngs(result, expected), 'Example 2 output should match expected image');
  });

  test('Example 3: Grid layout produces correct output', async () => {
    const bundle = await loadBundleModule();

    const result = await bundle.concat({
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

  const expected = fs.readFileSync(path.join(fixturesDir, 'example3.png'));
  assert.ok(await comparePngs(result, expected), 'Example 3 output should match expected image');
  });

  test('Example 4: Different image sizes produces correct output', async () => {
    const bundle = await loadBundleModule();

    const result = await bundle.concat({
      inputs: [
        loadImage('basn0g01.png'),
        loadImage('basn0g04.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 3 }
    });

  const expected = fs.readFileSync(path.join(fixturesDir, 'example4.png'));
  assert.ok(await comparePngs(result, expected), 'Example 4 output should match expected image');
  });

  test('Example 5: Width limit with wrapping produces correct output', async () => {
    const bundle = await loadBundleModule();

    const result = await bundle.concat({
      inputs: [
        loadImage('basn2c08.png'),
        loadImage('basn0g08.png'),
        loadImage('basn6a08.png'),
        loadImage('basn4a08.png')
      ],
      layout: { width: 100 }
    });

  const expected = fs.readFileSync(path.join(fixturesDir, 'example5.png'));
  assert.ok(await comparePngs(result, expected), 'Example 5 output should match expected image');
  });

  test('Library handles mixed color types correctly', async () => {
    const bundle = await loadBundleModule();

    // Mix RGB, Grayscale, and RGBA images
    const result = await bundle.concat({
      inputs: [
        loadImage('basn2c08.png'),  // RGB 8-bit
        loadImage('basn0g08.png'),  // Grayscale 8-bit
        loadImage('basn6a08.png'),  // RGBA 8-bit
        loadImage('basn4a08.png')   // Grayscale+Alpha 8-bit
      ],
      layout: { columns: 2 }
    });

    // Just verify it produces a valid PNG (signature check)
    assert.ok(result.length > 8, 'Output should have content');
    assert.strictEqual(result[0], 0x89, 'PNG signature byte 1');
    assert.strictEqual(result[1], 0x50, 'PNG signature byte 2');
    assert.strictEqual(result[2], 0x4E, 'PNG signature byte 3');
    assert.strictEqual(result[3], 0x47, 'PNG signature byte 4');
  });

  test('Library handles mixed bit depths correctly', async () => {
    const bundle = await loadBundleModule();

    // Mix 8-bit and 16-bit images
    const result = await bundle.concat({
      inputs: [
        loadImage('basn2c08.png'),  // RGB 8-bit
        loadImage('basn2c16.png')   // RGB 16-bit
      ],
      layout: { columns: 2 }
    });

    // Verify it produces a valid PNG
    assert.ok(result.length > 8, 'Output should have content');
    assert.strictEqual(result[0], 0x89, 'PNG signature byte 1');
    assert.strictEqual(result[1], 0x50, 'PNG signature byte 2');
  });

  test('Library handles sub-byte bit depths correctly', async () => {
    const bundle = await loadBundleModule();

    // Mix different grayscale bit depths
    const result = await bundle.concat({
      inputs: [
        loadImage('basn0g01.png'),  // 1-bit grayscale
        loadImage('basn0g04.png'),  // 4-bit grayscale
        loadImage('basn0g08.png')   // 8-bit grayscale
      ],
      layout: { columns: 3 }
    });

    // Verify it produces a valid PNG
    assert.ok(result.length > 8, 'Output should have content');
    assert.strictEqual(result[0], 0x89, 'PNG signature byte 1');
  });

  test('Library handles interlaced PNG images correctly', async () => {
    const bundle = await loadBundleModule();

    // Load interlaced images (basi prefix)
    const result = await bundle.concat({
      inputs: [
        loadImage('basi0g08.png'),  // Interlaced grayscale 8-bit
        loadImage('basi2c08.png'),  // Interlaced RGB 8-bit
        loadImage('basi4a16.png')   // Interlaced grayscale+alpha 16-bit
      ],
      layout: { columns: 3 }
    });

    // Verify it produces a valid PNG
    assert.ok(result.length > 8, 'Output should have content');
    assert.strictEqual(result[0], 0x89, 'PNG signature byte 1');
    assert.strictEqual(result[1], 0x50, 'PNG signature byte 2');
    assert.strictEqual(result[2], 0x4E, 'PNG signature byte 3');
    assert.strictEqual(result[3], 0x47, 'PNG signature byte 4');
  });

  test('Library handles mixed interlaced and non-interlaced images', async () => {
    const bundle = await loadBundleModule();

    // Mix interlaced and non-interlaced
    const result = await bundle.concat({
      inputs: [
        loadImage('basn2c08.png'),  // Non-interlaced
        loadImage('basi2c08.png'),  // Interlaced
        loadImage('basn6a08.png')   // Non-interlaced
      ],
      layout: { columns: 3 }
    });

    // Verify it produces a valid PNG
    assert.ok(result.length > 8, 'Output should have content');
    assert.strictEqual(result[0], 0x89, 'PNG signature byte 1');
  });
});
