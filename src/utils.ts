/**
 * CRC32 lookup table for PNG chunk validation
 */
const CRC_TABLE = new Uint32Array(256);

// Initialize CRC table
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

/**
 * Calculate CRC32 checksum for PNG chunk
 */
export function crc32(data: Uint8Array, start = 0, length = data.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < start + length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Read a 32-bit big-endian unsigned integer
 */
export function readUInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  ) >>> 0;
}

/**
 * Write a 32-bit big-endian unsigned integer
 */
export function writeUInt32BE(buffer: Uint8Array, value: number, offset: number): void {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

/**
 * Convert string to Uint8Array (ASCII)
 */
export function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to string (ASCII)
 */
export function bytesToString(bytes: Uint8Array, start = 0, length = bytes.length): string {
  let str = '';
  for (let i = start; i < start + length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

/**
 * PNG file signature
 */
export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Verify PNG signature
 */
export function isPngSignature(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}
