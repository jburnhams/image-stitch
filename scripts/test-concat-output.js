#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { concatPngs } from '../dist/png-concat.js';
import { parsePngHeader } from '../dist/png-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pngsuiteDir = path.join(__dirname, '..', 'pngsuite', 'png');

async function test() {
  const png1 = fs.readFileSync(path.join(pngsuiteDir, 'basn0g08.png'));
  const png2 = fs.readFileSync(path.join(pngsuiteDir, 'basn0g08.png'));

  const header1 = parsePngHeader(png1);
  console.log('Input PNG1 header:', {
    width: header1.width,
    height: header1.height,
    colorType: header1.colorType,
    bitDepth: header1.bitDepth
  });

  const result = await concatPngs({
    inputs: [png1, png2],
    layout: { columns: 2 }
  });

  const resultHeader = parsePngHeader(result);
  console.log('Output PNG header:', {
    width: resultHeader.width,
    height: resultHeader.height,
    colorType: resultHeader.colorType,
    bitDepth: resultHeader.bitDepth
  });

  console.log('Color type 0 = Grayscale, 2 = RGB, 4 = Grayscale+Alpha, 6 = RGBA');
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
