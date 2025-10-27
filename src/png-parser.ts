import { PngChunk, PngHeader } from './types.js';
import {
  crc32,
  readUInt32BE,
  bytesToString,
  isPngSignature
} from './utils.js';

/**
 * Parse PNG file and extract chunks
 */
export class PngParser {
  private data: Uint8Array;
  private offset: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.offset = 0;

    if (!isPngSignature(data)) {
      throw new Error('Invalid PNG signature');
    }
    this.offset = 8; // Skip signature
  }

  /**
   * Read the next chunk from the PNG file
   */
  readChunk(): PngChunk | null {
    if (this.offset >= this.data.length) {
      return null;
    }

    // Need at least 12 bytes for chunk structure (length + type + crc)
    if (this.offset + 12 > this.data.length) {
      throw new Error('Incomplete PNG chunk');
    }

    const length = readUInt32BE(this.data, this.offset);
    this.offset += 4;

    const typeBytes = this.data.slice(this.offset, this.offset + 4);
    const type = bytesToString(typeBytes);
    this.offset += 4;

    if (this.offset + length + 4 > this.data.length) {
      throw new Error('Incomplete PNG chunk data');
    }

    const data = this.data.slice(this.offset, this.offset + length);
    this.offset += length;

    const crc = readUInt32BE(this.data, this.offset);
    this.offset += 4;

    // Verify CRC (includes type + data)
    const crcData = new Uint8Array(4 + length);
    crcData.set(typeBytes, 0);
    crcData.set(data, 4);
    const calculatedCrc = crc32(crcData);

    if (calculatedCrc !== crc) {
      throw new Error(`CRC mismatch for chunk ${type}`);
    }

    return { length, type, data, crc };
  }

  /**
   * Read all chunks from the PNG file
   */
  readAllChunks(): PngChunk[] {
    const chunks: PngChunk[] = [];
    let chunk: PngChunk | null;

    while ((chunk = this.readChunk()) !== null) {
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Parse IHDR chunk to get image header information
   */
  static parseHeader(chunk: PngChunk): PngHeader {
    if (chunk.type !== 'IHDR') {
      throw new Error('Not an IHDR chunk');
    }

    if (chunk.data.length !== 13) {
      throw new Error('Invalid IHDR chunk length');
    }

    return {
      width: readUInt32BE(chunk.data, 0),
      height: readUInt32BE(chunk.data, 4),
      bitDepth: chunk.data[8],
      colorType: chunk.data[9],
      compressionMethod: chunk.data[10],
      filterMethod: chunk.data[11],
      interlaceMethod: chunk.data[12]
    };
  }

  /**
   * Get PNG header from file
   */
  getHeader(): PngHeader {
    // Reset to start of chunks
    const savedOffset = this.offset;
    this.offset = 8;

    const firstChunk = this.readChunk();
    if (!firstChunk || firstChunk.type !== 'IHDR') {
      throw new Error('First chunk must be IHDR');
    }

    const header = PngParser.parseHeader(firstChunk);

    // Restore offset
    this.offset = savedOffset;

    return header;
  }
}

/**
 * Parse PNG file and return header information
 */
export function parsePngHeader(data: Uint8Array): PngHeader {
  const parser = new PngParser(data);
  return parser.getHeader();
}

/**
 * Parse PNG file and return all chunks
 */
export function parsePngChunks(data: Uint8Array): PngChunk[] {
  const parser = new PngParser(data);
  return parser.readAllChunks();
}
