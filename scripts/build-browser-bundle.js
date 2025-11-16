#!/usr/bin/env node

/**
 * Build the documentation site assets.
 *
 * Copies the static docs, sample images, and freshly built browser bundles
 * into docs-dist/ for local previews and browser integration tests.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const browserDistDir = path.join(distDir, 'browser');
const docsSourceDir = path.join(projectRoot, 'docs');
const docsDistDir = path.join(projectRoot, 'docs-dist');
const pngsuiteDir = path.join(projectRoot, 'pngsuite', 'png');
const jpegWasmPath = path.join(projectRoot, 'node_modules', 'jpeg-encoder', 'pkg', 'jpeg_encoder_bg.wasm');

function assertExists(targetPath, message) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(message);
  }
}

assertExists(distDir, 'Run `npm run build` before packaging docs.');
assertExists(browserDistDir, 'Browser bundles not found. Did `npm run build` succeed?');

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDocs() {
  console.log('Copying docs source files...');
  fs.rmSync(docsDistDir, { recursive: true, force: true });
  copyRecursive(docsSourceDir, docsDistDir);
}

function copyImages() {
  console.log('Copying sample PNG assets...');
  const imagesDistDir = path.join(docsDistDir, 'images');
  fs.mkdirSync(imagesDistDir, { recursive: true });

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
    'g05n2c08.png'
  ];

  for (const imageName of requiredImages) {
    const srcPath = path.join(pngsuiteDir, imageName);
    const destPath = path.join(imagesDistDir, imageName);
    fs.copyFileSync(srcPath, destPath);
  }

  console.log(`Copied ${requiredImages.length} images.`);
}

function copyBrowserBundles() {
  console.log('Copying browser bundles...');
  const outputs = [
    'image-stitch.js',
    'image-stitch.js.map',
    'image-stitch.min.js',
    'image-stitch.min.js.map'
  ];

  for (const file of outputs) {
    const srcPath = path.join(browserDistDir, file);
    assertExists(srcPath, `Missing browser artifact: ${file}`);
    const destPath = path.join(docsDistDir, file);
    fs.copyFileSync(srcPath, destPath);
  }
}

function copyEsmBundle() {
  console.log('Copying ESM bundle for documentation...');
  const esmBundle = path.join(distDir, 'bundles', 'image-stitch.esm.js');
  if (!fs.existsSync(esmBundle)) {
    console.warn('ESM bundle not found; skipping.');
    return;
  }

  const dest = path.join(docsDistDir, 'image-stitch.esm.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(esmBundle, dest);

  const mapSrc = `${esmBundle}.map`;
  if (fs.existsSync(mapSrc)) {
    fs.copyFileSync(mapSrc, `${dest}.map`);
  }
}

function copyJpegWasm() {
  if (!fs.existsSync(jpegWasmPath)) {
    console.warn('JPEG encoder WASM not found; skipping copy.');
    return;
  }

  const dest = path.join(docsDistDir, 'jpeg_encoder_bg.wasm');
  fs.copyFileSync(jpegWasmPath, dest);
}

copyDocs();
copyImages();
copyBrowserBundles();
copyEsmBundle();
copyJpegWasm();

console.log('Documentation assets ready in docs-dist/.');
