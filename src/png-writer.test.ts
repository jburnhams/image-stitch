import { test } from 'node:test';
import assert from 'node:assert';
import {
  createChunk,
  serializeChunk,
  createIHDR,
  createIEND,
  buildPng
} from './png-writer.js';
import { PngHeader, ColorType } from './types.js';
import { stringToBytes, isPngSignature, pngCrc32 } from './utils.js';

test('createChunk creates valid chunk structure', () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const chunk = createChunk('IDAT', data);

  assert.strictEqual(chunk.type, 'IDAT');
  assert.strictEqual(chunk.length, 4);
  assert.deepStrictEqual(chunk.data, data);
  assert.strictEqual(typeof chunk.crc, 'number');
});

test('createChunk calculates CRC correctly', () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const chunk = createChunk('IDAT', data);

  // Verify CRC includes type + data
  const typeBytes = stringToBytes('IDAT');
  const crcData = new Uint8Array(8);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  const expectedCrc = pngCrc32(crcData);

  assert.strictEqual(chunk.crc, expectedCrc);
});

test('createChunk throws on invalid type length', () => {
  const data = new Uint8Array([1, 2, 3]);
  assert.throws(
    () => createChunk('TOOLONG', data),
    /Chunk type must be exactly 4 characters/
  );
});

test('serializeChunk produces correct byte structure', () => {
  const data = new Uint8Array([0xAA, 0xBB]);
  const chunk = createChunk('TEST', data);
  const bytes = serializeChunk(chunk);

  // Total: 4(length) + 4(type) + 2(data) + 4(crc) = 14 bytes
  assert.strictEqual(bytes.length, 14);

  // Check length field (big-endian)
  assert.strictEqual(bytes[0], 0);
  assert.strictEqual(bytes[1], 0);
  assert.strictEqual(bytes[2], 0);
  assert.strictEqual(bytes[3], 2);

  // Check type field
  assert.strictEqual(bytes[4], 84); // 'T'
  assert.strictEqual(bytes[5], 69); // 'E'
  assert.strictEqual(bytes[6], 83); // 'S'
  assert.strictEqual(bytes[7], 84); // 'T'

  // Check data
  assert.strictEqual(bytes[8], 0xAA);
  assert.strictEqual(bytes[9], 0xBB);
});

test('createIHDR creates valid header chunk', () => {
  const header: PngHeader = {
    width: 100,
    height: 200,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const chunk = createIHDR(header);

  assert.strictEqual(chunk.type, 'IHDR');
  assert.strictEqual(chunk.length, 13);
  assert.strictEqual(chunk.data.length, 13);
});

test('createIHDR encodes dimensions correctly', () => {
  const header: PngHeader = {
    width: 256,
    height: 512,
    bitDepth: 8,
    colorType: ColorType.RGB,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const chunk = createIHDR(header);

  // Width: bytes 0-3 (big-endian 256 = 0x00000100)
  assert.strictEqual(chunk.data[0], 0);
  assert.strictEqual(chunk.data[1], 0);
  assert.strictEqual(chunk.data[2], 1);
  assert.strictEqual(chunk.data[3], 0);

  // Height: bytes 4-7 (big-endian 512 = 0x00000200)
  assert.strictEqual(chunk.data[4], 0);
  assert.strictEqual(chunk.data[5], 0);
  assert.strictEqual(chunk.data[6], 2);
  assert.strictEqual(chunk.data[7], 0);

  // Bit depth
  assert.strictEqual(chunk.data[8], 8);

  // Color type
  assert.strictEqual(chunk.data[9], ColorType.RGB);
});

test('createIEND creates valid end chunk', () => {
  const chunk = createIEND();

  assert.strictEqual(chunk.type, 'IEND');
  assert.strictEqual(chunk.length, 0);
  assert.strictEqual(chunk.data.length, 0);
});

test('buildPng creates valid PNG file structure', () => {
  const header: PngHeader = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', new Uint8Array([0]));
  const iend = createIEND();

  const png = buildPng([ihdr, idat, iend]);

  // Check PNG signature
  assert.ok(isPngSignature(png));

  // Verify signature is at the start
  assert.strictEqual(png[0], 137);
  assert.strictEqual(png[1], 80); // 'P'
  assert.strictEqual(png[2], 78); // 'N'
  assert.strictEqual(png[3], 71); // 'G'
});

test('buildPng with empty chunks only has signature', () => {
  const png = buildPng([]);

  assert.strictEqual(png.length, 8);
  assert.ok(isPngSignature(png));
});

test('buildPng preserves chunk order', () => {
  const chunks = [
    createChunk('TEST', new Uint8Array([1])),
    createChunk('DATA', new Uint8Array([2])),
    createChunk('ENDS', new Uint8Array([3]))
  ];

  const png = buildPng(chunks);

  // Skip signature (8 bytes)
  // First chunk type should be at offset 12 (8 sig + 4 length)
  assert.strictEqual(png[12], 84); // 'T'
  assert.strictEqual(png[13], 69); // 'E'
  assert.strictEqual(png[14], 83); // 'S'
  assert.strictEqual(png[15], 84); // 'T'
});
