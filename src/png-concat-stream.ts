import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ConcatOptions, PngHeader } from './types.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { createIHDR, createIEND, serializeChunk } from './png-writer.js';
import { extractPixelData, compressImageData } from './png-decompress.js';
import { copyPixelRegion, createBlankImage } from './pixel-ops.js';
import { PNG_SIGNATURE } from './utils.js';

/**
 * Streaming PNG Concatenation Engine
 *
 * Yields PNG chunks as they are generated, allowing for streaming output
 * without loading the entire result into memory.
 */
export class PngConcatenatorStream {
  private options: ConcatOptions;

  constructor(options: ConcatOptions) {
    this.options = options;
    this.validateOptions();
  }

  private validateOptions(): void {
    if (!this.options.inputs || this.options.inputs.length === 0) {
      throw new Error('At least one input image is required');
    }

    const { layout } = this.options;
    if (!layout.columns && !layout.rows && !layout.width && !layout.height) {
      throw new Error('Must specify layout: columns/rows or width/height');
    }
  }

  /**
   * Calculate grid layout (columns and rows)
   */
  private calculateLayout(numImages: number, imageWidth: number, imageHeight: number): {
    columns: number;
    rows: number;
  } {
    const { layout } = this.options;

    if (layout.columns) {
      return {
        columns: layout.columns,
        rows: Math.ceil(numImages / layout.columns)
      };
    }

    if (layout.rows) {
      return {
        columns: Math.ceil(numImages / layout.rows),
        rows: layout.rows
      };
    }

    if (layout.width && layout.height) {
      return {
        columns: Math.floor(layout.width / imageWidth),
        rows: Math.floor(layout.height / imageHeight)
      };
    }

    // Default: horizontal layout
    return { columns: numImages, rows: 1 };
  }

  /**
   * Load input data (handles both Uint8Array and file paths)
   */
  private loadInputData(): Uint8Array[] {
    return this.options.inputs.map(input => {
      if (typeof input === 'string') {
        // Load from file path (Node.js only)
        return readFileSync(input);
      } else {
        return input;
      }
    });
  }

  /**
   * Stream PNG chunks as they are generated
   *
   * This async generator yields PNG file chunks without building
   * the entire file in memory first.
   */
  async *concatStream(): AsyncGenerator<Uint8Array, void, undefined> {
    // Load all input images (NOTE: inputs still need to be in memory)
    const inputData = this.loadInputData();

    // Parse headers and validate
    const headers = inputData.map(data => parsePngHeader(data));
    const firstHeader = headers[0];

    // Validate that all images have compatible formats
    for (let i = 1; i < headers.length; i++) {
      if (headers[i].bitDepth !== firstHeader.bitDepth ||
          headers[i].colorType !== firstHeader.colorType) {
        throw new Error('All input images must have the same bit depth and color type');
      }
      if (headers[i].width !== firstHeader.width ||
          headers[i].height !== firstHeader.height) {
        throw new Error('All input images must have the same dimensions');
      }
    }

    // Calculate grid layout
    const imageWidth = firstHeader.width;
    const imageHeight = firstHeader.height;
    const { columns, rows } = this.calculateLayout(inputData.length, imageWidth, imageHeight);

    // Create output header
    const outputHeader: PngHeader = {
      width: columns * imageWidth,
      height: rows * imageHeight,
      bitDepth: firstHeader.bitDepth,
      colorType: firstHeader.colorType,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Yield PNG signature
    yield PNG_SIGNATURE;

    // Yield IHDR chunk
    const ihdrChunk = createIHDR(outputHeader);
    yield serializeChunk(ihdrChunk);

    // Process image data
    // NOTE: Currently we still need to build the full output in memory
    // to compress it. True streaming would require processing scanlines
    // one at a time with streaming compression.
    const outputPixels = createBlankImage(outputHeader);

    // Extract and copy pixels from each input image
    for (let i = 0; i < inputData.length; i++) {
      const chunks = parsePngChunks(inputData[i]);
      const inputPixels = extractPixelData(chunks, headers[i]);

      // Calculate position in grid
      const col = i % columns;
      const row = Math.floor(i / columns);
      const dstX = col * imageWidth;
      const dstY = row * imageHeight;

      // Copy pixels to output
      copyPixelRegion(
        inputPixels,
        headers[i],
        outputPixels,
        outputHeader,
        0, 0,           // source position
        dstX, dstY,     // destination position
        imageWidth,
        imageHeight
      );
    }

    // Compress and yield IDAT chunk
    const compressedData = compressImageData(outputPixels, outputHeader);

    // We could split IDAT into multiple chunks for better streaming
    // For now, yield as one chunk
    const { createChunk } = await import('./png-writer.js');
    const idatChunk = createChunk('IDAT', compressedData);
    yield serializeChunk(idatChunk);

    // Yield IEND chunk
    const iendChunk = createIEND();
    yield serializeChunk(iendChunk);
  }

  /**
   * Create a Node.js Readable stream from the chunk generator
   */
  toReadableStream(): Readable {
    const generator = this.concatStream();

    return new Readable({
      async read() {
        try {
          const { value, done } = await generator.next();
          if (done) {
            this.push(null);
          } else {
            this.push(Buffer.from(value));
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      }
    });
  }
}

/**
 * Concatenate PNG images and return an async generator that yields chunks
 *
 * This allows streaming the output without loading the entire result into memory.
 *
 * @example
 * ```typescript
 * import { createWriteStream } from 'fs';
 *
 * const stream = createWriteStream('output.png');
 * for await (const chunk of concatPngsStream(options)) {
 *   stream.write(chunk);
 * }
 * stream.end();
 * ```
 */
export async function* concatPngsStream(
  options: ConcatOptions
): AsyncGenerator<Uint8Array, void, undefined> {
  const concatenator = new PngConcatenatorStream(options);
  yield* concatenator.concatStream();
}

/**
 * Concatenate PNG images and return a Node.js Readable stream
 *
 * @example
 * ```typescript
 * import { createWriteStream } from 'fs';
 *
 * const readStream = concatPngsToStream(options);
 * const writeStream = createWriteStream('output.png');
 * readStream.pipe(writeStream);
 * ```
 */
export function concatPngsToStream(options: ConcatOptions): Readable {
  const concatenator = new PngConcatenatorStream(options);
  return concatenator.toReadableStream();
}
