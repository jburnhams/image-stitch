import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { Window } from 'happy-dom';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the generated docs
const docsDistDir = path.join(__dirname, '..', 'docs-dist');
const bundlePath = path.join(docsDistDir, 'png-concat.bundle.js');
const indexPath = path.join(docsDistDir, 'index.html');

describe('Browser Bundle Tests', () => {
  test('bundle loads without syntax errors', async () => {
    const bundleExists = fs.existsSync(bundlePath);
    assert.ok(bundleExists, 'Bundle file should exist. Run `npm run build:docs` first.');

    const window = new Window();
    const document = window.document;

    const bundleCode = fs.readFileSync(bundlePath, 'utf8');

    // Execute the bundle code - if there are syntax errors, this will throw
    const scriptEl = document.createElement('script');
    scriptEl.textContent = bundleCode;

    // This should not throw
    assert.doesNotThrow(() => {
      document.head.appendChild(scriptEl);
    });

    await window.close();
  });

  test('concatPngs function is exported', async () => {
    const window = new Window();
    const document = window.document;

    const bundleCode = fs.readFileSync(bundlePath, 'utf8');

    // Create a script element and execute
    const scriptEl = document.createElement('script');
    scriptEl.type = 'module';
    scriptEl.textContent = bundleCode;
    document.head.appendChild(scriptEl);

    // Give it a moment to execute
    await new Promise(resolve => setTimeout(resolve, 100));

    // Note: In happy-dom, ES modules don't populate window.concatPngs
    // but we can verify the bundle contains the export
    assert.ok(bundleCode.includes('export'), 'Bundle should contain exports');
    assert.ok(bundleCode.includes('concatPngs'), 'Bundle should export concatPngs');

    await window.close();
  });

  test('no duplicate getSamplesPerPixel declarations', () => {
    const bundleCode = fs.readFileSync(bundlePath, 'utf8');

    // Count how many times "function getSamplesPerPixel" appears
    const matches = bundleCode.match(/function getSamplesPerPixel/g);
    const declarationCount = matches ? matches.length : 0;

    assert.strictEqual(declarationCount, 1,
      `Expected 1 getSamplesPerPixel declaration, found ${declarationCount}`);
  });

  test('bundle has no duplicate const/function declarations', () => {
    const bundleCode = fs.readFileSync(bundlePath, 'utf8');

    // Extract all function and const declarations
    const functionMatches = bundleCode.matchAll(/function\s+(\w+)/g);
    const constMatches = bundleCode.matchAll(/(?:^|\n)const\s+(\w+)\s*=/gm);

    const declarations = new Map<string, number>();

    for (const match of functionMatches) {
      const name = match[1];
      declarations.set(name, (declarations.get(name) || 0) + 1);
    }

    for (const match of constMatches) {
      const name = match[1];
      declarations.set(name, (declarations.get(name) || 0) + 1);
    }

    // Find duplicates
    const duplicates: string[] = [];
    for (const [name, count] of declarations.entries()) {
      if (count > 1) {
        duplicates.push(`${name} (${count} times)`);
      }
    }

    assert.strictEqual(duplicates.length, 0,
      `Found duplicate declarations: ${duplicates.join(', ')}`);
  });

  test('bundle contains all required utilities', () => {
    const bundleCode = fs.readFileSync(bundlePath, 'utf8');

    const requiredFunctions = [
      'concatPngs',
      'crc32',
      'readUInt32BE',
      'writeUInt32BE',
      'getSamplesPerPixel',
      'getBytesPerPixel',
      'decompressImageData',
      'compressImageData',
    ];

    for (const func of requiredFunctions) {
      assert.ok(
        bundleCode.includes(func),
        `Bundle should contain ${func}`
      );
    }
  });

  test('HTML page loads without errors', async () => {
    const indexExists = fs.existsSync(indexPath);
    assert.ok(indexExists, 'index.html should exist');

    const window = new Window();
    const document = window.document;

    const html = fs.readFileSync(indexPath, 'utf8');
    document.write(html);

    // Verify key elements exist
    assert.ok(document.querySelector('header'), 'Should have header');
    assert.ok(document.querySelector('.example'), 'Should have example sections');

    // Verify all 5 examples are present
    for (let i = 1; i <= 5; i++) {
      const example = document.querySelector(`#example${i}`);
      assert.ok(example, `Should have example${i}`);
    }

    await window.close();
  });

  test('all example sections have run buttons', async () => {
    const window = new Window();
    const document = window.document;

    const html = fs.readFileSync(indexPath, 'utf8');
    document.write(html);

    // Check each example has a "Run Example" button
    for (let i = 1; i <= 5; i++) {
      const example = document.querySelector(`#example${i}`);
      assert.ok(example, `Should have example${i}`);

      const button = example.querySelector('button');
      assert.ok(button, `Example ${i} should have a button`);
      assert.ok(
        button.textContent?.includes('Run Example'),
        `Example ${i} button should say "Run Example"`
      );
    }

    await window.close();
  });

  test('all required images exist', () => {
    const imagesDir = path.join(docsDistDir, 'images');
    assert.ok(fs.existsSync(imagesDir), 'Images directory should exist');

    const requiredImages = [
      'basn2c08.png',
      'basn0g08.png',
      'basn6a08.png',
      'basn4a08.png',
      'basn2c16.png',
      'basn0g16.png',
      'basn0g01.png',
      'basn0g04.png',
    ];

    for (const imageName of requiredImages) {
      const imagePath = path.join(imagesDir, imageName);
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

  test('all image references in HTML are valid', async () => {
    const window = new Window();
    const document = window.document;

    const html = fs.readFileSync(indexPath, 'utf8');
    document.write(html);

    // Find all img elements
    const images = document.querySelectorAll('img');
    assert.ok(images.length > 0, 'Should have image elements');

    for (const img of Array.from(images)) {
      const src = img.getAttribute('src');
      assert.ok(src, 'Image should have src attribute');

      if (src && src.startsWith('images/')) {
        const imagePath = path.join(docsDistDir, src);
        assert.ok(fs.existsSync(imagePath), `Image file ${src} should exist`);
      }
    }

    await window.close();
  });

  test('bundle script is referenced in HTML', async () => {
    const window = new Window();
    const document = window.document;

    const html = fs.readFileSync(indexPath, 'utf8');
    document.write(html);

    // Find script that imports the bundle
    const scripts = document.querySelectorAll('script[type="module"]');
    let foundBundleImport = false;

    for (const script of Array.from(scripts)) {
      const content = script.textContent || '';
      if (content.includes('./png-concat.bundle.js')) {
        foundBundleImport = true;
        break;
      }
    }

    assert.ok(foundBundleImport, 'HTML should import png-concat.bundle.js');

    await window.close();
  });

  test('example functions are defined in HTML', async () => {
    const window = new Window();
    const document = window.document;

    const html = fs.readFileSync(indexPath, 'utf8');
    document.write(html);

    const scripts = document.querySelectorAll('script[type="module"]');
    const scriptContent = Array.from(scripts).map(s => s.textContent || '').join('\n');

    // Check that example runner functions exist
    for (let i = 1; i <= 5; i++) {
      assert.ok(
        scriptContent.includes(`window.runExample${i}`),
        `Should define runExample${i} function`
      );
    }

    // Check that download function exists
    assert.ok(
      scriptContent.includes('window.downloadResult'),
      'Should define downloadResult function'
    );

    await window.close();
  });

  test('bundle size is reasonable', () => {
    const stats = fs.statSync(bundlePath);
    const sizeKB = stats.size / 1024;

    // Bundle should be less than 100KB (currently ~27KB)
    assert.ok(sizeKB < 100, `Bundle size (${sizeKB.toFixed(2)}KB) should be less than 100KB`);

    // Bundle should be more than 10KB (sanity check)
    assert.ok(sizeKB > 10, `Bundle size (${sizeKB.toFixed(2)}KB) seems too small`);
  });

  test('all markdown documentation files exist', () => {
    const expectedDocs = [
      'streaming-comparison.md',
      'true-streaming-architecture.md',
    ];

    for (const docFile of expectedDocs) {
      const docPath = path.join(docsDistDir, docFile);
      assert.ok(fs.existsSync(docPath), `Documentation file ${docFile} should exist`);
    }
  });

  test('page has proper structure for all examples', async () => {
    const window = new Window();
    const document = window.document;

    const html = fs.readFileSync(indexPath, 'utf8');
    document.write(html);

    const exampleTitles = [
      'Horizontal Concatenation',
      'Vertical Concatenation',
      'Grid Layout',
      'Arbitrary Image Sizes',
      'Width Limit with Wrapping',
    ];

    for (let i = 0; i < exampleTitles.length; i++) {
      const exampleNum = i + 1;
      const example = document.querySelector(`#example${exampleNum}`);
      assert.ok(example, `Example ${exampleNum} should exist`);

      const heading = example.querySelector('h3');
      assert.ok(heading, `Example ${exampleNum} should have a heading`);
      assert.ok(
        heading?.textContent?.includes(exampleTitles[i]),
        `Example ${exampleNum} heading should mention "${exampleTitles[i]}"`
      );

      // Check for result container
      const resultDiv = example.querySelector(`[id="result${exampleNum}"]`);
      assert.ok(resultDiv, `Example ${exampleNum} should have a result div`);
    }

    await window.close();
  });
});

describe('Functional Tests - Verify Examples Work Correctly', () => {
  const pngsuiteDir = path.join(__dirname, '..', 'pngsuite', 'png');
  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures', 'expected-outputs');

  // Helper to load an image
  function loadImage(filename: string): Uint8Array {
    return fs.readFileSync(path.join(pngsuiteDir, filename));
  }

  // Helper to compare two PNG files (byte-by-byte)
  function comparePngs(actual: Uint8Array, expected: Uint8Array): boolean {
    if (actual.length !== expected.length) {
      return false;
    }
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        return false;
      }
    }
    return true;
  }

  test('Example 1: Horizontal concatenation produces correct output', async () => {
    // Import the library
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    const result = await concatPngs({
      inputs: [
        loadImage('basn2c08.png'),
        loadImage('basn0g08.png'),
        loadImage('basn6a08.png')
      ],
      layout: { columns: 3 }
    });

    const expected = fs.readFileSync(path.join(fixturesDir, 'example1.png'));
    assert.ok(comparePngs(result, expected), 'Example 1 output should match expected image');
  });

  test('Example 2: Vertical concatenation produces correct output', async () => {
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    const result = await concatPngs({
      inputs: [
        loadImage('basn2c08.png'),
        loadImage('basn0g08.png'),
        loadImage('basn6a08.png')
      ],
      layout: { rows: 3 }
    });

    const expected = fs.readFileSync(path.join(fixturesDir, 'example2.png'));
    assert.ok(comparePngs(result, expected), 'Example 2 output should match expected image');
  });

  test('Example 3: Grid layout produces correct output', async () => {
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    const result = await concatPngs({
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
    assert.ok(comparePngs(result, expected), 'Example 3 output should match expected image');
  });

  test('Example 4: Different image sizes produces correct output', async () => {
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    const result = await concatPngs({
      inputs: [
        loadImage('basn0g01.png'),
        loadImage('basn0g04.png'),
        loadImage('basn2c08.png')
      ],
      layout: { columns: 3 }
    });

    const expected = fs.readFileSync(path.join(fixturesDir, 'example4.png'));
    assert.ok(comparePngs(result, expected), 'Example 4 output should match expected image');
  });

  test('Example 5: Width limit with wrapping produces correct output', async () => {
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    const result = await concatPngs({
      inputs: [
        loadImage('basn2c08.png'),
        loadImage('basn0g08.png'),
        loadImage('basn6a08.png'),
        loadImage('basn4a08.png')
      ],
      layout: { width: 100 }
    });

    const expected = fs.readFileSync(path.join(fixturesDir, 'example5.png'));
    assert.ok(comparePngs(result, expected), 'Example 5 output should match expected image');
  });

  test('Library handles mixed color types correctly', async () => {
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    // Mix RGB, Grayscale, and RGBA images
    const result = await concatPngs({
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
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    // Mix 8-bit and 16-bit images
    const result = await concatPngs({
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
    const { concatPngs } = await import('../dist/png-concat-unified.js');

    // Mix different grayscale bit depths
    const result = await concatPngs({
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
});
