import { readFileSync } from 'node:fs';
import { ConcatOptions, PngHeader } from './types.js';
import { parsePngHeader, parsePngChunks } from './png-parser.js';
import { createIHDR, createIEND, createChunk, buildPng } from './png-writer.js';
import { extractPixelData, compressImageData } from './png-decompress.js';
import { copyPixelRegion, createBlankImage, getTransparentColor, fillPixelRegion } from './pixel-ops.js';

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
   * Calculate grid layout with support for pixel-based limits and variable image sizes
   * Returns the layout grid with image placements
   */
  private calculateLayout(headers: PngHeader[]): {
    grid: number[][]; // grid[row][col] = image index (-1 for empty)
    rowHeights: number[]; // height of each row
    colWidths: number[][]; // width of each column per row (can vary per row)
    totalWidth: number;
    totalHeight: number;
  } {
    const { layout } = this.options;
    const numImages = headers.length;

    // Determine layout strategy
    let grid: number[][] = [];

    if (layout.columns && !layout.height) {
      // Fixed column count - pack images into rows (unless height limit specified)
      const columns = layout.columns;
      const rows = Math.ceil(numImages / columns);
      grid = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          const idx = row * columns + col;
          return idx < numImages ? idx : -1;
        })
      );
    } else if (layout.rows && !layout.width) {
      // Fixed row count - pack images into columns
      const rows = layout.rows;
      const columns = Math.ceil(numImages / rows);
      grid = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          const idx = col * rows + row;
          return idx < numImages ? idx : -1;
        })
      );
    } else if (layout.width || layout.height) {
      // Pixel-based layout - pack images respecting pixel limits and column/row constraints
      grid = this.calculatePixelBasedLayout(
        headers,
        layout.width,
        layout.height,
        layout.columns,
        layout.rows
      );
    } else {
      // Default: horizontal layout (all in one row)
      grid = [Array.from({ length: numImages }, (_, i) => i)];
    }

    // Calculate max width per column in each row and max height per row
    const rowHeights: number[] = [];
    const colWidths: number[][] = [];

    for (let row = 0; row < grid.length; row++) {
      let maxHeight = 0;
      const rowColWidths: number[] = [];

      for (let col = 0; col < grid[row].length; col++) {
        const imageIdx = grid[row][col];
        if (imageIdx >= 0) {
          const header = headers[imageIdx];
          maxHeight = Math.max(maxHeight, header.height);
          rowColWidths[col] = Math.max(rowColWidths[col] || 0, header.width);
        } else {
          rowColWidths[col] = rowColWidths[col] || 0;
        }
      }

      rowHeights.push(maxHeight);
      colWidths.push(rowColWidths);
    }

    // Calculate total dimensions
    const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);
    const totalWidth = Math.max(...colWidths.map(row => row.reduce((sum, w) => sum + w, 0)));

    return { grid, rowHeights, colWidths, totalWidth, totalHeight };
  }

  /**
   * Calculate layout when pixel-based width/height limits are specified
   */
  private calculatePixelBasedLayout(
    headers: PngHeader[],
    maxWidth?: number,
    maxHeight?: number,
    fixedColumns?: number,
    fixedRows?: number
  ): number[][] {
    const grid: number[][] = [];
    let currentRow: number[] = [];
    let currentRowWidth = 0;
    let currentRowMaxHeight = 0;
    let totalHeight = 0;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const imageWidth = header.width;
      const imageHeight = header.height;

      // Check if adding this image would exceed width limit or column count
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

        // Start new row due to width or column constraint
        grid.push(currentRow);
        totalHeight += currentRowMaxHeight;
        currentRow = [i];
        currentRowWidth = imageWidth;
        currentRowMaxHeight = imageHeight;
      } else {
        // Add to current row
        currentRow.push(i);
        currentRowWidth += imageWidth;
        currentRowMaxHeight = Math.max(currentRowMaxHeight, imageHeight);
      }

      // If we have a fixed row count and filled it, stop
      if (fixedRows && grid.length >= fixedRows && currentRow.length === 0) {
        break;
      }
    }

    // Add final row if not empty
    if (currentRow.length > 0) {
      grid.push(currentRow);
    }

    return grid;
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
   * Concatenate PNG images with support for arbitrary sizes
   */
  async concat(): Promise<Uint8Array> {
    // Load all input images
    const inputData = this.loadInputData();

    // Parse headers and validate formats are compatible
    const headers = inputData.map(data => parsePngHeader(data));
    const firstHeader = headers[0];

    // Validate that all images have compatible bit depth and color type
    for (let i = 1; i < headers.length; i++) {
      if (headers[i].bitDepth !== firstHeader.bitDepth ||
          headers[i].colorType !== firstHeader.colorType) {
        throw new Error('All input images must have the same bit depth and color type');
      }
    }

    // Calculate grid layout with variable image sizes
    const { grid, rowHeights, colWidths, totalWidth, totalHeight } = this.calculateLayout(headers);

    // Create output header
    const outputHeader: PngHeader = {
      width: totalWidth,
      height: totalHeight,
      bitDepth: firstHeader.bitDepth,
      colorType: firstHeader.colorType,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Create blank output image with transparent background
    const transparentColor = getTransparentColor(outputHeader.colorType, outputHeader.bitDepth);
    const outputPixels = createBlankImage(outputHeader, transparentColor);

    // Extract and copy pixels from each input image
    for (let row = 0; row < grid.length; row++) {
      // Calculate Y position for this row
      const dstY = rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0);
      const rowHeight = rowHeights[row];

      let dstX = 0;
      for (let col = 0; col < grid[row].length; col++) {
        const imageIdx = grid[row][col];
        const colWidth = colWidths[row][col];

        if (imageIdx >= 0) {
          const chunks = parsePngChunks(inputData[imageIdx]);
          const inputPixels = extractPixelData(chunks, headers[imageIdx]);
          const imageWidth = headers[imageIdx].width;
          const imageHeight = headers[imageIdx].height;

          // Copy pixels to output (image is placed at top-left of its cell)
          copyPixelRegion(
            inputPixels,
            headers[imageIdx],
            outputPixels,
            outputHeader,
            0, 0,           // source position
            dstX, dstY,     // destination position
            imageWidth,
            imageHeight
          );

          // Fill padding area to the right if image is narrower than column
          if (imageWidth < colWidth) {
            fillPixelRegion(
              outputPixels,
              outputHeader,
              dstX + imageWidth,
              dstY,
              colWidth - imageWidth,
              imageHeight,
              transparentColor
            );
          }

          // Fill padding area below if image is shorter than row
          if (imageHeight < rowHeight) {
            fillPixelRegion(
              outputPixels,
              outputHeader,
              dstX,
              dstY + imageHeight,
              colWidth,
              rowHeight - imageHeight,
              transparentColor
            );
          }
        } else {
          // Empty cell - fill with transparent
          fillPixelRegion(
            outputPixels,
            outputHeader,
            dstX,
            dstY,
            colWidth,
            rowHeight,
            transparentColor
          );
        }

        dstX += colWidth;
      }
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
