import { PngChunk, PngHeader } from './types.js';
import {
  pngCrc32,
  writeUInt32BE,
  stringToBytes,
  PNG_SIGNATURE
} from './utils.js';

/**
 * Create a PNG chunk
 */
export function createChunk(type: string, data: Uint8Array): PngChunk {
  const typeBytes = stringToBytes(type);
  if (typeBytes.length !== 4) {
    throw new Error('Chunk type must be exactly 4 characters');
  }

  // Calculate CRC of type + data
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  const crc = pngCrc32(crcData);

  return {
    length: data.length,
    type,
    data,
    crc
  };
}

/**
 * Serialize a chunk to bytes
 */
export function serializeChunk(chunk: PngChunk): Uint8Array {
  const buffer = new Uint8Array(12 + chunk.length);
  let offset = 0;

  // Write length
  writeUInt32BE(buffer, chunk.length, offset);
  offset += 4;

  // Write type
  const typeBytes = stringToBytes(chunk.type);
  buffer.set(typeBytes, offset);
  offset += 4;

  // Write data
  buffer.set(chunk.data, offset);
  offset += chunk.length;

  // Write CRC
  writeUInt32BE(buffer, chunk.crc, offset);

  return buffer;
}

/**
 * Create IHDR chunk from header information
 */
export function createIHDR(header: PngHeader): PngChunk {
  const data = new Uint8Array(13);

  writeUInt32BE(data, header.width, 0);
  writeUInt32BE(data, header.height, 4);
  data[8] = header.bitDepth;
  data[9] = header.colorType;
  data[10] = header.compressionMethod;
  data[11] = header.filterMethod;
  data[12] = header.interlaceMethod;

  return createChunk('IHDR', data);
}

/**
 * Create IEND chunk
 */
export function createIEND(): PngChunk {
  return createChunk('IEND', new Uint8Array(0));
}

/**
 * Build a complete PNG file from chunks
 */
export function buildPng(chunks: PngChunk[]): Uint8Array {
  // Calculate total size
  let totalSize = 8; // Signature
  for (const chunk of chunks) {
    totalSize += 12 + chunk.length; // length(4) + type(4) + data + crc(4)
  }

  const buffer = new Uint8Array(totalSize);
  let offset = 0;

  // Write signature
  buffer.set(PNG_SIGNATURE, offset);
  offset += 8;

  // Write chunks
  for (const chunk of chunks) {
    const chunkBytes = serializeChunk(chunk);
    buffer.set(chunkBytes, offset);
    offset += chunkBytes.length;
  }

  return buffer;
}
