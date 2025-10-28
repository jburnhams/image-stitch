import { PngChunk, PngHeader } from './types.js';
import { unfilterScanline, filterScanline, getBytesPerPixel, FilterType } from './png-filter.js';
import { getSamplesPerPixel } from './utils.js';

/**
 * Decompress data using Web Compression Streams API
 * Works in both Node.js (18+) and modern browsers
 */
async function decompressData(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate'));
  const chunks: Uint8Array[] = [];
  const reader = decompressedStream.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Compress data using Web Compression Streams API
 * Works in both Node.js (18+) and modern browsers
 */
async function compressData(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('deflate'));
  const chunks: Uint8Array[] = [];
  const reader = compressedStream.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Decompress and unfilter PNG image data
 * @param idatChunks Array of IDAT chunks containing compressed image data
 * @param header PNG header information
 * @returns Unfiltered raw pixel data
 */
export async function decompressImageData(idatChunks: PngChunk[], header: PngHeader): Promise<Uint8Array> {
  // Concatenate all IDAT chunk data
  let totalLength = 0;
  for (const chunk of idatChunks) {
    if (chunk.type === 'IDAT') {
      totalLength += chunk.data.length;
    }
  }

  const compressedData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of idatChunks) {
    if (chunk.type === 'IDAT') {
      compressedData.set(chunk.data, offset);
      offset += chunk.data.length;
    }
  }

  // Decompress using Web Compression Streams API
  const decompressed = await decompressData(compressedData);

  // Unfilter scanlines
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const scanlineLength = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
  const unfilteredData = new Uint8Array(header.height * scanlineLength);

  let previousLine: Uint8Array | null = null;
  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < header.height; y++) {
    if (srcOffset >= decompressed.length) {
      throw new Error('Unexpected end of decompressed data');
    }

    const filterType = decompressed[srcOffset++] as FilterType;
    const scanline = decompressed.slice(srcOffset, srcOffset + scanlineLength);
    srcOffset += scanlineLength;

    const unfilteredLine = unfilterScanline(filterType, scanline, previousLine, bytesPerPixel);
    unfilteredData.set(unfilteredLine, dstOffset);
    dstOffset += scanlineLength;

    previousLine = unfilteredLine;
  }

  return unfilteredData;
}

/**
 * Filter and compress raw pixel data into PNG format
 * @param pixelData Raw unfiltered pixel data
 * @param header PNG header information
 * @returns Compressed IDAT chunk data
 */
export async function compressImageData(pixelData: Uint8Array, header: PngHeader): Promise<Uint8Array> {
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const scanlineLength = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);

  // Add filter type bytes and filter each scanline
  const filteredData = new Uint8Array(header.height * (scanlineLength + 1));
  let srcOffset = 0;
  let dstOffset = 0;
  let previousLine: Uint8Array | null = null;

  for (let y = 0; y < header.height; y++) {
    const scanline = pixelData.slice(srcOffset, srcOffset + scanlineLength);
    srcOffset += scanlineLength;

    const { filterType, filtered } = filterScanline(scanline, previousLine, bytesPerPixel);

    filteredData[dstOffset++] = filterType;
    filteredData.set(filtered, dstOffset);
    dstOffset += filtered.length;

    previousLine = scanline;
  }

  // Compress using Web Compression Streams API
  const compressed = await compressData(filteredData);

  return compressed;
}

/**
 * Extract pixel data from a PNG file
 */
export async function extractPixelData(chunks: PngChunk[], header: PngHeader): Promise<Uint8Array> {
  const idatChunks = chunks.filter(chunk => chunk.type === 'IDAT');
  if (idatChunks.length === 0) {
    throw new Error('No IDAT chunks found in PNG');
  }
  return await decompressImageData(idatChunks, header);
}
