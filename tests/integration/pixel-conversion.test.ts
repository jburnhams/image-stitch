import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import '../../src/decoders/index.js';
import { convertPixelFormat, determineCommonFormat } from '../../src/pixel-ops.js';
import { PngHeader, ColorType } from '../../src/types.js';
import { parsePngHeader, parsePngChunks } from '../../src/png-parser.js';
import { extractPixelData } from '../../src/png-decompress.js';
import { concatToBuffer } from '../../src/image-concat.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PNGSUITE_DIR = join(process.cwd(), 'pngsuite', 'png');

function canLoadPngSuite(filename: string): boolean {
  return existsSync(join(PNGSUITE_DIR, filename));
}

function loadPngSuite(filename: string): Uint8Array {
  return readFileSync(join(PNGSUITE_DIR, filename));
}

/**
 * Extract a pixel value at a specific coordinate from raw pixel data
 */
function getPixelAt(
  pixelData: Uint8Array,
  header: PngHeader,
  x: number,
  y: number
): number[] {
  const width = header.width;
  const colorType = header.colorType;
  const bitDepth = header.bitDepth;

  // Calculate samples per pixel
  let samplesPerPixel = 1;
  if (colorType === ColorType.RGB) samplesPerPixel = 3;
  else if (colorType === ColorType.RGBA) samplesPerPixel = 4;
  else if (colorType === ColorType.GRAYSCALE_ALPHA) samplesPerPixel = 2;

  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bytesPerPixel = samplesPerPixel * bytesPerSample;
  const rowBytes = width * bytesPerPixel;

  const offset = y * rowBytes + x * bytesPerPixel;
  const pixel: number[] = [];

  for (let i = 0; i < samplesPerPixel; i++) {
    if (bitDepth === 16) {
      const value = (pixelData[offset + i * 2] << 8) | pixelData[offset + i * 2 + 1];
      pixel.push(value);
    } else {
      pixel.push(pixelData[offset + i]);
    }
  }

  return pixel;
}

// ===== UNIT TESTS: Test convertPixelFormat with manually crafted data =====

describe('Unit Tests: convertPixelFormat with synthetic data', () => {
  test('Convert Grayscale 8-bit to RGBA 8-bit', () => {
    // Create 2x2 grayscale image with known values
    const header: PngHeader = {
      width: 2,
      height: 2,
      bitDepth: 8,
      colorType: ColorType.GRAYSCALE,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Gray values: [255, 128, 64, 0]
    const pixelData = new Uint8Array([255, 128, 64, 0]);

    const result = convertPixelFormat(pixelData, header, 8, ColorType.RGBA);

    // Expected RGBA: each gray value becomes (gray, gray, gray, 255)
    const expected = new Uint8Array([
      255, 255, 255, 255,  // pixel (0,0)
      128, 128, 128, 255,  // pixel (1,0)
      64, 64, 64, 255,     // pixel (0,1)
      0, 0, 0, 255         // pixel (1,1)
    ]);

    assert.deepStrictEqual(result.data, expected);
    assert.strictEqual(result.header.colorType, ColorType.RGBA);
    assert.strictEqual(result.header.bitDepth, 8);
  });

  test('Convert RGB 8-bit to RGBA 8-bit', () => {
    const header: PngHeader = {
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: ColorType.RGB,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Two pixels: red (255,0,0) and green (0,255,0)
    const pixelData = new Uint8Array([
      255, 0, 0,    // pixel 0
      0, 255, 0     // pixel 1
    ]);

    const result = convertPixelFormat(pixelData, header, 8, ColorType.RGBA);

    const expected = new Uint8Array([
      255, 0, 0, 255,    // red with full alpha
      0, 255, 0, 255     // green with full alpha
    ]);

    assert.deepStrictEqual(result.data, expected);
  });

  test('Convert Grayscale+Alpha 8-bit to RGBA 8-bit', () => {
    const header: PngHeader = {
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: ColorType.GRAYSCALE_ALPHA,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Two pixels: (gray=255, alpha=128) and (gray=64, alpha=255)
    const pixelData = new Uint8Array([
      255, 128,   // pixel 0
      64, 255     // pixel 1
    ]);

    const result = convertPixelFormat(pixelData, header, 8, ColorType.RGBA);

    const expected = new Uint8Array([
      255, 255, 255, 128,  // white with half alpha
      64, 64, 64, 255      // dark gray with full alpha
    ]);

    assert.deepStrictEqual(result.data, expected);
  });

  test('Convert RGBA 8-bit to RGBA 8-bit (identity)', () => {
    const header: PngHeader = {
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: ColorType.RGBA,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    const pixelData = new Uint8Array([255, 128, 64, 32]);

    const result = convertPixelFormat(pixelData, header, 8, ColorType.RGBA);

    // Should return unchanged
    assert.deepStrictEqual(result.data, pixelData);
  });

  test('Convert RGB 8-bit to RGBA 16-bit with bit depth scaling', () => {
    const header: PngHeader = {
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: ColorType.RGB,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    const pixelData = new Uint8Array([255, 128, 0]);

    const result = convertPixelFormat(pixelData, header, 16, ColorType.RGBA);

    // 8-bit 255 -> 16-bit 65535 (0xFFFF)
    // 8-bit 128 -> 16-bit 32896 (0x8080)
    // 8-bit 0 -> 16-bit 0
    // Alpha should be 65535 (fully opaque)
    assert.strictEqual(result.data[0], 0xFF);  // R high byte
    assert.strictEqual(result.data[1], 0xFF);  // R low byte
    assert.strictEqual(result.data[2], 0x80);  // G high byte
    assert.strictEqual(result.data[3], 0x80);  // G low byte
    assert.strictEqual(result.data[4], 0x00);  // B high byte
    assert.strictEqual(result.data[5], 0x00);  // B low byte
    assert.strictEqual(result.data[6], 0xFF);  // A high byte
    assert.strictEqual(result.data[7], 0xFF);  // A low byte
  });

  test('Convert RGB 16-bit to RGBA 16-bit', () => {
    const header: PngHeader = {
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: ColorType.RGB,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // One pixel: R=65535, G=32768, B=0 (16-bit values, big-endian)
    const pixelData = new Uint8Array([
      0xFF, 0xFF,  // R
      0x80, 0x00,  // G
      0x00, 0x00   // B
    ]);

    const result = convertPixelFormat(pixelData, header, 16, ColorType.RGBA);

    const expected = new Uint8Array([
      0xFF, 0xFF,  // R
      0x80, 0x00,  // G
      0x00, 0x00,  // B
      0xFF, 0xFF   // A (fully opaque)
    ]);

    assert.deepStrictEqual(result.data, expected);
  });

  test('Convert Grayscale 1-bit to RGBA 8-bit', () => {
    const header: PngHeader = {
      width: 8,
      height: 1,
      bitDepth: 1,
      colorType: ColorType.GRAYSCALE,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // 8 pixels, 1 bit each = 1 byte: 0b10101010 = 0xAA
    const pixelData = new Uint8Array([0xAA]);

    const result = convertPixelFormat(pixelData, header, 8, ColorType.RGBA);

    // Bit pattern: 1,0,1,0,1,0,1,0
    // 1-bit value 1 scales to 8-bit 255
    // 1-bit value 0 scales to 8-bit 0
    for (let i = 0; i < 8; i++) {
      const expectedGray = (i % 2 === 0) ? 255 : 0;
      assert.strictEqual(result.data[i * 4 + 0], expectedGray, `Pixel ${i} R`);
      assert.strictEqual(result.data[i * 4 + 1], expectedGray, `Pixel ${i} G`);
      assert.strictEqual(result.data[i * 4 + 2], expectedGray, `Pixel ${i} B`);
      assert.strictEqual(result.data[i * 4 + 3], 255, `Pixel ${i} A`);
    }
  });

  test('Convert Grayscale 4-bit to RGBA 8-bit', () => {
    const header: PngHeader = {
      width: 2,
      height: 1,
      bitDepth: 4,
      colorType: ColorType.GRAYSCALE,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Two 4-bit pixels: 15 (0xF) and 0 (0x0) packed as 0xF0
    const pixelData = new Uint8Array([0xF0]);

    const result = convertPixelFormat(pixelData, header, 8, ColorType.RGBA);

    // 4-bit 15 scales to 8-bit 255
    // 4-bit 0 scales to 8-bit 0
    assert.strictEqual(result.data[0], 255);  // pixel 0 R
    assert.strictEqual(result.data[1], 255);  // pixel 0 G
    assert.strictEqual(result.data[2], 255);  // pixel 0 B
    assert.strictEqual(result.data[3], 255);  // pixel 0 A

    assert.strictEqual(result.data[4], 0);    // pixel 1 R
    assert.strictEqual(result.data[5], 0);    // pixel 1 G
    assert.strictEqual(result.data[6], 0);    // pixel 1 B
    assert.strictEqual(result.data[7], 255);  // pixel 1 A
  });
});

// ===== PNGSUITE TESTS: Use real images and verify pixel values =====

describe('PngSuite Tests: Verify pixel values at expected coordinates', () => {
  test('Concatenate two Grayscale 8-bit images - verify pixels', async () => {
    if (!canLoadPngSuite('basn0g08.png')) return;

    const png1 = loadPngSuite('basn0g08.png');
    const png2 = loadPngSuite('basn0g08.png');

    // Read pixel from top-left of first image
    const header1 = parsePngHeader(png1);
    const chunks1 = parsePngChunks(png1);
    const pixels1 = await extractPixelData(chunks1, header1);
    const pixel1 = getPixelAt(pixels1, header1, 0, 0);

    // Read pixel from top-left of second image
    const header2 = parsePngHeader(png2);
    const chunks2 = parsePngChunks(png2);
    const pixels2 = await extractPixelData(chunks2, header2);
    const pixel2 = getPixelAt(pixels2, header2, 0, 0);

    // Concatenate horizontally
    const result = await concatToBuffer({
      inputs: [png1, png2],
      layout: { columns: 2 }
    });

    // Extract pixels from result
    const resultHeader = parsePngHeader(result);
    const resultChunks = parsePngChunks(result);
    const resultPixels = await extractPixelData(resultChunks, resultHeader);

    // Pixel from first image should be at (0, 0) in output
    const outputPixel1 = getPixelAt(resultPixels, resultHeader, 0, 0);

    // Pixel from second image should be at (width1, 0) in output
    const outputPixel2 = getPixelAt(resultPixels, resultHeader, header1.width, 0);

    // Verify pixels match (converted to RGBA, so grayscale becomes R=G=B=gray, A=255)
    assert.strictEqual(outputPixel1[0], pixel1[0], 'First image R channel');
    assert.strictEqual(outputPixel1[1], pixel1[0], 'First image G channel');
    assert.strictEqual(outputPixel1[2], pixel1[0], 'First image B channel');
    assert.strictEqual(outputPixel1[3], 255, 'First image Alpha channel');

    assert.strictEqual(outputPixel2[0], pixel2[0], 'Second image R channel');
    assert.strictEqual(outputPixel2[1], pixel2[0], 'Second image G channel');
    assert.strictEqual(outputPixel2[2], pixel2[0], 'Second image B channel');
    assert.strictEqual(outputPixel2[3], 255, 'Second image Alpha channel');
  });

  test('Concatenate RGB and Grayscale - verify pixels at different locations', async () => {
    if (!canLoadPngSuite('basn2c08.png') || !canLoadPngSuite('basn0g08.png')) return;

    const pngRGB = loadPngSuite('basn2c08.png');
    const pngGray = loadPngSuite('basn0g08.png');

    // Read corner pixels from source images
    const headerRGB = parsePngHeader(pngRGB);
    const pixelsRGB = await extractPixelData(parsePngChunks(pngRGB), headerRGB);
    const rgbTopLeft = getPixelAt(pixelsRGB, headerRGB, 0, 0);
    const rgbBottomRight = getPixelAt(pixelsRGB, headerRGB, headerRGB.width - 1, headerRGB.height - 1);

    const headerGray = parsePngHeader(pngGray);
    const pixelsGray = await extractPixelData(parsePngChunks(pngGray), headerGray);
    const grayTopLeft = getPixelAt(pixelsGray, headerGray, 0, 0);
    const grayBottomRight = getPixelAt(pixelsGray, headerGray, headerGray.width - 1, headerGray.height - 1);

    // Concatenate horizontally: [RGB | Gray]
    const result = await concatToBuffer({
      inputs: [pngRGB, pngGray],
      layout: { columns: 2 }
    });

    const resultHeader = parsePngHeader(result);
    const resultPixels = await extractPixelData(parsePngChunks(result), resultHeader);

    // Verify RGB image pixels at (0, 0) and (width-1, height-1)
    const outRgbTopLeft = getPixelAt(resultPixels, resultHeader, 0, 0);
    assert.deepStrictEqual(
      [outRgbTopLeft[0], outRgbTopLeft[1], outRgbTopLeft[2]],
      rgbTopLeft,
      'RGB top-left pixel RGB channels'
    );

    const outRgbBottomRight = getPixelAt(resultPixels, resultHeader, headerRGB.width - 1, headerRGB.height - 1);
    assert.deepStrictEqual(
      [outRgbBottomRight[0], outRgbBottomRight[1], outRgbBottomRight[2]],
      rgbBottomRight,
      'RGB bottom-right pixel RGB channels'
    );

    // Verify Gray image pixels at (width1, 0) and (width1 + width2 - 1, height2 - 1)
    const outGrayTopLeft = getPixelAt(resultPixels, resultHeader, headerRGB.width, 0);
    assert.strictEqual(outGrayTopLeft[0], grayTopLeft[0], 'Gray top-left R');
    assert.strictEqual(outGrayTopLeft[1], grayTopLeft[0], 'Gray top-left G');
    assert.strictEqual(outGrayTopLeft[2], grayTopLeft[0], 'Gray top-left B');

    const outGrayBottomRight = getPixelAt(resultPixels, resultHeader, headerRGB.width + headerGray.width - 1, headerGray.height - 1);
    assert.strictEqual(outGrayBottomRight[0], grayBottomRight[0], 'Gray bottom-right R');
    assert.strictEqual(outGrayBottomRight[1], grayBottomRight[0], 'Gray bottom-right G');
    assert.strictEqual(outGrayBottomRight[2], grayBottomRight[0], 'Gray bottom-right B');
  });

  test('Concatenate RGBA and Grayscale+Alpha - verify alpha preserved', async () => {
    if (!canLoadPngSuite('basn6a08.png') || !canLoadPngSuite('basn4a08.png')) return;

    const pngRGBA = loadPngSuite('basn6a08.png');
    const pngGA = loadPngSuite('basn4a08.png');

    // Read pixels with alpha
    const headerRGBA = parsePngHeader(pngRGBA);
    const pixelsRGBA = await extractPixelData(parsePngChunks(pngRGBA), headerRGBA);
    const rgbaPixel = getPixelAt(pixelsRGBA, headerRGBA, 5, 5);

    const headerGA = parsePngHeader(pngGA);
    const pixelsGA = await extractPixelData(parsePngChunks(pngGA), headerGA);
    const gaPixel = getPixelAt(pixelsGA, headerGA, 5, 5);

    // Concatenate vertically
    const result = await concatToBuffer({
      inputs: [pngRGBA, pngGA],
      layout: { rows: 2 }
    });

    const resultHeader = parsePngHeader(result);
    const resultPixels = await extractPixelData(parsePngChunks(result), resultHeader);

    // Verify RGBA pixel at (5, 5)
    const outRGBA = getPixelAt(resultPixels, resultHeader, 5, 5);
    assert.deepStrictEqual(outRGBA, rgbaPixel, 'RGBA pixel preserved');

    // Verify GA pixel at (5, height1 + 5)
    const outGA = getPixelAt(resultPixels, resultHeader, 5, headerRGBA.height + 5);
    assert.strictEqual(outGA[0], gaPixel[0], 'GA R channel');
    assert.strictEqual(outGA[1], gaPixel[0], 'GA G channel');
    assert.strictEqual(outGA[2], gaPixel[0], 'GA B channel');
    assert.strictEqual(outGA[3], gaPixel[1], 'GA Alpha channel');
  });

  test('Concatenate 8-bit and 16-bit RGB - verify bit depth conversion', async () => {
    if (!canLoadPngSuite('basn2c08.png') || !canLoadPngSuite('basn2c16.png')) return;

    const png8 = loadPngSuite('basn2c08.png');
    const png16 = loadPngSuite('basn2c16.png');

    // Read a bright pixel from 8-bit image
    const header8 = parsePngHeader(png8);
    const pixels8 = await extractPixelData(parsePngChunks(png8), header8);
    const pixel8 = getPixelAt(pixels8, header8, 10, 10);

    // Read a pixel from 16-bit image
    const header16 = parsePngHeader(png16);
    const pixels16 = await extractPixelData(parsePngChunks(png16), header16);
    const pixel16 = getPixelAt(pixels16, header16, 10, 10);

    // Concatenate
    const result = await concatToBuffer({
      inputs: [png8, png16],
      layout: { columns: 2 }
    });

    const resultHeader = parsePngHeader(result);
    const resultPixels = await extractPixelData(parsePngChunks(result), resultHeader);

    // Output should be 16-bit
    assert.strictEqual(resultHeader.bitDepth, 16);

    // Verify 8-bit pixel was scaled to 16-bit at (10, 10)
    const out8 = getPixelAt(resultPixels, resultHeader, 10, 10);
    // 8-bit value scales by factor of 257 (65535/255)
    const expectedR = Math.round(pixel8[0] * 65535 / 255);
    const expectedG = Math.round(pixel8[1] * 65535 / 255);
    const expectedB = Math.round(pixel8[2] * 65535 / 255);

    // Allow small rounding differences
    assert.ok(Math.abs(out8[0] - expectedR) <= 1, `8-bit R scaled correctly: ${out8[0]} vs ${expectedR}`);
    assert.ok(Math.abs(out8[1] - expectedG) <= 1, `8-bit G scaled correctly: ${out8[1]} vs ${expectedG}`);
    assert.ok(Math.abs(out8[2] - expectedB) <= 1, `8-bit B scaled correctly: ${out8[2]} vs ${expectedB}`);

    // Verify 16-bit pixel preserved at (width1 + 10, 10)
    const out16 = getPixelAt(resultPixels, resultHeader, header8.width + 10, 10);
    assert.strictEqual(out16[0], pixel16[0], '16-bit R preserved');
    assert.strictEqual(out16[1], pixel16[1], '16-bit G preserved');
    assert.strictEqual(out16[2], pixel16[2], '16-bit B preserved');
  });

  test('Concatenate 1-bit and 8-bit Grayscale - verify sub-byte conversion', async () => {
    if (!canLoadPngSuite('basn0g01.png') || !canLoadPngSuite('basn0g08.png')) return;

    const png1bit = loadPngSuite('basn0g01.png');
    const png8bit = loadPngSuite('basn0g08.png');

    const header1 = parsePngHeader(png1bit);
    const header8 = parsePngHeader(png8bit);

    // Concatenate
    const result = await concatToBuffer({
      inputs: [png1bit, png8bit],
      layout: { columns: 2 }
    });

    const resultHeader = parsePngHeader(result);

    // Verify output is RGBA 8-bit
    assert.strictEqual(resultHeader.colorType, ColorType.RGBA);
    assert.strictEqual(resultHeader.bitDepth, 8);

    // Verify dimensions
    assert.strictEqual(resultHeader.width, header1.width + header8.width);
    assert.strictEqual(resultHeader.height, Math.max(header1.height, header8.height));
  });

  test('Concatenate 4-bit and 16-bit Grayscale - verify mixed bit depths', async () => {
    if (!canLoadPngSuite('basn0g04.png') || !canLoadPngSuite('basn0g16.png')) return;

    const png4bit = loadPngSuite('basn0g04.png');
    const png16bit = loadPngSuite('basn0g16.png');

    const result = await concatToBuffer({
      inputs: [png4bit, png16bit],
      layout: { columns: 2 }
    });

    const resultHeader = parsePngHeader(result);

    // Should use 16-bit since one input is 16-bit
    assert.strictEqual(resultHeader.bitDepth, 16);
    assert.strictEqual(resultHeader.colorType, ColorType.RGBA);
  });

  test('Grid concatenation - verify pixels at all four corners', async () => {
    if (!canLoadPngSuite('basn2c08.png') || !canLoadPngSuite('basn0g08.png') ||
        !canLoadPngSuite('basn6a08.png') || !canLoadPngSuite('basn4a08.png')) return;

    const png1 = loadPngSuite('basn2c08.png');    // Top-left
    const png2 = loadPngSuite('basn0g08.png');    // Top-right
    const png3 = loadPngSuite('basn6a08.png');    // Bottom-left
    const png4 = loadPngSuite('basn4a08.png');    // Bottom-right

    // Read corner pixels from each source
    const header1 = parsePngHeader(png1);
    const pixels1 = await extractPixelData(parsePngChunks(png1), header1);
    const pixel1 = getPixelAt(pixels1, header1, 0, 0);

    const header2 = parsePngHeader(png2);
    const pixels2 = await extractPixelData(parsePngChunks(png2), header2);
    const pixel2 = getPixelAt(pixels2, header2, 0, 0);

    const header3 = parsePngHeader(png3);
    const pixels3 = await extractPixelData(parsePngChunks(png3), header3);
    const pixel3 = getPixelAt(pixels3, header3, 0, 0);

    const header4 = parsePngHeader(png4);
    const pixels4 = await extractPixelData(parsePngChunks(png4), header4);
    const pixel4 = getPixelAt(pixels4, header4, 0, 0);

    // Concatenate in 2x2 grid
    const result = await concatToBuffer({
      inputs: [png1, png2, png3, png4],
      layout: { columns: 2 }
    });

    const resultHeader = parsePngHeader(result);
    const resultPixels = await extractPixelData(parsePngChunks(result), resultHeader);

    // Verify top-left (0, 0) - from png1
    const out1 = getPixelAt(resultPixels, resultHeader, 0, 0);
    assert.deepStrictEqual([out1[0], out1[1], out1[2]], pixel1, 'Top-left pixel');

    // Verify top-right (width1, 0) - from png2
    const out2 = getPixelAt(resultPixels, resultHeader, header1.width, 0);
    assert.strictEqual(out2[0], pixel2[0], 'Top-right pixel R');
    assert.strictEqual(out2[1], pixel2[0], 'Top-right pixel G');
    assert.strictEqual(out2[2], pixel2[0], 'Top-right pixel B');

    // Verify bottom-left (0, height1) - from png3
    const out3 = getPixelAt(resultPixels, resultHeader, 0, header1.height);
    assert.deepStrictEqual(out3, pixel3, 'Bottom-left pixel');

    // Verify bottom-right (width1, height1) - from png4
    const out4 = getPixelAt(resultPixels, resultHeader, header1.width, header1.height);
    assert.strictEqual(out4[0], pixel4[0], 'Bottom-right pixel R/G/B');
    assert.strictEqual(out4[1], pixel4[0], 'Bottom-right pixel R/G/B');
    assert.strictEqual(out4[2], pixel4[0], 'Bottom-right pixel R/G/B');
    assert.strictEqual(out4[3], pixel4[1], 'Bottom-right pixel Alpha');
  });
});

// ===== PROPERTY-BASED TESTS =====

describe('Property Tests: Verify concatenation properties', () => {
  test('Output dimensions are correct for horizontal concat', async () => {
    if (!canLoadPngSuite('basn2c08.png') || !canLoadPngSuite('basn0g08.png')) return;

    const png1 = loadPngSuite('basn2c08.png');
    const png2 = loadPngSuite('basn0g08.png');

    const header1 = parsePngHeader(png1);
    const header2 = parsePngHeader(png2);

    const result = await concatToBuffer({
      inputs: [png1, png2],
      layout: { columns: 2 }
    });

    const resultHeader = parsePngHeader(result);

    assert.strictEqual(resultHeader.width, header1.width + header2.width);
    assert.strictEqual(resultHeader.height, Math.max(header1.height, header2.height));
  });

  test('Output dimensions are correct for vertical concat', async () => {
    if (!canLoadPngSuite('basn2c08.png') || !canLoadPngSuite('basn0g08.png')) return;

    const png1 = loadPngSuite('basn2c08.png');
    const png2 = loadPngSuite('basn0g08.png');

    const header1 = parsePngHeader(png1);
    const header2 = parsePngHeader(png2);

    const result = await concatToBuffer({
      inputs: [png1, png2],
      layout: { rows: 2 }
    });

    const resultHeader = parsePngHeader(result);

    assert.strictEqual(resultHeader.width, Math.max(header1.width, header2.width));
    assert.strictEqual(resultHeader.height, header1.height + header2.height);
  });

  test('Output is valid PNG with correct structure', async () => {
    if (!canLoadPngSuite('basn2c08.png') || !canLoadPngSuite('basn0g08.png')) return;

    const result = await concatToBuffer({
      inputs: [
        loadPngSuite('basn2c08.png'),
        loadPngSuite('basn0g08.png')
      ],
      layout: { columns: 2 }
    });

    // Verify PNG signature
    assert.strictEqual(result[0], 0x89);
    assert.strictEqual(result[1], 0x50);
    assert.strictEqual(result[2], 0x4E);
    assert.strictEqual(result[3], 0x47);

    // Verify chunks are parseable
    const chunks = parsePngChunks(result);
    assert.ok(chunks.length >= 3, 'Should have at least IHDR, IDAT, IEND');
    assert.strictEqual(chunks[0].type, 'IHDR');
    assert.strictEqual(chunks[chunks.length - 1].type, 'IEND');
  });

  test('determineCommonFormat selects correct format', () => {
    // All 8-bit inputs -> 8-bit RGBA
    const headers1: PngHeader[] = [
      { width: 10, height: 10, bitDepth: 8, colorType: ColorType.RGB, compressionMethod: 0, filterMethod: 0, interlaceMethod: 0 },
      { width: 10, height: 10, bitDepth: 8, colorType: ColorType.GRAYSCALE, compressionMethod: 0, filterMethod: 0, interlaceMethod: 0 }
    ];
    const format1 = determineCommonFormat(headers1);
    assert.strictEqual(format1.bitDepth, 8);
    assert.strictEqual(format1.colorType, ColorType.RGBA);

    // One 16-bit input -> 16-bit RGBA
    const headers2: PngHeader[] = [
      { width: 10, height: 10, bitDepth: 8, colorType: ColorType.RGB, compressionMethod: 0, filterMethod: 0, interlaceMethod: 0 },
      { width: 10, height: 10, bitDepth: 16, colorType: ColorType.RGB, compressionMethod: 0, filterMethod: 0, interlaceMethod: 0 }
    ];
    const format2 = determineCommonFormat(headers2);
    assert.strictEqual(format2.bitDepth, 16);
    assert.strictEqual(format2.colorType, ColorType.RGBA);
  });
});

// ===== COMPREHENSIVE FORMAT COMBINATION TESTS =====

describe('Comprehensive Format Combination Tests', () => {
  const testCases: Array<{ name: string; file1: string; file2: string }> = [
    { name: 'Gray8 + Gray8', file1: 'basn0g08.png', file2: 'basn0g08.png' },
    { name: 'Gray8 + RGB8', file1: 'basn0g08.png', file2: 'basn2c08.png' },
    { name: 'Gray8 + RGBA8', file1: 'basn0g08.png', file2: 'basn6a08.png' },
    { name: 'Gray8 + GA8', file1: 'basn0g08.png', file2: 'basn4a08.png' },
    { name: 'RGB8 + RGB8', file1: 'basn2c08.png', file2: 'basn2c08.png' },
    { name: 'RGB8 + RGBA8', file1: 'basn2c08.png', file2: 'basn6a08.png' },
    { name: 'RGB8 + GA8', file1: 'basn2c08.png', file2: 'basn4a08.png' },
    { name: 'RGBA8 + RGBA8', file1: 'basn6a08.png', file2: 'basn6a08.png' },
    { name: 'RGBA8 + GA8', file1: 'basn6a08.png', file2: 'basn4a08.png' },
    { name: 'GA8 + GA8', file1: 'basn4a08.png', file2: 'basn4a08.png' },
    { name: 'Gray16 + Gray16', file1: 'basn0g16.png', file2: 'basn0g16.png' },
    { name: 'RGB16 + RGB16', file1: 'basn2c16.png', file2: 'basn2c16.png' },
    { name: 'Gray8 + Gray16', file1: 'basn0g08.png', file2: 'basn0g16.png' },
    { name: 'RGB8 + RGB16', file1: 'basn2c08.png', file2: 'basn2c16.png' },
    { name: 'Gray1 + Gray8', file1: 'basn0g01.png', file2: 'basn0g08.png' },
    { name: 'Gray4 + Gray8', file1: 'basn0g04.png', file2: 'basn0g08.png' },
    { name: 'Gray1 + RGB8', file1: 'basn0g01.png', file2: 'basn2c08.png' },
    { name: 'Gray4 + RGB8', file1: 'basn0g04.png', file2: 'basn2c08.png' },
  ];

  for (const tc of testCases) {
    test(`${tc.name}: successful concatenation`, async () => {
      if (!canLoadPngSuite(tc.file1) || !canLoadPngSuite(tc.file2)) {
        return; // Skip if files not available
      }

      const png1 = loadPngSuite(tc.file1);
      const png2 = loadPngSuite(tc.file2);

      const header1 = parsePngHeader(png1);
      const header2 = parsePngHeader(png2);

      const result = await concatToBuffer({
        inputs: [png1, png2],
        layout: { columns: 2 }
      });

      const resultHeader = parsePngHeader(result);

      // Verify output is valid
      assert.ok(result.length > 0, 'Result should not be empty');
      assert.strictEqual(resultHeader.colorType, ColorType.RGBA, 'Output should be RGBA');

      // Verify dimensions
      assert.strictEqual(resultHeader.width, header1.width + header2.width);
      assert.strictEqual(resultHeader.height, Math.max(header1.height, header2.height));

      // Verify bit depth is max of inputs
      const expectedBitDepth = Math.max(header1.bitDepth, header2.bitDepth) >= 16 ? 16 : 8;
      assert.strictEqual(resultHeader.bitDepth, expectedBitDepth);
    });
  }
});
