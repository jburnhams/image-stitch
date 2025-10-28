/**
 * True Streaming PNG Concatenation
 *
 * Scanline-by-scanline streaming approach that minimizes memory usage.
 * Processes one output row at a time using the adapter architecture.
 */

import { createDeflate } from 'node:zlib';
import { Readable } from 'node:stream';
import { ConcatOptions, PngHeader } from './types.js';
import { PNG_SIGNATURE } from './utils.js';
import { filterScanline, getBytesPerPixel } from './png-filter.js';
import { createIHDR, createIEND, serializeChunk, createChunk } from './png-writer.js';
import { PngInput, createInputAdapters } from './png-input-adapter.js';

/**
 * Combines multiple scanlines horizontally into one output scanline with variable widths
 */
function combineScanlines(
  scanlines: Uint8Array[],
  widths: number[],
  bytesPerPixel: number
): Uint8Array {
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
 * Get transparent color for padding
 */
function getTransparentColor(colorType: number, bitDepth: number): Uint8Array {
  const bytesPerSample = bitDepth === 16 ? 2 : 1;

  switch (colorType) {
    case 0: return new Uint8Array(bytesPerSample).fill(0);
    case 2: return new Uint8Array(3 * bytesPerSample).fill(0);
    case 4:
      return bitDepth === 16 ? new Uint8Array([0, 0, 0, 0]) : new Uint8Array([0, 0]);
    case 6:
      return bitDepth === 16 ? new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]) : new Uint8Array([0, 0, 0, 0]);
    default:
      throw new Error(`Unsupported color type: ${colorType}`);
  }
}

/**
 * Create a transparent scanline of given width
 */
function createTransparentScanline(width: number, bytesPerPixel: number, transparentColor: Uint8Array): Uint8Array {
  const scanline = new Uint8Array(width * bytesPerPixel);
  for (let i = 0; i < width; i++) {
    scanline.set(transparentColor, i * bytesPerPixel);
  }
  return scanline;
}

/**
 * Pad a scanline to a target width with transparent pixels
 */
function padScanline(
  scanline: Uint8Array,
  currentWidth: number,
  targetWidth: number,
  bytesPerPixel: number,
  transparentColor: Uint8Array
): Uint8Array {
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
function calculateLayout(
  headers: PngHeader[],
  options: ConcatOptions
): {
  grid: number[][];
  rowHeights: number[];
  colWidths: number[][];
  totalWidth: number;
  totalHeight: number;
} {
  const { layout } = options;
  const numImages = headers.length;

  let grid: number[][] = [];

  if (layout.columns && !layout.height) {
    const columns = layout.columns;
    const rows = Math.ceil(numImages / columns);
    grid = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, col) => {
        const idx = row * columns + col;
        return idx < numImages ? idx : -1;
      })
    );
  } else if (layout.rows && !layout.width) {
    const rows = layout.rows;
    const columns = Math.ceil(numImages / rows);
    grid = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, col) => {
        const idx = col * rows + row;
        return idx < numImages ? idx : -1;
      })
    );
  } else if (layout.width || layout.height) {
    grid = calculatePixelBasedLayout(
      headers,
      layout.width,
      layout.height,
      layout.columns,
      layout.rows
    );
  } else {
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

  const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const totalWidth = Math.max(...colWidths.map(row => row.reduce((sum, w) => sum + w, 0)));

  return { grid, rowHeights, colWidths, totalWidth, totalHeight };
}

/**
 * Calculate layout when pixel-based width/height limits are specified
 */
function calculatePixelBasedLayout(
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
    } else {
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
 * True streaming PNG concatenation with minimal memory usage
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
 * - Custom PngInputAdapter implementations
 * - Mixed input types in the same operation
 */
export class TrueStreamingConcatenator {
  private options: ConcatOptions;

  constructor(options: ConcatOptions) {
    this.validateOptions(options);
    this.options = options;
  }

  private validateOptions(options: ConcatOptions): void {
    if (!options.inputs || options.inputs.length === 0) {
      throw new Error('At least one input image is required');
    }

    const { layout } = options;
    if (!layout.columns && !layout.rows && !layout.width && !layout.height) {
      throw new Error('Must specify layout: columns, rows, width, or height');
    }
  }

  /**
   * Stream concatenated PNG output scanline-by-scanline
   */
  async *stream(): AsyncGenerator<Uint8Array> {
    // PASS 1: Create adapters and read headers
    const adapters = await createInputAdapters(this.options.inputs as PngInput[]);
    const headers: PngHeader[] = [];

    try {
      for (const adapter of adapters) {
        const header = await adapter.getHeader();
        headers.push(header);
      }

      // Validate all images have compatible format
      const firstHeader = headers[0];
      for (let i = 1; i < headers.length; i++) {
        if (headers[i].bitDepth !== firstHeader.bitDepth ||
            headers[i].colorType !== firstHeader.colorType) {
          throw new Error('All images must have same bit depth and color type');
        }
      }

      // Calculate layout with variable image sizes
      const layout = calculateLayout(headers, this.options);
      const { grid, rowHeights, colWidths, totalWidth, totalHeight } = layout;

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

      // Yield PNG signature
      yield PNG_SIGNATURE;

      // Yield IHDR
      yield serializeChunk(createIHDR(outputHeader));

      // PASS 2: Stream scanlines
      // Create iterators for each input
      const iterators = adapters.map(adapter => adapter.scanlines());
      const bytesPerPixel = getBytesPerPixel(firstHeader.bitDepth, firstHeader.colorType);
      const transparentColor = getTransparentColor(firstHeader.colorType, firstHeader.bitDepth);

      // Set up streaming compression
      const compressedChunks: Buffer[] = [];
      const deflate = createDeflate({ level: 9 });

      deflate.on('data', (chunk: Buffer) => {
        compressedChunks.push(chunk);
      });

      let previousOutputScanline: Uint8Array | null = null;

      // Process each output scanline
      for (let row = 0; row < grid.length; row++) {
        const rowHeight = rowHeights[row];
        const rowColWidths = colWidths[row];

        // Process each scanline in this row
        for (let localY = 0; localY < rowHeight; localY++) {
          const scanlines: Uint8Array[] = [];

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
                  // Pad scanline if image is narrower than column
                  const paddedScanline = padScanline(
                    value,
                    imageWidth,
                    colWidth,
                    bytesPerPixel,
                    transparentColor
                  );
                  scanlines.push(paddedScanline);
                } else {
                  // Shouldn't happen, but handle gracefully
                  scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
                }
              } else {
                // Below image - use transparent scanline
                scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
              }
            } else {
              // Empty cell - use transparent scanline
              scanlines.push(createTransparentScanline(colWidth, bytesPerPixel, transparentColor));
            }
          }

          // Combine scanlines horizontally
          const outputScanline = combineScanlines(scanlines, rowColWidths, bytesPerPixel);

          // Filter the scanline
          const { filterType, filtered } = filterScanline(
            outputScanline,
            previousOutputScanline,
            bytesPerPixel
          );

          // Write filter type + filtered data to compressor
          const scanlineWithFilter = new Uint8Array(1 + filtered.length);
          scanlineWithFilter[0] = filterType;
          scanlineWithFilter.set(filtered, 1);

          deflate.write(Buffer.from(scanlineWithFilter));

          previousOutputScanline = outputScanline;

          // Yield any compressed chunks that are ready
          while (compressedChunks.length > 0) {
            const chunk = compressedChunks.shift()!;
            yield serializeChunk(createChunk('IDAT', new Uint8Array(chunk)));
          }
        }
      }

      // Finish compression
      deflate.end();

      // Wait for final compressed data
      await new Promise<void>((resolve) => {
        deflate.on('end', () => resolve());
      });

      // Yield any remaining compressed chunks
      while (compressedChunks.length > 0) {
        const chunk = compressedChunks.shift()!;
        yield serializeChunk(createChunk('IDAT', new Uint8Array(chunk)));
      }

      // Yield IEND
      yield serializeChunk(createIEND());
    } finally {
      // Clean up all adapters
      for (const adapter of adapters) {
        await adapter.close();
      }
    }
  }

  /**
   * Convert to Node.js Readable stream
   */
  toReadableStream(): Readable {
    const generator = this.stream();

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
 * Concatenate PNGs with true streaming (minimal memory usage)
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
export async function* concatPngs(
  options: ConcatOptions
): AsyncGenerator<Uint8Array> {
  const concatenator = new TrueStreamingConcatenator(options);
  yield* concatenator.stream();
}

/**
 * Get a Readable stream for true streaming concatenation
 */
export function concatPngsToStream(options: ConcatOptions): Readable {
  const concatenator = new TrueStreamingConcatenator(options);
  return concatenator.toReadableStream();
}
