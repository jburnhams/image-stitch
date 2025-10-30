/**
 * image-stitch bundle
 * Generated on 2025-10-30T17:39:00.156Z
 */
// ===== dist/esm/utils.js =====
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
function crc32Internal(data, start = 0, length = data.length) {
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

// ===== dist/esm/png-filter.js =====
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

// ===== dist/esm/png-writer.js =====

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

// ===== dist/esm/png-parser.js =====

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

// ===== dist/esm/png-input-adapter.js =====
const open = async () => { throw new Error('File system access is not available in this environment'); };
const readFileSync = () => { throw new Error('File system access is not available in this environment'); };
/**
 * PNG Input Adapter Architecture
 *
 * Provides a streaming interface for various PNG input sources.
 * Supports file-based, memory-based, and future extensible input types
 * (canvas, different formats, generated images, etc.)
 */





async function* decodeScanlinesFromCompressedData(compressedData, header) {
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const scanlineLength = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
    const bytesPerLine = 1 + scanlineLength;
    let previousScanline = null;
    let buffer = new Uint8Array(0);
    let processedLines = 0;
    const sourceBuffer = compressedData.byteOffset === 0 && compressedData.byteLength === compressedData.buffer.byteLength
        ? compressedData.buffer
        : compressedData.buffer.slice(compressedData.byteOffset, compressedData.byteOffset + compressedData.byteLength);
    const normalizedBuffer = sourceBuffer instanceof ArrayBuffer ? sourceBuffer : new Uint8Array(sourceBuffer).slice().buffer;
    const decompressedStream = new Blob([normalizedBuffer]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = decompressedStream.getReader();
    try {
        while (processedLines < header.height) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            if (!value || value.length === 0) {
                continue;
            }
            const merged = new Uint8Array(buffer.length + value.length);
            merged.set(buffer, 0);
            merged.set(value, buffer.length);
            buffer = merged;
            while (buffer.length >= bytesPerLine && processedLines < header.height) {
                const filterType = buffer[0];
                const filtered = buffer.subarray(1, 1 + scanlineLength);
                buffer = buffer.subarray(bytesPerLine);
                const unfiltered = unfilterScanline(filterType, filtered, previousScanline, bytesPerPixel);
                previousScanline = unfiltered;
                processedLines++;
                yield unfiltered;
            }
        }
    }
    finally {
        reader.releaseLock();
    }
    while (buffer.length >= bytesPerLine && processedLines < header.height) {
        const filterType = buffer[0];
        const filtered = buffer.subarray(1, 1 + scanlineLength);
        buffer = buffer.subarray(bytesPerLine);
        const unfiltered = unfilterScanline(filterType, filtered, previousScanline, bytesPerPixel);
        previousScanline = unfiltered;
        processedLines++;
        yield unfiltered;
    }
    if (processedLines !== header.height) {
        throw new Error(`Expected ${header.height} scanlines, decoded ${processedLines}`);
    }
    if (buffer.length > 0) {
        const hasResidualData = buffer.some((value) => value !== 0);
        if (hasResidualData) {
            throw new Error(`Unexpected remaining decompressed data (${buffer.length} bytes)`);
        }
    }
}
/**
 * Adapter for file-based PNG inputs
 * Streams data directly from disk with minimal memory usage
 */
class FileInputAdapter {
    fileHandle = null;
    header = null;
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async getHeader() {
        if (this.header) {
            return this.header;
        }
        // Read just enough to parse the header (typically < 1KB)
        const data = readFileSync(this.filePath);
        this.header = parsePngHeader(data);
        return this.header;
    }
    async *scanlines() {
        const header = await this.getHeader();
        // Open file for streaming
        this.fileHandle = await open(this.filePath, 'r');
        try {
            // Find and read IDAT chunks
            const idatData = await this.extractIdatData();
            const compressedView = new Uint8Array(idatData.buffer, idatData.byteOffset, idatData.byteLength);
            for await (const scanline of decodeScanlinesFromCompressedData(compressedView, header)) {
                yield scanline;
            }
        }
        finally {
            // Ensure file handle is closed even if iteration stops early
            if (this.fileHandle) {
                await this.fileHandle.close();
                this.fileHandle = null;
            }
        }
    }
    async close() {
        if (this.fileHandle) {
            await this.fileHandle.close();
            this.fileHandle = null;
        }
    }
    async extractIdatData() {
        if (!this.fileHandle) {
            throw new Error('File not opened');
        }
        let position = 8; // Skip PNG signature
        const idatChunks = [];
        // Find all IDAT chunks
        while (true) {
            const lengthBuffer = Buffer.alloc(4);
            await this.fileHandle.read(lengthBuffer, 0, 4, position);
            const chunkLength = readUInt32BE(new Uint8Array(lengthBuffer), 0);
            position += 4;
            const typeBuffer = Buffer.alloc(4);
            await this.fileHandle.read(typeBuffer, 0, 4, position);
            const chunkType = bytesToString(new Uint8Array(typeBuffer));
            position += 4;
            if (chunkType === 'IDAT') {
                idatChunks.push({ offset: position, length: chunkLength });
            }
            position += chunkLength + 4; // Skip data + CRC
            if (chunkType === 'IEND') {
                break;
            }
        }
        // Read and concatenate all IDAT data
        let totalIdatLength = 0;
        for (const chunk of idatChunks) {
            totalIdatLength += chunk.length;
        }
        const idatData = Buffer.alloc(totalIdatLength);
        let offset = 0;
        for (const chunk of idatChunks) {
            await this.fileHandle.read(idatData, offset, chunk.length, chunk.offset);
            offset += chunk.length;
        }
        return idatData;
    }
}
/**
 * Adapter for Uint8Array (in-memory) PNG inputs
 * Efficient for already-loaded images
 */
class Uint8ArrayInputAdapter {
    header = null;
    data;
    constructor(data) {
        this.data = data;
    }
    async getHeader() {
        if (this.header) {
            return this.header;
        }
        this.header = parsePngHeader(this.data);
        return this.header;
    }
    async *scanlines() {
        const header = await this.getHeader();
        const chunks = parsePngChunks(this.data);
        // Find and concatenate IDAT chunks
        const idatChunks = chunks.filter(chunk => chunk.type === 'IDAT');
        if (idatChunks.length === 0) {
            throw new Error('No IDAT chunks found in PNG');
        }
        let totalLength = 0;
        for (const chunk of idatChunks) {
            totalLength += chunk.data.length;
        }
        const compressedData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of idatChunks) {
            compressedData.set(chunk.data, offset);
            offset += chunk.data.length;
        }
        for await (const scanline of decodeScanlinesFromCompressedData(compressedData, header)) {
            yield scanline;
        }
    }
    async close() {
        // No resources to clean up for memory-based input
    }
}
/**
 * Factory function to create appropriate adapter for any input type
 * Supports auto-detection of input types
 */
async function createInputAdapter(input) {
    // If already an adapter, return as-is
    if (typeof input === 'object' && 'getHeader' in input && 'scanlines' in input && 'close' in input) {
        return input;
    }
    // Auto-detect input type
    if (typeof input === 'string') {
        return new FileInputAdapter(input);
    }
    if (input instanceof Uint8Array) {
        return new Uint8ArrayInputAdapter(input);
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8ArrayInputAdapter(new Uint8Array(input));
    }
    throw new Error('Unsupported input type. Expected string (file path), Uint8Array, ArrayBuffer, or PngInputAdapter');
}
/**
 * Create multiple adapters from mixed input types
 */
async function createInputAdapters(inputs) {
    return Promise.all(inputs.map(input => createInputAdapter(input)));
}

// ===== dist/esm/pixel-ops.js =====


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
/**
 * Determine the best common format for a set of PNG headers
 * Returns the bit depth and color type that can represent all images
 */
function determineCommonFormat(headers) {
    // Find the maximum bit depth
    let maxBitDepth = 8;
    for (const header of headers) {
        // Track bit depth (anything > 8 means we need 16-bit)
        if (header.bitDepth === 16) {
            maxBitDepth = 16;
        }
    }
    // Always use RGBA as target format for maximum compatibility
    // This simplifies the conversion logic
    return { bitDepth: maxBitDepth, colorType: 6 };
}
/**
 * Scale a sample value from one bit depth to another
 */
function scaleSample(value, fromBits, toBits) {
    if (fromBits === toBits)
        return value;
    // Scale up: multiply by the ratio of max values
    if (fromBits < toBits) {
        const fromMax = (1 << fromBits) - 1;
        const toMax = (1 << toBits) - 1;
        return Math.round((value * toMax) / fromMax);
    }
    // Scale down: divide by the ratio
    const fromMax = (1 << fromBits) - 1;
    const toMax = (1 << toBits) - 1;
    return Math.round((value * toMax) / fromMax);
}
/**
 * Convert pixel data from one format to another
 * Converts any PNG format to RGBA (8-bit or 16-bit)
 */
function convertPixelFormat(srcData, srcHeader, targetBitDepth, targetColorType) {
    // If already in target format, return as-is
    if (srcHeader.bitDepth === targetBitDepth && srcHeader.colorType === targetColorType) {
        return { data: srcData, header: srcHeader };
    }
    // Only support converting to RGBA
    if (targetColorType !== 6) {
        throw new Error('Only conversion to RGBA (color type 6) is supported');
    }
    const width = srcHeader.width;
    const height = srcHeader.height;
    const srcBitDepth = srcHeader.bitDepth;
    const srcColorType = srcHeader.colorType;
    // Calculate output size
    const targetBytesPerPixel = targetBitDepth === 16 ? 8 : 4; // RGBA
    const targetRowBytes = width * targetBytesPerPixel;
    const targetData = new Uint8Array(height * targetRowBytes);
    // Process each pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 255; // Default to opaque
            // Read source pixel based on format
            if (srcColorType === 0) {
                // Grayscale
                const srcRowBytes = Math.ceil((width * srcBitDepth) / 8);
                if (srcBitDepth === 16) {
                    const offset = y * srcRowBytes + x * 2;
                    const gray = (srcData[offset] << 8) | srcData[offset + 1];
                    r = g = b = scaleSample(gray, 16, targetBitDepth);
                }
                else if (srcBitDepth === 8) {
                    const offset = y * srcRowBytes + x;
                    const gray = srcData[offset];
                    r = g = b = scaleSample(gray, 8, targetBitDepth);
                }
                else {
                    // Sub-byte bit depths (1, 2, 4)
                    const srcRowBytes = Math.ceil((width * srcBitDepth) / 8);
                    const byteOffset = y * srcRowBytes + Math.floor((x * srcBitDepth) / 8);
                    const bitOffset = (x * srcBitDepth) % 8;
                    const mask = (1 << srcBitDepth) - 1;
                    const gray = (srcData[byteOffset] >> (8 - bitOffset - srcBitDepth)) & mask;
                    r = g = b = scaleSample(gray, srcBitDepth, targetBitDepth);
                }
                a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
            }
            else if (srcColorType === 2) {
                // RGB
                const srcBytesPerPixel = (srcBitDepth === 16) ? 6 : 3;
                const srcRowBytes = width * srcBytesPerPixel;
                const offset = y * srcRowBytes + x * srcBytesPerPixel;
                if (srcBitDepth === 16) {
                    r = ((srcData[offset] << 8) | srcData[offset + 1]);
                    g = ((srcData[offset + 2] << 8) | srcData[offset + 3]);
                    b = ((srcData[offset + 4] << 8) | srcData[offset + 5]);
                    if (targetBitDepth === 8) {
                        r = scaleSample(r, 16, 8);
                        g = scaleSample(g, 16, 8);
                        b = scaleSample(b, 16, 8);
                    }
                }
                else {
                    r = srcData[offset];
                    g = srcData[offset + 1];
                    b = srcData[offset + 2];
                    if (targetBitDepth === 16) {
                        r = scaleSample(r, 8, 16);
                        g = scaleSample(g, 8, 16);
                        b = scaleSample(b, 8, 16);
                    }
                }
                a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
            }
            else if (srcColorType === 4) {
                // Grayscale + Alpha
                const srcBytesPerPixel = (srcBitDepth === 16) ? 4 : 2;
                const srcRowBytes = width * srcBytesPerPixel;
                const offset = y * srcRowBytes + x * srcBytesPerPixel;
                if (srcBitDepth === 16) {
                    const gray = (srcData[offset] << 8) | srcData[offset + 1];
                    r = g = b = (targetBitDepth === 16) ? gray : scaleSample(gray, 16, 8);
                    a = (srcData[offset + 2] << 8) | srcData[offset + 3];
                    if (targetBitDepth === 8) {
                        a = scaleSample(a, 16, 8);
                    }
                }
                else {
                    r = g = b = (targetBitDepth === 16) ? scaleSample(srcData[offset], 8, 16) : srcData[offset];
                    a = (targetBitDepth === 16) ? scaleSample(srcData[offset + 1], 8, 16) : srcData[offset + 1];
                }
            }
            else if (srcColorType === 6) {
                // RGBA
                const srcBytesPerPixel = (srcBitDepth === 16) ? 8 : 4;
                const srcRowBytes = width * srcBytesPerPixel;
                const offset = y * srcRowBytes + x * srcBytesPerPixel;
                if (srcBitDepth === 16) {
                    r = (srcData[offset] << 8) | srcData[offset + 1];
                    g = (srcData[offset + 2] << 8) | srcData[offset + 3];
                    b = (srcData[offset + 4] << 8) | srcData[offset + 5];
                    a = (srcData[offset + 6] << 8) | srcData[offset + 7];
                    if (targetBitDepth === 8) {
                        r = scaleSample(r, 16, 8);
                        g = scaleSample(g, 16, 8);
                        b = scaleSample(b, 16, 8);
                        a = scaleSample(a, 16, 8);
                    }
                }
                else {
                    r = srcData[offset];
                    g = srcData[offset + 1];
                    b = srcData[offset + 2];
                    a = srcData[offset + 3];
                    if (targetBitDepth === 16) {
                        r = scaleSample(r, 8, 16);
                        g = scaleSample(g, 8, 16);
                        b = scaleSample(b, 8, 16);
                        a = scaleSample(a, 8, 16);
                    }
                }
            }
            else {
                throw new Error(`Unsupported source color type: ${srcColorType}`);
            }
            // Write target pixel (RGBA)
            const targetOffset = y * targetRowBytes + x * targetBytesPerPixel;
            if (targetBitDepth === 16) {
                targetData[targetOffset] = (r >> 8) & 0xFF;
                targetData[targetOffset + 1] = r & 0xFF;
                targetData[targetOffset + 2] = (g >> 8) & 0xFF;
                targetData[targetOffset + 3] = g & 0xFF;
                targetData[targetOffset + 4] = (b >> 8) & 0xFF;
                targetData[targetOffset + 5] = b & 0xFF;
                targetData[targetOffset + 6] = (a >> 8) & 0xFF;
                targetData[targetOffset + 7] = a & 0xFF;
            }
            else {
                targetData[targetOffset] = r;
                targetData[targetOffset + 1] = g;
                targetData[targetOffset + 2] = b;
                targetData[targetOffset + 3] = a;
            }
        }
    }
    // Create new header with target format
    const targetHeader = {
        ...srcHeader,
        bitDepth: targetBitDepth,
        colorType: targetColorType
    };
    return { data: targetData, header: targetHeader };
}
/**
 * Convert a single scanline from one format to another
 * This is optimized for streaming - converts one row at a time
 */
function convertScanline(srcScanline, width, srcBitDepth, srcColorType, targetBitDepth, targetColorType) {
    // If already in target format, return as-is
    if (srcBitDepth === targetBitDepth && srcColorType === targetColorType) {
        return srcScanline;
    }
    // Only support converting to RGBA
    if (targetColorType !== 6) {
        throw new Error('Only conversion to RGBA (color type 6) is supported');
    }
    const targetBytesPerPixel = targetBitDepth === 16 ? 8 : 4; // RGBA
    const targetScanline = new Uint8Array(width * targetBytesPerPixel);
    // Process each pixel in the scanline
    for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 255; // Default to opaque
        // Read source pixel based on format
        if (srcColorType === 0) {
            // Grayscale
            if (srcBitDepth === 16) {
                const offset = x * 2;
                const gray = (srcScanline[offset] << 8) | srcScanline[offset + 1];
                r = g = b = scaleSample(gray, 16, targetBitDepth);
            }
            else if (srcBitDepth === 8) {
                const gray = srcScanline[x];
                r = g = b = scaleSample(gray, 8, targetBitDepth);
            }
            else {
                // Sub-byte bit depths (1, 2, 4)
                const byteOffset = Math.floor((x * srcBitDepth) / 8);
                const bitOffset = (x * srcBitDepth) % 8;
                const mask = (1 << srcBitDepth) - 1;
                const gray = (srcScanline[byteOffset] >> (8 - bitOffset - srcBitDepth)) & mask;
                r = g = b = scaleSample(gray, srcBitDepth, targetBitDepth);
            }
            a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
        }
        else if (srcColorType === 2) {
            // RGB
            const srcBytesPerPixel = (srcBitDepth === 16) ? 6 : 3;
            const offset = x * srcBytesPerPixel;
            if (srcBitDepth === 16) {
                r = ((srcScanline[offset] << 8) | srcScanline[offset + 1]);
                g = ((srcScanline[offset + 2] << 8) | srcScanline[offset + 3]);
                b = ((srcScanline[offset + 4] << 8) | srcScanline[offset + 5]);
                if (targetBitDepth === 8) {
                    r = scaleSample(r, 16, 8);
                    g = scaleSample(g, 16, 8);
                    b = scaleSample(b, 16, 8);
                }
            }
            else {
                r = srcScanline[offset];
                g = srcScanline[offset + 1];
                b = srcScanline[offset + 2];
                if (targetBitDepth === 16) {
                    r = scaleSample(r, 8, 16);
                    g = scaleSample(g, 8, 16);
                    b = scaleSample(b, 8, 16);
                }
            }
            a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
        }
        else if (srcColorType === 4) {
            // Grayscale + Alpha
            const srcBytesPerPixel = (srcBitDepth === 16) ? 4 : 2;
            const offset = x * srcBytesPerPixel;
            if (srcBitDepth === 16) {
                const gray = (srcScanline[offset] << 8) | srcScanline[offset + 1];
                r = g = b = (targetBitDepth === 16) ? gray : scaleSample(gray, 16, 8);
                a = (srcScanline[offset + 2] << 8) | srcScanline[offset + 3];
                if (targetBitDepth === 8) {
                    a = scaleSample(a, 16, 8);
                }
            }
            else {
                r = g = b = (targetBitDepth === 16) ? scaleSample(srcScanline[offset], 8, 16) : srcScanline[offset];
                a = (targetBitDepth === 16) ? scaleSample(srcScanline[offset + 1], 8, 16) : srcScanline[offset + 1];
            }
        }
        else if (srcColorType === 6) {
            // RGBA
            const srcBytesPerPixel = (srcBitDepth === 16) ? 8 : 4;
            const offset = x * srcBytesPerPixel;
            if (srcBitDepth === 16) {
                r = (srcScanline[offset] << 8) | srcScanline[offset + 1];
                g = (srcScanline[offset + 2] << 8) | srcScanline[offset + 3];
                b = (srcScanline[offset + 4] << 8) | srcScanline[offset + 5];
                a = (srcScanline[offset + 6] << 8) | srcScanline[offset + 7];
                if (targetBitDepth === 8) {
                    r = scaleSample(r, 16, 8);
                    g = scaleSample(g, 16, 8);
                    b = scaleSample(b, 16, 8);
                    a = scaleSample(a, 16, 8);
                }
            }
            else {
                r = srcScanline[offset];
                g = srcScanline[offset + 1];
                b = srcScanline[offset + 2];
                a = srcScanline[offset + 3];
                if (targetBitDepth === 16) {
                    r = scaleSample(r, 8, 16);
                    g = scaleSample(g, 8, 16);
                    b = scaleSample(b, 8, 16);
                    a = scaleSample(a, 8, 16);
                }
            }
        }
        else {
            throw new Error(`Unsupported source color type: ${srcColorType}`);
        }
        // Write target pixel (RGBA)
        const targetOffset = x * targetBytesPerPixel;
        if (targetBitDepth === 16) {
            targetScanline[targetOffset] = (r >> 8) & 0xFF;
            targetScanline[targetOffset + 1] = r & 0xFF;
            targetScanline[targetOffset + 2] = (g >> 8) & 0xFF;
            targetScanline[targetOffset + 3] = g & 0xFF;
            targetScanline[targetOffset + 4] = (b >> 8) & 0xFF;
            targetScanline[targetOffset + 5] = b & 0xFF;
            targetScanline[targetOffset + 6] = (a >> 8) & 0xFF;
            targetScanline[targetOffset + 7] = a & 0xFF;
        }
        else {
            targetScanline[targetOffset] = r;
            targetScanline[targetOffset + 1] = g;
            targetScanline[targetOffset + 2] = b;
            targetScanline[targetOffset + 3] = a;
        }
    }
    return targetScanline;
}

// ===== dist/esm/png-concat.js =====
const Readable = typeof globalThis !== 'undefined' && globalThis.Readable ? globalThis.Readable : class { constructor() { throw new Error('Readable is not available in this environment'); } };
/**
 * PNG Concatenation
 *
 * Scanline-by-scanline streaming approach that minimizes memory usage.
 * Processes one output row at a time using the adapter architecture.
 */






/**
 * Combines multiple scanlines horizontally into one output scanline with variable widths
 */
function combineScanlines(scanlines, widths, bytesPerPixel) {
    const totalWidth = widths.reduce((sum, w) => sum + w, 0);
    const output = new Uint8Array(totalWidth * bytesPerPixel);
    let offset = 0;
    for (let i = 0; i < scanlines.length; i++) {
        output.set(scanlines[i], offset);
        offset += widths[i] * bytesPerPixel;
    }
    return output;
}
/**
 * Create a transparent scanline of given width
 */
function createTransparentScanline(width, bytesPerPixel, transparentColor) {
    const scanline = new Uint8Array(width * bytesPerPixel);
    for (let i = 0; i < width; i++) {
        scanline.set(transparentColor, i * bytesPerPixel);
    }
    return scanline;
}
/**
 * Pad a scanline to a target width with transparent pixels
 */
function padScanline(scanline, currentWidth, targetWidth, bytesPerPixel, transparentColor) {
    if (currentWidth >= targetWidth) {
        return scanline;
    }
    const padded = new Uint8Array(targetWidth * bytesPerPixel);
    padded.set(scanline, 0);
    // Fill padding with transparent color
    for (let i = currentWidth; i < targetWidth; i++) {
        padded.set(transparentColor, i * bytesPerPixel);
    }
    return padded;
}
/**
 * Calculate grid layout with variable image sizes
 */
function calculateLayout(headers, options) {
    const { layout } = options;
    const numImages = headers.length;
    let grid = [];
    if (layout.columns && !layout.height) {
        const columns = layout.columns;
        const rows = Math.ceil(numImages / columns);
        grid = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => {
            const idx = row * columns + col;
            return idx < numImages ? idx : -1;
        }));
    }
    else if (layout.rows && !layout.width) {
        const rows = layout.rows;
        const columns = Math.ceil(numImages / rows);
        grid = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => {
            const idx = col * rows + row;
            return idx < numImages ? idx : -1;
        }));
    }
    else if (layout.width || layout.height) {
        grid = calculatePixelBasedLayout(headers, layout.width, layout.height, layout.columns, layout.rows);
    }
    else {
        grid = [Array.from({ length: numImages }, (_, i) => i)];
    }
    // Calculate max width per column in each row and max height per row
    const rowHeights = [];
    const colWidths = [];
    for (let row = 0; row < grid.length; row++) {
        let maxHeight = 0;
        const rowColWidths = [];
        for (let col = 0; col < grid[row].length; col++) {
            const imageIdx = grid[row][col];
            if (imageIdx >= 0) {
                const header = headers[imageIdx];
                maxHeight = Math.max(maxHeight, header.height);
                rowColWidths[col] = Math.max(rowColWidths[col] || 0, header.width);
            }
            else {
                rowColWidths[col] = rowColWidths[col] || 0;
            }
        }
        rowHeights.push(maxHeight);
        colWidths.push(rowColWidths);
    }
    const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);
    const totalWidth = Math.max(...colWidths.map(row => row.reduce((sum, w) => sum + w, 0)));
    return { grid, rowHeights, colWidths, totalWidth, totalHeight };
}
/**
 * Calculate layout when pixel-based width/height limits are specified
 */
function calculatePixelBasedLayout(headers, maxWidth, maxHeight, fixedColumns, fixedRows) {
    const grid = [];
    let currentRow = [];
    let currentRowWidth = 0;
    let currentRowMaxHeight = 0;
    let totalHeight = 0;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const imageWidth = header.width;
        const imageHeight = header.height;
        const wouldExceedWidth = maxWidth && (currentRowWidth + imageWidth > maxWidth);
        const wouldExceedColumns = fixedColumns && (currentRow.length >= fixedColumns);
        if ((wouldExceedWidth || wouldExceedColumns) && currentRow.length > 0) {
            // Need to start a new row - check if it would exceed height limit
            const newRowHeight = imageHeight;
            const wouldExceedHeight = maxHeight && (totalHeight + currentRowMaxHeight + newRowHeight > maxHeight);
            if (wouldExceedHeight) {
                // Can't fit this image - stop here
                break;
            }
            grid.push(currentRow);
            totalHeight += currentRowMaxHeight;
            currentRow = [i];
            currentRowWidth = imageWidth;
            currentRowMaxHeight = imageHeight;
        }
        else {
            currentRow.push(i);
            currentRowWidth += imageWidth;
            currentRowMaxHeight = Math.max(currentRowMaxHeight, imageHeight);
        }
        if (fixedRows && grid.length >= fixedRows && currentRow.length === 0) {
            break;
        }
    }
    if (currentRow.length > 0) {
        grid.push(currentRow);
    }
    return grid;
}
/**
 * Streaming PNG concatenation with minimal memory usage
 *
 * This implementation:
 * 1. Pass 1: Reads only headers to validate and plan
 * 2. Pass 2: Processes scanline-by-scanline, streaming output
 *
 * Memory usage: O(rows_in_flight * row_width) instead of O(total_image_size)
 *
 * Supports:
 * - File paths (string)
 * - Uint8Array buffers
 * - ArrayBuffer instances (browser-friendly)
 * - Custom PngInputAdapter implementations
 * - Mixed input types in the same operation
 */
class StreamingConcatenator {
    options;
    constructor(options) {
        this.validateOptions(options);
        this.options = options;
    }
    validateOptions(options) {
        if (!options.inputs || options.inputs.length === 0) {
            throw new Error('At least one input image is required');
        }
        const { layout } = options;
        if (!layout.columns && !layout.rows && !layout.width && !layout.height) {
            throw new Error('Must specify layout: columns, rows, width, or height');
        }
    }
    /**
     * Stream compressed scanline data with TRUE streaming compression
     *
     * Uses pako's onData callback for true constant-memory streaming:
     * - Generates scanlines incrementally
     * - Batches scanlines (max 10MB) before flush
     * - Compresses with Z_SYNC_FLUSH (maintains deflate state)
     * - Yields IDAT chunks immediately via onData callback
     * - Memory usage: O(batch_size) ~10-20MB regardless of total image size!
     */
    async *streamCompressedData(grid, rowHeights, colWidths, totalWidth, headers, iterators, outputHeader, bytesPerPixel, transparentColor) {
        const { StreamingDeflator } = await import('./streaming-deflate.js');
        // Create scanline generator
        const scanlineGenerator = this.generateFilteredScanlines(grid, rowHeights, colWidths, totalWidth, headers, iterators, outputHeader, bytesPerPixel, transparentColor);
        // Calculate batch size
        const scanlineSize = totalWidth * bytesPerPixel + 1;
        const MAX_BATCH_BYTES = 1 * 1024 * 1024; // 1MB
        const MAX_BATCH_SCANLINES = Math.max(50, Math.floor(MAX_BATCH_BYTES / scanlineSize));
        // Create deflator
        const deflator = new StreamingDeflator({
            level: 6,
            maxBatchSize: MAX_BATCH_BYTES
        });
        // Queue for compressed chunks from onData callback
        const compressedChunks = [];
        // Initialize deflator with callback
        deflator.initialize((compressedData) => {
            // onData callback - receives compressed chunks immediately!
            if (compressedData && compressedData.length > 0) {
                compressedChunks.push(compressedData);
            }
        });
        let scanlineCount = 0;
        // Process scanlines
        for await (const scanline of scanlineGenerator) {
            deflator.push(scanline);
            scanlineCount++;
            // Periodic flush for progressive output
            if (scanlineCount % MAX_BATCH_SCANLINES === 0) {
                deflator.flush();
            }
            // Yield any compressed chunks that were produced
            while (compressedChunks.length > 0) {
                const chunk = compressedChunks.shift();
                yield serializeChunk(createChunk('IDAT', chunk));
            }
        }
        // Finish compression
        deflator.finish();
        // Yield remaining compressed chunks
        while (compressedChunks.length > 0) {
            const chunk = compressedChunks.shift();
            yield serializeChunk(createChunk('IDAT', chunk));
        }
    }
    /**
     * Generate filtered scanlines one at a time
     */
    async *generateFilteredScanlines(grid, rowHeights, colWidths, totalWidth, headers, iterators, outputHeader, bytesPerPixel, transparentColor) {
        let previousOutputScanline = null;
        // Process each output scanline
        for (let row = 0; row < grid.length; row++) {
            const rowHeight = rowHeights[row];
            const rowColWidths = colWidths[row];
            // Process each scanline in this row
            for (let localY = 0; localY < rowHeight; localY++) {
                const scanlines = [];
                // Collect scanlines from all images in this row
                for (let col = 0; col < grid[row].length; col++) {
                    const imageIdx = grid[row][col];
                    const colWidth = rowColWidths[col];
                    if (imageIdx >= 0) {
                        const imageHeader = headers[imageIdx];
                        const imageHeight = imageHeader.height;
                        const imageWidth = imageHeader.width;
                        if (localY < imageHeight) {
                            // Read scanline from this image
                            const { value, done } = await iterators[imageIdx].next();
                            if (!done) {
                                // Convert scanline to target format if needed
                                const convertedScanline = convertScanline(value, imageWidth, imageHeader.bitDepth, imageHeader.colorType, outputHeader.bitDepth, outputHeader.colorType);
                                // Pad scanline if image is narrower than column
                                const paddedScanline = padScanline(convertedScanline, imageWidth, colWidth, bytesPerPixel, transparentColor);
                                scanlines.push(paddedScanline);
                            }
                            else {
                                // Shouldn't happen, but handle gracefully
                                scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
                            }
                        }
                        else {
                            // Below image - use transparent scanline
                            scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
                        }
                    }
                    else {
                        // Empty cell - use transparent scanline
                        scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
                    }
                }
                // Combine scanlines horizontally
                let outputScanline = combineScanlines(scanlines, rowColWidths, bytesPerPixel);
                // Pad scanline to totalWidth if this row is narrower
                const rowWidth = rowColWidths.reduce((sum, w) => sum + w, 0);
                if (rowWidth < totalWidth) {
                    const paddedScanline = new Uint8Array(totalWidth * bytesPerPixel);
                    paddedScanline.set(outputScanline, 0);
                    // Fill the rest with transparent pixels
                    for (let x = rowWidth; x < totalWidth; x++) {
                        paddedScanline.set(transparentColor, x * bytesPerPixel);
                    }
                    outputScanline = paddedScanline;
                }
                // Filter the scanline
                const { filterType, filtered } = filterScanline(outputScanline, previousOutputScanline, bytesPerPixel);
                // Create scanline with filter byte
                const scanlineWithFilter = new Uint8Array(1 + filtered.length);
                scanlineWithFilter[0] = filterType;
                scanlineWithFilter.set(filtered, 1);
                // Yield this scanline - only one at a time!
                yield scanlineWithFilter;
                previousOutputScanline = outputScanline;
            }
        }
    }
    /**
     * Stream concatenated PNG output scanline-by-scanline
     */
    async *stream() {
        // PASS 1: Create adapters and read headers
        const adapters = await createInputAdapters(this.options.inputs);
        const headers = [];
        try {
            for (const adapter of adapters) {
                const header = await adapter.getHeader();
                headers.push(header);
            }
            // Determine common format that can represent all images
            const { bitDepth: targetBitDepth, colorType: targetColorType } = determineCommonFormat(headers);
            // Calculate layout with variable image sizes
            const layout = calculateLayout(headers, this.options);
            const { grid, rowHeights, colWidths, totalWidth, totalHeight } = layout;
            // Create output header using common format
            const outputHeader = {
                width: totalWidth,
                height: totalHeight,
                bitDepth: targetBitDepth,
                colorType: targetColorType,
                compressionMethod: 0,
                filterMethod: 0,
                interlaceMethod: 0
            };
            // Yield PNG signature
            yield PNG_SIGNATURE;
            // Yield IHDR
            yield serializeChunk(createIHDR(outputHeader));
            // PASS 2: Stream scanlines with true streaming compression
            // Create iterators for each input
            const iterators = adapters.map(adapter => adapter.scanlines());
            const bytesPerPixel = getBytesPerPixel(outputHeader.bitDepth, outputHeader.colorType);
            const transparentColor = getTransparentColor(outputHeader.colorType, outputHeader.bitDepth);
            // Use streaming compression - process scanlines one at a time
            yield* this.streamCompressedData(grid, rowHeights, colWidths, totalWidth, headers, iterators, outputHeader, bytesPerPixel, transparentColor);
            // Yield IEND
            yield serializeChunk(createIEND());
        }
        finally {
            // Clean up all adapters
            for (const adapter of adapters) {
                await adapter.close();
            }
        }
    }
    /**
     * Convert to Node.js Readable stream
     */
    toReadableStream() {
        const generator = this.stream();
        return new Readable({
            async read() {
                try {
                    const { value, done } = await generator.next();
                    if (done) {
                        this.push(null);
                    }
                    else {
                        this.push(Buffer.from(value));
                    }
                }
                catch (error) {
                    this.destroy(error);
                }
            }
        });
    }
}
/**
 * Concatenate PNGs with streaming (minimal memory usage)
 *
 * This processes images scanline-by-scanline, keeping only a few rows
 * in memory at a time. Ideal for large images.
 *
 * Supports:
 * - File paths (string)
 * - Uint8Array buffers
 * - Mixed input types
 * - Variable image dimensions with automatic padding
 * - All layout options (columns, rows, width, height)
 */
async function* concatPngsStreaming(options) {
    const concatenator = new StreamingConcatenator(options);
    yield* concatenator.stream();
}
/**
 * Get a Readable stream for streaming concatenation
 */
function concatPngsToStream(options) {
    const concatenator = new StreamingConcatenator(options);
    return concatenator.toReadableStream();
}
function concatPngs(options) {
    return (async () => {
        if (options.stream) {
            // User wants streaming output
            return concatPngsToStream(options);
        }
        else {
            // User wants Uint8Array result - collect chunks from stream
            const chunks = [];
            for await (const chunk of concatPngsStreaming(options)) {
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
async function concatPngsToFile(options) {
    return concatPngs({ ...options, stream: true });
}

// ===== dist/esm/png-decompress.js =====


/**
 * Decompress data using Web Compression Streams API
 * Works in both Node.js (18+) and modern browsers
 */
async function decompressData(data) {
    const stream = new Blob([data]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate'));
    const chunks = [];
    const reader = decompressedStream.getReader();
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
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
async function compressData(data) {
    const stream = new Blob([data]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('deflate'));
    const chunks = [];
    const reader = compressedStream.getReader();
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
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
async function decompressImageData(idatChunks, header) {
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
async function compressImageData(pixelData, header) {
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
    // Compress using Web Compression Streams API
    const compressed = await compressData(filteredData);
    return compressed;
}
/**
 * Extract pixel data from a PNG file
 */
async function extractPixelData(chunks, header) {
    const idatChunks = chunks.filter(chunk => chunk.type === 'IDAT');
    if (idatChunks.length === 0) {
        throw new Error('No IDAT chunks found in PNG');
    }
    return await decompressImageData(idatChunks, header);
}

// ===== dist/esm/types.js =====
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

export { concatPngs, concatPngsToFile, StreamingConcatenator };
export { FileInputAdapter, Uint8ArrayInputAdapter, createInputAdapter, createInputAdapters };
export { parsePngHeader, parsePngChunks, PngParser };
export { createChunk, createIHDR, createIEND, serializeChunk, buildPng };
export { decompressImageData, compressImageData, extractPixelData, decompressData };
export { unfilterScanline, filterScanline, getBytesPerPixel, FilterType };
export { copyPixelRegion, fillPixelRegion, createBlankImage };
export { crc32Internal as crc32, readUInt32BE, writeUInt32BE, isPngSignature, PNG_SIGNATURE };
export { ColorType };

//# sourceMappingURL=image-stitch.esm.js.map
