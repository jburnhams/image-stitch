/**
 * png-concat browser bundle
 * Generated on 2025-10-28T06:25:20.656Z
 */


// ===== types.js =====
/**
 * PNG color types
 */
var ColorType;
(function (ColorType) {
    ColorType[ColorType["GRAYSCALE"] = 0] = "GRAYSCALE";
    ColorType[ColorType["RGB"] = 2] = "RGB";
    ColorType[ColorType["PALETTE"] = 3] = "PALETTE";
    ColorType[ColorType["GRAYSCALE_ALPHA"] = 4] = "GRAYSCALE_ALPHA";
    ColorType[ColorType["RGBA"] = 6] = "RGBA";
})(ColorType || (ColorType = {}));
//# sourceMappingURL=types.js.map

// ===== utils.js =====
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
function crc32(data, start = 0, length = data.length) {
    let crc = 0xffffffff;
    for (let i = start; i < start + length; i++) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
/**
 * Read a 32-bit big-endian unsigned integer
 */
function readUInt32BE(buffer, offset) {
    return ((buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]) >>> 0;
}
/**
 * Write a 32-bit big-endian unsigned integer
 */
function writeUInt32BE(buffer, value, offset) {
    buffer[offset] = (value >>> 24) & 0xff;
    buffer[offset + 1] = (value >>> 16) & 0xff;
    buffer[offset + 2] = (value >>> 8) & 0xff;
    buffer[offset + 3] = value & 0xff;
}
/**
 * Convert string to Uint8Array (ASCII)
 */
function stringToBytes(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
    }
    return bytes;
}
/**
 * Convert Uint8Array to string (ASCII)
 */
function bytesToString(bytes, start = 0, length = bytes.length) {
    let str = '';
    for (let i = start; i < start + length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}
/**
 * PNG file signature
 */
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/**
 * Verify PNG signature
 */
function isPngSignature(data) {
    if (data.length < 8)
        return false;
    for (let i = 0; i < 8; i++) {
        if (data[i] !== PNG_SIGNATURE[i])
            return false;
    }
    return true;
}
/**
 * Get number of samples per pixel for a color type
 */
function getSamplesPerPixel(colorType) {
    switch (colorType) {
        case 0: return 1; // Grayscale
        case 2: return 3; // RGB
        case 3: return 1; // Palette
        case 4: return 2; // Grayscale + Alpha
        case 6: return 4; // RGBA
        default: throw new Error(`Unknown color type: ${colorType}`);
    }
}
//# sourceMappingURL=utils.js.map

// ===== png-parser.js =====

/**
 * Parse PNG file and extract chunks
 */
class PngParser {
    data;
    offset;
    constructor(data) {
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
    readChunk() {
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
    readAllChunks() {
        const chunks = [];
        let chunk;
        while ((chunk = this.readChunk()) !== null) {
            chunks.push(chunk);
        }
        return chunks;
    }
    /**
     * Parse IHDR chunk to get image header information
     */
    static parseHeader(chunk) {
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
    getHeader() {
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
function parsePngHeader(data) {
    const parser = new PngParser(data);
    return parser.getHeader();
}
/**
 * Parse PNG file and return all chunks
 */
function parsePngChunks(data) {
    const parser = new PngParser(data);
    return parser.readAllChunks();
}
//# sourceMappingURL=png-parser.js.map

// ===== png-writer.js =====

/**
 * Create a PNG chunk
 */
function createChunk(type, data) {
    const typeBytes = stringToBytes(type);
    if (typeBytes.length !== 4) {
        throw new Error('Chunk type must be exactly 4 characters');
    }
    // Calculate CRC of type + data
    const crcData = new Uint8Array(4 + data.length);
    crcData.set(typeBytes, 0);
    crcData.set(data, 4);
    const crc = crc32(crcData);
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
function serializeChunk(chunk) {
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
function createIHDR(header) {
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
function createIEND() {
    return createChunk('IEND', new Uint8Array(0));
}
/**
 * Build a complete PNG file from chunks
 */
function buildPng(chunks) {
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
//# sourceMappingURL=png-writer.js.map

// ===== png-filter.js =====
/**
 * PNG Filter Types
 * Each scanline in a PNG is preceded by a filter type byte
 */
var FilterType;
(function (FilterType) {
    FilterType[FilterType["None"] = 0] = "None";
    FilterType[FilterType["Sub"] = 1] = "Sub";
    FilterType[FilterType["Up"] = 2] = "Up";
    FilterType[FilterType["Average"] = 3] = "Average";
    FilterType[FilterType["Paeth"] = 4] = "Paeth";
})(FilterType || (FilterType = {}));
/**
 * Paeth predictor function used in PNG filtering
 */
function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc)
        return a;
    if (pb <= pc)
        return b;
    return c;
}
/**
 * Unfilter a PNG scanline
 * @param filterType The filter type byte
 * @param scanline The filtered scanline (without filter type byte)
 * @param previousLine The previous unfiltered scanline (or null for first line)
 * @param bytesPerPixel Number of bytes per pixel
 */
function unfilterScanline(filterType, scanline, previousLine, bytesPerPixel) {
    const result = new Uint8Array(scanline.length);
    switch (filterType) {
        case FilterType.None:
            result.set(scanline);
            break;
        case FilterType.Sub:
            for (let i = 0; i < scanline.length; i++) {
                const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
                result[i] = (scanline[i] + left) & 0xff;
            }
            break;
        case FilterType.Up:
            for (let i = 0; i < scanline.length; i++) {
                const up = previousLine ? previousLine[i] : 0;
                result[i] = (scanline[i] + up) & 0xff;
            }
            break;
        case FilterType.Average:
            for (let i = 0; i < scanline.length; i++) {
                const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
                const up = previousLine ? previousLine[i] : 0;
                result[i] = (scanline[i] + Math.floor((left + up) / 2)) & 0xff;
            }
            break;
        case FilterType.Paeth:
            for (let i = 0; i < scanline.length; i++) {
                const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
                const up = previousLine ? previousLine[i] : 0;
                const upLeft = previousLine && i >= bytesPerPixel ? previousLine[i - bytesPerPixel] : 0;
                result[i] = (scanline[i] + paethPredictor(left, up, upLeft)) & 0xff;
            }
            break;
        default:
            throw new Error(`Unknown filter type: ${filterType}`);
    }
    return result;
}
/**
 * Apply Sub filter to a scanline
 */
function filterSub(scanline, bytesPerPixel) {
    const result = new Uint8Array(scanline.length);
    for (let i = 0; i < scanline.length; i++) {
        const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
        result[i] = (scanline[i] - left) & 0xff;
    }
    return result;
}
/**
 * Apply Up filter to a scanline
 */
function filterUp(scanline, previousLine) {
    const result = new Uint8Array(scanline.length);
    for (let i = 0; i < scanline.length; i++) {
        const up = previousLine ? previousLine[i] : 0;
        result[i] = (scanline[i] - up) & 0xff;
    }
    return result;
}
/**
 * Apply Average filter to a scanline
 */
function filterAverage(scanline, previousLine, bytesPerPixel) {
    const result = new Uint8Array(scanline.length);
    for (let i = 0; i < scanline.length; i++) {
        const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
        const up = previousLine ? previousLine[i] : 0;
        result[i] = (scanline[i] - Math.floor((left + up) / 2)) & 0xff;
    }
    return result;
}
/**
 * Apply Paeth filter to a scanline
 */
function filterPaeth(scanline, previousLine, bytesPerPixel) {
    const result = new Uint8Array(scanline.length);
    for (let i = 0; i < scanline.length; i++) {
        const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
        const up = previousLine ? previousLine[i] : 0;
        const upLeft = previousLine && i >= bytesPerPixel ? previousLine[i - bytesPerPixel] : 0;
        result[i] = (scanline[i] - paethPredictor(left, up, upLeft)) & 0xff;
    }
    return result;
}
/**
 * Choose the best filter for a scanline and apply it
 * Uses a simple heuristic: choose the filter that produces the smallest sum of absolute values
 */
function filterScanline(scanline, previousLine, bytesPerPixel) {
    // Try different filters and choose the best one
    const candidates = [
        { type: FilterType.None, data: scanline },
        { type: FilterType.Sub, data: filterSub(scanline, bytesPerPixel) },
        { type: FilterType.Up, data: filterUp(scanline, previousLine) },
        { type: FilterType.Average, data: filterAverage(scanline, previousLine, bytesPerPixel) },
        { type: FilterType.Paeth, data: filterPaeth(scanline, previousLine, bytesPerPixel) }
    ];
    // Calculate sum of absolute values for each filter
    let bestFilter = candidates[0];
    let bestSum = Infinity;
    for (const candidate of candidates) {
        let sum = 0;
        for (let i = 0; i < candidate.data.length; i++) {
            // Treat bytes as signed for better filter selection
            const signed = candidate.data[i] > 127 ? candidate.data[i] - 256 : candidate.data[i];
            sum += Math.abs(signed);
        }
        if (sum < bestSum) {
            bestSum = sum;
            bestFilter = candidate;
        }
    }
    return { filterType: bestFilter.type, filtered: bestFilter.data };
}
/**
 * Calculate bytes per pixel from PNG header information
 */
function getBytesPerPixel(bitDepth, colorType) {
    // ColorType: 0=grayscale, 2=RGB, 3=palette, 4=grayscale+alpha, 6=RGBA
    let samplesPerPixel = 1;
    switch (colorType) {
        case 0: // Grayscale
            samplesPerPixel = 1;
            break;
        case 2: // RGB
            samplesPerPixel = 3;
            break;
        case 3: // Palette
            samplesPerPixel = 1;
            break;
        case 4: // Grayscale + Alpha
            samplesPerPixel = 2;
            break;
        case 6: // RGBA
            samplesPerPixel = 4;
            break;
        default:
            throw new Error(`Unknown color type: ${colorType}`);
    }
    return Math.ceil((samplesPerPixel * bitDepth) / 8);
}
//# sourceMappingURL=png-filter.js.map

// ===== png-decompress.js =====



/**
 * Decompress and unfilter PNG image data
 * @param idatChunks Array of IDAT chunks containing compressed image data
 * @param header PNG header information
 * @returns Unfiltered raw pixel data
 */
function decompressImageData(idatChunks, header) {
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
    // Decompress using zlib
    const decompressed = inflateSync(compressedData);
    // Unfilter scanlines
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const scanlineLength = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
    const unfilteredData = new Uint8Array(header.height * scanlineLength);
    let previousLine = null;
    let srcOffset = 0;
    let dstOffset = 0;
    for (let y = 0; y < header.height; y++) {
        if (srcOffset >= decompressed.length) {
            throw new Error('Unexpected end of decompressed data');
        }
        const filterType = decompressed[srcOffset++];
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
function compressImageData(pixelData, header) {
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const scanlineLength = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
    // Add filter type bytes and filter each scanline
    const filteredData = new Uint8Array(header.height * (scanlineLength + 1));
    let srcOffset = 0;
    let dstOffset = 0;
    let previousLine = null;
    for (let y = 0; y < header.height; y++) {
        const scanline = pixelData.slice(srcOffset, srcOffset + scanlineLength);
        srcOffset += scanlineLength;
        const { filterType, filtered } = filterScanline(scanline, previousLine, bytesPerPixel);
        filteredData[dstOffset++] = filterType;
        filteredData.set(filtered, dstOffset);
        dstOffset += filtered.length;
        previousLine = scanline;
    }
    // Compress using zlib
    const compressed = deflateSync(filteredData, { level: 9 });
    return compressed;
}
/**
 * Extract pixel data from a PNG file
 */
function extractPixelData(chunks, header) {
    const idatChunks = chunks.filter(chunk => chunk.type === 'IDAT');
    if (idatChunks.length === 0) {
        throw new Error('No IDAT chunks found in PNG');
    }
    return decompressImageData(idatChunks, header);
}
//# sourceMappingURL=png-decompress.js.map

// ===== pixel-ops.js =====


/**
 * Copy a rectangular region from one image to another
 */
function copyPixelRegion(src, srcHeader, dst, dstHeader, srcX, srcY, dstX, dstY, width, height) {
    const bytesPerPixel = getBytesPerPixel(srcHeader.bitDepth, srcHeader.colorType);
    const srcRowBytes = Math.ceil((srcHeader.width * srcHeader.bitDepth * getSamplesPerPixel(srcHeader.colorType)) / 8);
    const dstRowBytes = Math.ceil((dstHeader.width * dstHeader.bitDepth * getSamplesPerPixel(dstHeader.colorType)) / 8);
    const copyBytes = width * bytesPerPixel;
    for (let y = 0; y < height; y++) {
        const srcOffset = (srcY + y) * srcRowBytes + srcX * bytesPerPixel;
        const dstOffset = (dstY + y) * dstRowBytes + dstX * bytesPerPixel;
        dst.set(src.slice(srcOffset, srcOffset + copyBytes), dstOffset);
    }
}
/**
 * Fill a rectangular region with a solid color
 */
function fillPixelRegion(dst, dstHeader, dstX, dstY, width, height, color) {
    const bytesPerPixel = getBytesPerPixel(dstHeader.bitDepth, dstHeader.colorType);
    const dstRowBytes = Math.ceil((dstHeader.width * dstHeader.bitDepth * getSamplesPerPixel(dstHeader.colorType)) / 8);
    if (color.length !== bytesPerPixel) {
        throw new Error(`Color must have ${bytesPerPixel} bytes`);
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dstOffset = (dstY + y) * dstRowBytes + (dstX + x) * bytesPerPixel;
            dst.set(color, dstOffset);
        }
    }
}
/**
 * Create a blank image with all pixels set to a color
 */
function createBlankImage(header, backgroundColor = new Uint8Array([0, 0, 0, 0])) {
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const rowBytes = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
    const totalBytes = header.height * rowBytes;
    const data = new Uint8Array(totalBytes);
    // Fill with background color
    if (backgroundColor.length !== bytesPerPixel) {
        // Adjust background color to match format
        backgroundColor = backgroundColor.slice(0, bytesPerPixel);
    }
    for (let i = 0; i < totalBytes; i += bytesPerPixel) {
        data.set(backgroundColor, i);
    }
    return data;
}
/**
 * Get transparent color for a given color type and bit depth
 */
function getTransparentColor(colorType, bitDepth) {
    const bytesPerSample = bitDepth === 16 ? 2 : 1;
    switch (colorType) {
        case 0: // Grayscale - black
            return new Uint8Array(bytesPerSample).fill(0);
        case 2: // RGB - black
            return new Uint8Array(3 * bytesPerSample).fill(0);
        case 4: // Grayscale + Alpha - transparent black
            if (bitDepth === 16) {
                return new Uint8Array([0, 0, 0, 0]); // 16-bit: gray=0, alpha=0
            }
            return new Uint8Array([0, 0]); // 8-bit: gray=0, alpha=0
        case 6: // RGBA - transparent black
            if (bitDepth === 16) {
                return new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]); // R=0, G=0, B=0, A=0
            }
            return new Uint8Array([0, 0, 0, 0]); // R=0, G=0, B=0, A=0
        default:
            throw new Error(`Unsupported color type: ${colorType}`);
    }
}
//# sourceMappingURL=pixel-ops.js.map

// ===== Main API =====

/**
 * Detect if we should use true streaming based on image characteristics
 */
function shouldUseTrueStreaming(options, headers) {
    // Explicit optimization request
    if (options.optimize === 'memory') {
        return true;
    }
    if (options.optimize === 'speed') {
        return false;
    }
    // Auto mode - decide based on memory requirements
    const firstHeader = headers[0];
    const imageWidth = firstHeader.width;
    const imageHeight = firstHeader.height;
    const bytesPerPixel = getBytesPerPixelFromHeader(firstHeader);
    // Calculate layout
    const numImages = options.inputs.length;
    const columns = options.layout.columns ||
        Math.ceil(numImages / (options.layout.rows || 1));
    const rows = Math.ceil(numImages / columns);
    // Calculate memory requirements
    const inputPixelBytes = imageWidth * imageHeight * bytesPerPixel;
    const totalInputMB = (inputPixelBytes * numImages) / (1024 * 1024);
    const outputWidth = columns * imageWidth;
    const outputHeight = rows * imageHeight;
    const outputPixelBytes = outputWidth * outputHeight * bytesPerPixel;
    const outputMB = outputPixelBytes / (1024 * 1024);
    const totalMemoryMB = totalInputMB + outputMB;
    // Memory budget (default 100 MB)
    const maxMemoryMB = options.maxMemoryMB || 100;
    // Use true streaming if estimated memory exceeds budget
    if (totalMemoryMB > maxMemoryMB) {
        return true;
    }
    // Also use true streaming for very large individual images
    const largeImageThreshold = 2000 * 2000; // 4MP
    const pixelsPerImage = imageWidth * imageHeight;
    if (pixelsPerImage > largeImageThreshold) {
        return true;
    }
    return false;
}
/**
 * Check if all inputs are file paths (required for true streaming)
 */
function allInputsAreFilePaths(inputs) {
    return inputs.every(input => typeof input === 'string');
}
/**
 * Get bytes per pixel from header
 */
function getBytesPerPixelFromHeader(header) {
    let samplesPerPixel = 1;
    switch (header.colorType) {
        case 0:
            samplesPerPixel = 1;
            break; // Grayscale
        case 2:
            samplesPerPixel = 3;
            break; // RGB
        case 3:
            samplesPerPixel = 1;
            break; // Palette
        case 4:
            samplesPerPixel = 2;
            break; // Grayscale + Alpha
        case 6:
            samplesPerPixel = 4;
            break; // RGBA
    }
    return Math.ceil((samplesPerPixel * header.bitDepth) / 8);
}
export function concatPngs(options) {
    return (async () => {
        // Dynamically import fs
        const { openSync, readSync, closeSync } = await import('node:fs');
        // Read headers to make decision
        const headers = [];
        for (const input of options.inputs) {
            let data;
            if (typeof input === 'string') {
                // Just read enough for header (first ~100 bytes)
                const buffer = Buffer.alloc(100);
                const fd = openSync(input, 'r');
                readSync(fd, buffer, 0, 100, 0);
                closeSync(fd);
                data = new Uint8Array(buffer);
            }
            else {
                data = input;
            }
            headers.push(parsePngHeader(data));
        }
        // Decide which implementation to use
        const useTrueStreaming = shouldUseTrueStreaming(options, headers) &&
            allInputsAreFilePaths(options.inputs);
        // Return appropriate result
        if (options.stream) {
            // User wants streaming output
            if (useTrueStreaming) {
                const { concatPngsTrueStreamingToStream } = await import('./png-concat-true-streaming.js');
                return concatPngsTrueStreamingToStream(options);
            }
            else {
                const { concatPngsToStream } = await import('./png-concat-stream.js');
                return concatPngsToStream(options);
            }
        }
        else {
            // User wants Uint8Array result
            if (useTrueStreaming) {
                // Use true streaming but collect into array
                const { concatPngsTrueStreaming } = await import('./png-concat-true-streaming.js');
                const chunks = [];
                for await (const chunk of concatPngsTrueStreaming(options)) {
                    chunks.push(chunk);
                }
                // Combine chunks
                const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    result.set(chunk, offset);
                    offset += chunk.length;
                }
                return result;
            }
            else {
                // Use regular implementation
                const { PngConcatenator } = await import('./png-concat-legacy.js');
                const concatenator = new PngConcatenator(options);
                return concatenator.concat();
            }
        }
    })();
}
/**
 * Convenience function: concatenate and write to stream
 *
 * @example
 * import { createWriteStream } from 'fs';
 *
 * const stream = await concatPngsToFile({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 }
 * });
 * stream.pipe(createWriteStream('output.png'));
 */
export async function concatPngsToFile(options) {
    return concatPngs({ ...options, stream: true });
}
//# sourceMappingURL=png-concat-unified.js.map