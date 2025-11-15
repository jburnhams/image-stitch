import { test } from 'node:test';
import assert from 'node:assert';
import { PngParser, parsePngHeader, parsePngChunks } from '../../src/png-parser.js';
import { createIHDR, createIEND, buildPng } from '../../src/png-writer.js';
import { PngHeader, ColorType } from '../../src/types.js';

// Helper to create a minimal valid PNG
function createMinimalPng(header: PngHeader): Uint8Array {
  const ihdr = createIHDR(header);
  const iend = createIEND();
  return buildPng([ihdr, iend]);
}

test('PngParser rejects invalid signature', () => {
  const invalid = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.throws(
    () => new PngParser(invalid),
    /Invalid PNG signature/
  );
});

test('PngParser accepts valid PNG signature', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
  const png = createMinimalPng(header);

  assert.doesNotThrow(() => new PngParser(png));
});

test('PngParser.readChunk reads IHDR correctly', () => {
  const header: PngHeader = {
    width: 256,
    height: 128,
    bitDepth: 8,
    colorType: ColorType.RGB,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
  const png = createMinimalPng(header);
  const parser = new PngParser(png);

  const chunk = parser.readChunk();

  assert.ok(chunk);
  assert.strictEqual(chunk.type, 'IHDR');
  assert.strictEqual(chunk.length, 13);
  assert.strictEqual(chunk.data.length, 13);
});

test('PngParser.readChunk reads multiple chunks', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
  const png = createMinimalPng(header);
  const parser = new PngParser(png);

  const chunk1 = parser.readChunk();
  const chunk2 = parser.readChunk();

  assert.ok(chunk1);
  assert.strictEqual(chunk1.type, 'IHDR');

  assert.ok(chunk2);
  assert.strictEqual(chunk2.type, 'IEND');
});

test('PngParser.readChunk returns null at end', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
  const png = createMinimalPng(header);
  const parser = new PngParser(png);

  parser.readChunk(); // IHDR
  parser.readChunk(); // IEND
  const endChunk = parser.readChunk();

  assert.strictEqual(endChunk, null);
});

test('PngParser.readAllChunks reads all chunks', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
  const png = createMinimalPng(header);
  const parser = new PngParser(png);

  const chunks = parser.readAllChunks();

  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].type, 'IHDR');
  assert.strictEqual(chunks[1].type, 'IEND');
});

test('PngParser.parseHeader parses IHDR chunk correctly', () => {
  const expectedHeader: PngHeader = {
    width: 640,
    height: 480,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const ihdrChunk = createIHDR(expectedHeader);
  const parsedHeader = PngParser.parseHeader(ihdrChunk);

  assert.deepStrictEqual(parsedHeader, expectedHeader);
});

test('PngParser.parseHeader throws on non-IHDR chunk', () => {
  const chunk = createIEND();
  assert.throws(
    () => PngParser.parseHeader(chunk),
    /Not an IHDR chunk/
  );
});

test('PngParser.getHeader extracts header from PNG', () => {
  const expectedHeader: PngHeader = {
    width: 1920,
    height: 1080,
    bitDepth: 8,
    colorType: ColorType.RGB,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const png = createMinimalPng(expectedHeader);
  const parser = new PngParser(png);
  const header = parser.getHeader();

  assert.deepStrictEqual(header, expectedHeader);
});

test('parsePngHeader helper function works', () => {
  const expectedHeader: PngHeader = {
    width: 100,
    height: 200,
    bitDepth: 8,
    colorType: ColorType.GRAYSCALE,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const png = createMinimalPng(expectedHeader);
  const header = parsePngHeader(png);

  assert.deepStrictEqual(header, expectedHeader);
});

test('parsePngChunks helper function works', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const png = createMinimalPng(header);
  const chunks = parsePngChunks(png);

  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].type, 'IHDR');
  assert.strictEqual(chunks[1].type, 'IEND');
});

test('PngParser validates CRC', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const png = createMinimalPng(header);

  // Corrupt the CRC of the IHDR chunk
  // CRC is at offset: 8(sig) + 4(len) + 4(type) + 13(data) = 29
  png[29] ^= 0xFF;

  const parser = new PngParser(png);

  assert.throws(
    () => parser.readChunk(),
    /CRC mismatch/
  );
});

test('PngParser throws on incomplete chunk', () => {
  // Create a PNG and truncate it
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const png = createMinimalPng(header);
  const truncated = png.slice(0, 15); // Cut off mid-chunk

  const parser = new PngParser(truncated);

  assert.throws(
    () => parser.readChunk(),
    /Incomplete PNG chunk/
  );
});
