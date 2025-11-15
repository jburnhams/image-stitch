import { test } from 'node:test';
import assert from 'node:assert';
import {
  copyPixelRegion,
  fillPixelRegion,
  createBlankImage,
  getTransparentColor,
  determineCommonFormat,
  convertPixelFormat,
  convertScanline
} from '../../src/pixel-ops.js';
import { ColorType, PngHeader } from '../../src/types.js';

const baseHeader: Omit<PngHeader, 'width' | 'height' | 'bitDepth' | 'colorType'> = {
  compressionMethod: 0,
  filterMethod: 0,
  interlaceMethod: 0
};

function createHeader(width: number, height: number, bitDepth: number, colorType: ColorType): PngHeader {
  return {
    width,
    height,
    bitDepth,
    colorType,
    ...baseHeader
  };
}

test('copyPixelRegion copies the requested area', () => {
  const header = createHeader(3, 2, 8, ColorType.RGBA);
  const src = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => i);
  const dst = new Uint8Array(src.length);

  copyPixelRegion(src, header, dst, header, 1, 0, 0, 1, 2, 1);

  const expected = new Uint8Array(src.length);
  expected.set(src.slice(4, 12), 12);
  assert.deepStrictEqual(dst, expected);
});

test('fillPixelRegion fills each pixel in the rectangle', () => {
  const header = createHeader(3, 2, 8, ColorType.RGBA);
  const dst = new Uint8Array(3 * 2 * 4);
  const color = new Uint8Array([255, 128, 0, 64]);

  fillPixelRegion(dst, header, 1, 0, 2, 2, color);

  const bytesPerPixel = 4;
  const rowBytes = header.width * bytesPerPixel;
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const offset = y * rowBytes + x * bytesPerPixel;
      if (x >= 1 && y <= 1) {
        assert.deepStrictEqual(dst.slice(offset, offset + bytesPerPixel), color);
      } else {
        assert.deepStrictEqual(dst.slice(offset, offset + bytesPerPixel), new Uint8Array(bytesPerPixel));
      }
    }
  }

  assert.throws(
    () => fillPixelRegion(dst, header, 0, 0, 1, 1, new Uint8Array([1, 2, 3])),
    /Color must have 4 bytes/
  );
});

test('createBlankImage uses the provided background color', () => {
  const rgbaHeader = createHeader(2, 2, 8, ColorType.RGBA);
  const blank = createBlankImage(rgbaHeader, new Uint8Array([10, 20, 30, 40]));
  assert.deepStrictEqual(
    Array.from(blank),
    [10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40]
  );

  const grayscaleHeader = createHeader(2, 1, 8, ColorType.GRAYSCALE);
  const grayscale = createBlankImage(grayscaleHeader, new Uint8Array([200, 201]));
  assert.deepStrictEqual(Array.from(grayscale), [200, 200]);
});

test('getTransparentColor returns zeroed samples for supported formats', () => {
  assert.deepStrictEqual(getTransparentColor(ColorType.GRAYSCALE, 8), new Uint8Array([0]));
  assert.deepStrictEqual(getTransparentColor(ColorType.RGB, 16), new Uint8Array(6).fill(0));
  assert.deepStrictEqual(getTransparentColor(ColorType.GRAYSCALE_ALPHA, 8), new Uint8Array([0, 0]));
  assert.deepStrictEqual(
    getTransparentColor(ColorType.GRAYSCALE_ALPHA, 16),
    new Uint8Array([0, 0, 0, 0])
  );
  assert.deepStrictEqual(
    getTransparentColor(ColorType.RGBA, 16),
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])
  );

  assert.throws(() => getTransparentColor(99, 8), /Unsupported color type/);
});

test('determineCommonFormat always returns RGBA with the maximum bit depth', () => {
  const eightBit = determineCommonFormat([
    createHeader(1, 1, 8, ColorType.GRAYSCALE),
    createHeader(1, 1, 8, ColorType.RGB)
  ]);
  assert.deepStrictEqual(eightBit, { bitDepth: 8, colorType: ColorType.RGBA });

  const mixed = determineCommonFormat([
    createHeader(1, 1, 8, ColorType.RGBA),
    createHeader(1, 1, 16, ColorType.GRAYSCALE)
  ]);
  assert.deepStrictEqual(mixed, { bitDepth: 16, colorType: ColorType.RGBA });
});

test('convertPixelFormat returns original data when already in target format', () => {
  const header = createHeader(1, 1, 8, ColorType.RGBA);
  const data = Uint8Array.from([1, 2, 3, 4]);
  const result = convertPixelFormat(data, header, 8, ColorType.RGBA);

  assert.strictEqual(result.data, data);
  assert.strictEqual(result.header, header);
});

test('convertPixelFormat converts grayscale variants to RGBA', () => {
  const grayHeader = createHeader(2, 1, 8, ColorType.GRAYSCALE);
  const grayData = Uint8Array.from([10, 20]);
  const grayResult = convertPixelFormat(grayData, grayHeader, 8, ColorType.RGBA);
  assert.deepStrictEqual(
    Array.from(grayResult.data),
    [10, 10, 10, 255, 20, 20, 20, 255]
  );

  const packedHeader = createHeader(4, 1, 1, ColorType.GRAYSCALE);
  const packedData = Uint8Array.from([0b10100000]);
  const packedResult = convertPixelFormat(packedData, packedHeader, 8, ColorType.RGBA);
  assert.deepStrictEqual(
    Array.from(packedResult.data),
    [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]
  );
});

test('convertPixelFormat converts RGB and grayscale+alpha 16-bit sources', () => {
  const rgbHeader = createHeader(1, 1, 16, ColorType.RGB);
  const rgbData = new Uint8Array([0xff, 0xff, 0x80, 0x00, 0x00, 0x00]);
  const rgbResult = convertPixelFormat(rgbData, rgbHeader, 8, ColorType.RGBA);
  const expectedGreen = Math.round((0x8000 * 0xff) / 0xffff);
  assert.deepStrictEqual(Array.from(rgbResult.data), [255, expectedGreen, 0, 255]);

  const gaHeader = createHeader(1, 1, 16, ColorType.GRAYSCALE_ALPHA);
  const gaData = new Uint8Array([0x40, 0x00, 0x80, 0x00]);
  const gaResult = convertPixelFormat(gaData, gaHeader, 8, ColorType.RGBA);
  const expectedGray = Math.round((0x4000 * 0xff) / 0xffff);
  const expectedAlpha = Math.round((0x8000 * 0xff) / 0xffff);
  assert.deepStrictEqual(Array.from(gaResult.data), [expectedGray, expectedGray, expectedGray, expectedAlpha]);
});

test('convertPixelFormat upconverts RGBA 8-bit sources to 16-bit', () => {
  const header = createHeader(1, 1, 8, ColorType.RGBA);
  const data = new Uint8Array([10, 20, 30, 40]);
  const result = convertPixelFormat(data, header, 16, ColorType.RGBA);
  const scale = (value: number) => Math.round((value * 0xffff) / 0xff);
  assert.deepStrictEqual(
    Array.from(result.data),
    [
      scale(10) >> 8, scale(10) & 0xff,
      scale(20) >> 8, scale(20) & 0xff,
      scale(30) >> 8, scale(30) & 0xff,
      scale(40) >> 8, scale(40) & 0xff
    ]
  );
});

test('convertPixelFormat validates supported configurations', () => {
  const header = createHeader(1, 1, 8, ColorType.GRAYSCALE);
  const data = Uint8Array.from([0]);
  assert.throws(
    () => convertPixelFormat(data, header, 8, ColorType.RGB),
    /Only conversion to RGBA/
  );

  const paletteHeader = createHeader(1, 1, 8, ColorType.PALETTE);
  assert.throws(
    () => convertPixelFormat(data, paletteHeader, 8, ColorType.RGBA),
    /Unsupported source color type/
  );
});

test('convertScanline reuses input when already matching target', () => {
  const scanline = new Uint8Array([1, 2, 3, 4]);
  const result = convertScanline(scanline, 1, 8, ColorType.RGBA, 8, ColorType.RGBA);
  assert.strictEqual(result, scanline);
});

test('convertScanline converts grayscale and RGB inputs', () => {
  const packed = new Uint8Array([0b10100000]);
  const packedResult = convertScanline(packed, 4, 1, ColorType.GRAYSCALE, 8, ColorType.RGBA);
  assert.deepStrictEqual(
    Array.from(packedResult),
    [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]
  );

  const rgb16 = new Uint8Array([0xff, 0xff, 0x80, 0x00, 0x00, 0x00]);
  const rgbResult = convertScanline(rgb16, 1, 16, ColorType.RGB, 8, ColorType.RGBA);
  const expectedGreen = Math.round((0x8000 * 0xff) / 0xffff);
  assert.deepStrictEqual(Array.from(rgbResult), [255, expectedGreen, 0, 255]);
});

test('convertScanline upconverts RGBA samples and validates inputs', () => {
  const rgba = new Uint8Array([1, 2, 3, 4]);
  const result = convertScanline(rgba, 1, 8, ColorType.RGBA, 16, ColorType.RGBA);
  const scale = (value: number) => Math.round((value * 0xffff) / 0xff);
  assert.deepStrictEqual(
    Array.from(result),
    [
      scale(1) >> 8, scale(1) & 0xff,
      scale(2) >> 8, scale(2) & 0xff,
      scale(3) >> 8, scale(3) & 0xff,
      scale(4) >> 8, scale(4) & 0xff
    ]
  );

  assert.throws(
    () => convertScanline(rgba, 1, 8, ColorType.RGBA, 8, ColorType.RGB),
    /Only conversion to RGBA/
  );

  assert.throws(
    () => convertScanline(new Uint8Array([0]), 1, 8, ColorType.PALETTE, 8, ColorType.RGBA),
    /Unsupported source color type/
  );
});
