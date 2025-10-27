import { readFileSync } from 'node:fs';
import { ConcatOptions, PngHeader } from './types.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { extractPixelData, compressImageData } from './png-decompress.js';
import { copyPixelRegion, createBlankImage } from './pixel-ops.js';

/**
 * PNG Concatenation Engine
 *
 * This class handles the concatenation of multiple PNG images.
 */
export class PngConcatenator {
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
   * Concatenate PNG images
   */
  async concat(): Promise<Uint8Array> {
    // Load all input images
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

    // Create blank output image
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

    // Compress output pixels
    const compressedData = compressImageData(outputPixels, outputHeader);

    // Build output PNG
    const ihdrChunk = createIHDR(outputHeader);
    const idatChunk = createChunk('IDAT', compressedData);
    const iendChunk = createIEND();

    return buildPng([ihdrChunk, idatChunk, iendChunk]);
  }
}

/**
 * Concatenate PNG images according to options
 */
export async function concatPngs(options: ConcatOptions): Promise<Uint8Array> {
  const concatenator = new PngConcatenator(options);
  return concatenator.concat();
}
