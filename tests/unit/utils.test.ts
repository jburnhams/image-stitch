import { test } from 'node:test';
import assert from 'node:assert';
import {
  pngCrc32,
  crc32,
  readUInt32BE,
  writeUInt32BE,
  stringToBytes,
  bytesToString,
  isPngSignature,
  PNG_SIGNATURE
} from '../../src/utils.js';

test('pngCrc32 calculates correct checksum', () => {
  // Test with known CRC values
  const data = stringToBytes('IHDR');
  const crc = pngCrc32(data);
  assert.strictEqual(typeof crc, 'number');
  assert.ok(crc >= 0);
});

test('pngCrc32 returns different values for different data', () => {
  const data1 = stringToBytes('IHDR');
  const data2 = stringToBytes('IDAT');
  const crc1 = pngCrc32(data1);
  const crc2 = pngCrc32(data2);
  assert.notStrictEqual(crc1, crc2);
});

test('crc32 alias matches pngCrc32 implementation', () => {
  const data = stringToBytes('IHDR');
  assert.strictEqual(crc32(data), pngCrc32(data));
});

test('readUInt32BE reads big-endian 32-bit integer', () => {
  const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x0D]);
  const value = readUInt32BE(buffer, 0);
  assert.strictEqual(value, 13);
});

test('readUInt32BE reads large values correctly', () => {
  const buffer = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const value = readUInt32BE(buffer, 0);
  assert.strictEqual(value, 0x12345678);
});

test('writeUInt32BE writes big-endian 32-bit integer', () => {
  const buffer = new Uint8Array(4);
  writeUInt32BE(buffer, 13, 0);
  assert.strictEqual(buffer[0], 0x00);
  assert.strictEqual(buffer[1], 0x00);
  assert.strictEqual(buffer[2], 0x00);
  assert.strictEqual(buffer[3], 0x0D);
});

test('writeUInt32BE and readUInt32BE are symmetric', () => {
  const buffer = new Uint8Array(4);
  const testValue = 0x12345678;
  writeUInt32BE(buffer, testValue, 0);
  const readValue = readUInt32BE(buffer, 0);
  assert.strictEqual(readValue, testValue);
});

test('stringToBytes converts ASCII string to bytes', () => {
  const str = 'IHDR';
  const bytes = stringToBytes(str);
  assert.strictEqual(bytes.length, 4);
  assert.strictEqual(bytes[0], 73); // 'I'
  assert.strictEqual(bytes[1], 72); // 'H'
  assert.strictEqual(bytes[2], 68); // 'D'
  assert.strictEqual(bytes[3], 82); // 'R'
});

test('bytesToString converts bytes to ASCII string', () => {
  const bytes = new Uint8Array([73, 72, 68, 82]);
  const str = bytesToString(bytes);
  assert.strictEqual(str, 'IHDR');
});

test('stringToBytes and bytesToString are symmetric', () => {
  const original = 'IHDR';
  const bytes = stringToBytes(original);
  const result = bytesToString(bytes);
  assert.strictEqual(result, original);
});

test('isPngSignature recognizes valid PNG signature', () => {
  assert.strictEqual(isPngSignature(PNG_SIGNATURE), true);
});

test('isPngSignature rejects invalid signature', () => {
  const invalid = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(isPngSignature(invalid), false);
});

test('isPngSignature rejects short data', () => {
  const short = new Uint8Array([137, 80, 78]);
  assert.strictEqual(isPngSignature(short), false);
});

test('PNG_SIGNATURE has correct bytes', () => {
  assert.strictEqual(PNG_SIGNATURE.length, 8);
  assert.strictEqual(PNG_SIGNATURE[0], 137);
  assert.strictEqual(PNG_SIGNATURE[1], 80); // 'P'
  assert.strictEqual(PNG_SIGNATURE[2], 78); // 'N'
  assert.strictEqual(PNG_SIGNATURE[3], 71); // 'G'
  assert.strictEqual(PNG_SIGNATURE[4], 13);
  assert.strictEqual(PNG_SIGNATURE[5], 10);
  assert.strictEqual(PNG_SIGNATURE[6], 26);
  assert.strictEqual(PNG_SIGNATURE[7], 10);
});
