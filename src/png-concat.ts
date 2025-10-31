/**
 * PNG Concatenation
 *
 * Scanline-by-scanline streaming approach that minimizes memory usage.
 * Processes one output row at a time using the adapter architecture.
 */

import { Readable } from 'node:stream';
import { ConcatOptions, PngHeader } from './types.js';
import { PNG_SIGNATURE } from './utils.js';
import { filterScanline, getBytesPerPixel } from './png-filter.js';
import { createIHDR, createIEND, serializeChunk, createChunk } from './png-writer.js';
import { createInputAdapters } from './png-input-adapter.js';
import { determineCommonFormat, convertScanline, getTransparentColor } from './pixel-ops.js';

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
export class StreamingConcatenator {
  private options: ConcatOptions;

  constructor(options: ConcatOptions) {
    this.validateOptions(options);
    this.options = options;
  }

  private validateOptions(options: ConcatOptions): void {
    if (
      !options.inputs ||
      (Array.isArray(options.inputs) && options.inputs.length === 0)
    ) {
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
  private async *streamCompressedData(
    grid: number[][],
    rowHeights: number[],
    colWidths: number[][],
    totalWidth: number,
    headers: PngHeader[],
    iterators: AsyncGenerator<Uint8Array>[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array
  ): AsyncGenerator<Uint8Array> {
    const { StreamingDeflator } = await import('./streaming-deflate.js');

    // Create scanline generator
    const scanlineGenerator = this.generateFilteredScanlines(
      grid,
      rowHeights,
      colWidths,
      totalWidth,
      headers,
      iterators,
      outputHeader,
      bytesPerPixel,
      transparentColor
    );

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
    const compressedChunks: Uint8Array[] = [];

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
        const chunk = compressedChunks.shift()!;
        yield serializeChunk(createChunk('IDAT', chunk));
      }
    }

    // Finish compression
    deflator.finish();

    // Yield remaining compressed chunks
    while (compressedChunks.length > 0) {
      const chunk = compressedChunks.shift()!;
      yield serializeChunk(createChunk('IDAT', chunk));
    }
  }

  /**
   * Generate filtered scanlines one at a time
   */
  private async *generateFilteredScanlines(
    grid: number[][],
    rowHeights: number[],
    colWidths: number[][],
    totalWidth: number,
    headers: PngHeader[],
    iterators: AsyncGenerator<Uint8Array>[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array
  ): AsyncGenerator<Uint8Array> {
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
                // Convert scanline to target format if needed
                const convertedScanline = convertScanline(
                  value,
                  imageWidth,
                  imageHeader.bitDepth,
                  imageHeader.colorType,
                  outputHeader.bitDepth,
                  outputHeader.colorType
                );

                // Pad scanline if image is narrower than column
                const paddedScanline = padScanline(
                  convertedScanline,
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
        const { filterType, filtered } = filterScanline(
          outputScanline,
          previousOutputScanline,
          bytesPerPixel
        );

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
  async *stream(): AsyncGenerator<Uint8Array> {
    // PASS 1: Create adapters and read headers
    const adapters = await createInputAdapters(this.options.inputs);
    if (adapters.length === 0) {
      throw new Error('At least one input image is required');
    }
    const headers: PngHeader[] = [];

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
      const outputHeader: PngHeader = {
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
      yield* this.streamCompressedData(
        grid,
        rowHeights,
        colWidths,
        totalWidth,
        headers,
        iterators,
        outputHeader,
        bytesPerPixel,
        transparentColor
      );

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
export async function* concatPngsStreaming(
  options: ConcatOptions
): AsyncGenerator<Uint8Array> {
  const concatenator = new StreamingConcatenator(options);
  yield* concatenator.stream();
}

/**
 * Get a Readable stream for streaming concatenation
 */
export function concatPngsToStream(options: ConcatOptions): Readable {
  const concatenator = new StreamingConcatenator(options);
  return concatenator.toReadableStream();
}

/**
 * Extended options with output format hint
 */
export interface UnifiedConcatOptions extends ConcatOptions {
  /**
   * Return a stream instead of Uint8Array
   * Useful for HTTP responses or piping to files
   */
  stream?: boolean;
}

/**
 * Unified PNG concatenation function using streaming
 *
 * This function uses a streaming implementation which:
 * - Processes images scanline-by-scanline
 * - Minimizes memory usage
 * - Supports both file paths and Uint8Array inputs
 * - Handles variable image dimensions with automatic padding
 *
 * @example
 * // Simple usage - returns Uint8Array
 * const result = await concatPngs({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 }
 * });
 *
 * @example
 * // Stream output for HTTP responses or large files
 * const stream = await concatPngs({
 *   inputs: ['img1.png', 'img2.png'],
 *   layout: { columns: 2 },
 *   stream: true
 * });
 * stream.pipe(res);
 *
 * @example
 * // Mix file paths, Uint8Arrays, and ArrayBuffers
 * const result = await concatPngs({
 *   inputs: ['img1.png', pngBuffer, anotherArrayBuffer],
 *   layout: { rows: 2 }
 * });
 */
export function concatPngs(options: UnifiedConcatOptions & { stream: true }): Promise<Readable>;
export function concatPngs(options: UnifiedConcatOptions): Promise<Uint8Array>;
export function concatPngs(options: UnifiedConcatOptions): Promise<Uint8Array | Readable> {
  return (async () => {
    if (options.stream) {
      // User wants streaming output
      return concatPngsToStream(options);
    } else {
      // User wants Uint8Array result - collect chunks from stream
      // Memory optimization: collect chunks, then copy and clear incrementally
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      for await (const chunk of concatPngsStreaming(options)) {
        chunks.push(chunk);
        totalLength += chunk.length;
      }

      // Combine chunks while releasing memory incrementally
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        result.set(chunk, offset);
        offset += chunk.length;
        // Release chunk reference immediately to allow GC
        chunks[i] = null as any;
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
export async function concatPngsToFile(options: ConcatOptions): Promise<Readable> {
  return concatPngs({ ...options, stream: true }) as Promise<Readable>;
}
