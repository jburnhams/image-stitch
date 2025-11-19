/**
 * Image Concatenation (Multi-Format Support)
 *
 * Scanline-by-scanline streaming approach that minimizes memory usage.
 * Supports PNG, JPEG, and HEIC input formats with automatic format detection.
 * Processes one output row at a time using the decoder architecture.
 */

import { ConcatOptions, PngHeader } from './types.js';
import { PNG_SIGNATURE, getSamplesPerPixel } from './utils.js';
import { filterScanline, getBytesPerPixel } from './png-filter.js';
import { createIHDR, createIEND, serializeChunk, createChunk } from './png-writer.js';
import { createDecodersFromIterable, hasPositionedImages, extractPositions, validatePositionedInputs } from './decoders/decoder-factory.js';
import { getDefaultDecoderPlugins } from './decoders/plugin-registry.js';
import type { ImageHeader, ImageInput } from './decoders/types.js';
import { determineCommonFormat, convertScanline, getTransparentColor, compositeScanline, extractScanlinePortion } from './pixel-ops.js';
import { StreamingDeflator } from './streaming-deflate.js';
import { JpegEncoder } from './jpeg-encoder.js';
import { calculateCanvasSize, buildScanlineIndex, clipImagesToCanvas, type PositionedImageInfo, type ScanlineIndex, type ClippedImageInfo } from './positioned-layout.js';

function createStitchError(message: string, cause?: unknown): Error {
  const baseMessage = `Failed to stitch images: ${message}`;
  if (cause instanceof Error) {
    return new Error(baseMessage, { cause });
  }

  return new Error(baseMessage);
}

type ProgressCallback = (completed: number, total: number) => void;

interface ProgressTracker {
  callback: ProgressCallback;
  remainingScanlines: number[];
  completed: number;
  total: number;
}

function formatPixels(value: number): string {
  return Number.isInteger(value) ? `${value}px` : `${value.toFixed(2)}px`;
}

/**
 * Convert ImageHeader to PngHeader for internal PNG processing
 * Maps generic image headers to PNG-specific format
 */
function imageHeaderToPngHeader(header: ImageHeader): PngHeader {
  // Determine PNG color type from channel count
  let colorType: number;
  if (header.channels === 1) {
    colorType = 0; // Grayscale
  } else if (header.channels === 2) {
    colorType = 4; // Grayscale + Alpha
  } else if (header.channels === 3) {
    colorType = 2; // RGB
  } else if (header.channels === 4) {
    colorType = 6; // RGBA
  } else {
    throw new Error(`Unsupported channel count: ${header.channels}`);
  }

  return {
    width: header.width,
    height: header.height,
    bitDepth: header.bitDepth,
    colorType,
    compressionMethod: 0, // Deflate (standard)
    filterMethod: 0, // Adaptive filtering (standard)
    interlaceMethod: 0 // No interlacing (standard for output)
  };
}

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
class CoreStreamingConcatenator {
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

    // Note: layout validation deferred to stream() method since positioned mode
    // allows empty layout {} with auto-calculated canvas size
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
    transparentColor: Uint8Array,
    progress?: ProgressTracker
  ): AsyncGenerator<Uint8Array> {
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
      transparentColor,
      progress
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
    await deflator.initialize((compressedData) => {
      // onData callback - receives compressed chunks immediately!
      if (compressedData && compressedData.length > 0) {
        compressedChunks.push(compressedData);
      }
    });

    let scanlineCount = 0;

    // Process scanlines
    for await (const scanline of scanlineGenerator) {
      await deflator.push(scanline);
      scanlineCount++;

      // Periodic flush for progressive output
      if (scanlineCount % MAX_BATCH_SCANLINES === 0) {
        await deflator.flush();
      }

      // Yield any compressed chunks that were produced
      while (compressedChunks.length > 0) {
        const chunk = compressedChunks.shift()!;
        yield serializeChunk(createChunk('IDAT', chunk));
      }
    }

    // Finish compression
    await deflator.finish();

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
    transparentColor: Uint8Array,
    progress?: ProgressTracker
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
              const iterator = iterators[imageIdx];
              const { value, done } = await iterator.next();

              if (done || value === undefined) {
                const producedRows = localY;
                throw createStitchError(
                  `dimension mismatch for input #${imageIdx + 1} while assembling row ${row + 1}, column ${col + 1}. ` +
                    `Expected ${formatPixels(imageHeight)} tall image but decoder ended after ${formatPixels(producedRows)}.`
                );
              }

              const samplesPerPixel = getSamplesPerPixel(imageHeader.colorType);
              const expectedSourceLength = Math.ceil(
                (imageWidth * imageHeader.bitDepth * samplesPerPixel) / 8
              );

              if (value.length !== expectedSourceLength) {
                const bitsPerPixel = imageHeader.bitDepth * samplesPerPixel;
                const actualWidth = bitsPerPixel === 0 ? 0 : (value.length * 8) / bitsPerPixel;
                throw createStitchError(
                  `dimension mismatch for input #${imageIdx + 1} while assembling row ${row + 1}, column ${col + 1}. ` +
                    `Expected ${formatPixels(imageWidth)} wide scanline (${expectedSourceLength} raw bytes) but decoder produced ` +
                    `${formatPixels(actualWidth)} (${value.length} raw bytes).`
                );
              }

              let convertedScanline: Uint8Array;
              try {
                convertedScanline = convertScanline(
                  value,
                  imageWidth,
                  imageHeader.bitDepth,
                  imageHeader.colorType,
                  outputHeader.bitDepth,
                  outputHeader.colorType
                );
              } catch (error) {
                throw createStitchError(
                  `unable to normalize input #${imageIdx + 1} at row ${row + 1}, column ${col + 1}`,
                  error
                );
              }

              const expectedScanlineLength = imageWidth * bytesPerPixel;
              if (convertedScanline.length !== expectedScanlineLength) {
                const actualWidth = convertedScanline.length / bytesPerPixel;
                throw createStitchError(
                  `dimension mismatch for input #${imageIdx + 1} while assembling row ${row + 1}, column ${col + 1}. ` +
                    `Expected ${formatPixels(imageWidth)} wide scanline but decoder produced ${formatPixels(actualWidth)}.`
                );
              }

              // Pad scanline if image is narrower than column
              const paddedScanline = padScanline(
                convertedScanline,
                imageWidth,
                colWidth,
                bytesPerPixel,
                transparentColor
              );
              scanlines.push(paddedScanline);

              if (progress && progress.remainingScanlines[imageIdx] > 0) {
                progress.remainingScanlines[imageIdx] -= 1;
                if (progress.remainingScanlines[imageIdx] === 0) {
                  progress.completed += 1;
                  progress.callback(progress.completed, progress.total);
                }
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

        const expectedRowWidth = rowColWidths.reduce((sum, width) => sum + width, 0);
        const expectedRowLength = expectedRowWidth * bytesPerPixel;
        if (outputScanline.length !== expectedRowLength) {
          const actualWidth = outputScanline.length / bytesPerPixel;
          throw createStitchError(
            `dimension mismatch while assembling row ${row + 1}. Expected ${formatPixels(expectedRowWidth)} but assembled ${formatPixels(actualWidth)}.`
          );
        }

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
   * Generate scanlines for positioned images with optional alpha blending
   * Supports clipping and overlapping images
   */
  private async *generatePositionedScanlines(
    scanlineIndex: ScanlineIndex,
    positionedImages: PositionedImageInfo[],
    clippedImages: ClippedImageInfo[],
    iterators: AsyncGenerator<Uint8Array>[],
    totalWidth: number,
    totalHeight: number,
    headers: PngHeader[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array,
    useAlphaBlending: boolean,
    progress?: ProgressTracker
  ): AsyncGenerator<Uint8Array> {
    // Track current scanline for each image
    const currentScanlines = new Array(headers.length).fill(0);

    for (let outputY = 0; outputY < totalHeight; outputY++) {
      // Start with transparent scanline
      const outputScanline = createTransparentScanline(
        totalWidth,
        bytesPerPixel,
        transparentColor
      );

      const intersections = scanlineIndex.get(outputY);

      if (intersections) {
        for (const intersection of intersections) {
          const { imageIdx, localY, startX, endX } = intersection;
          const img = positionedImages.find(p => p.imageIdx === imageIdx);

          if (!img) continue;

          const imageHeader = headers[imageIdx];
          const clipInfo = clippedImages.find(c => c.imageIdx === imageIdx);

          // Skip scanlines until we reach the one we need
          while (currentScanlines[imageIdx] < localY) {
            await iterators[imageIdx].next();
            currentScanlines[imageIdx]++;

            if (progress && progress.remainingScanlines[imageIdx] > 0) {
              progress.remainingScanlines[imageIdx]--;
            }
          }

          // Read the scanline we need
          if (currentScanlines[imageIdx] === localY) {
            const { value, done } = await iterators[imageIdx].next();

            if (done || value === undefined) {
              throw createStitchError(
                `Unexpected end of scanlines for positioned image #${imageIdx + 1} at Y=${outputY}`
              );
            }

            const samplesPerPixel = getSamplesPerPixel(imageHeader.colorType);
            const expectedSourceLength = Math.ceil(
              (imageHeader.width * imageHeader.bitDepth * samplesPerPixel) / 8
            );

            if (value.length !== expectedSourceLength) {
              const bitsPerPixel = imageHeader.bitDepth * samplesPerPixel;
              const actualWidth = bitsPerPixel === 0 ? 0 : (value.length * 8) / bitsPerPixel;
              throw createStitchError(
                `dimension mismatch for positioned image #${imageIdx + 1} at Y=${outputY}. ` +
                `Expected ${formatPixels(imageHeader.width)} wide scanline (${expectedSourceLength} raw bytes) but decoder produced ` +
                `${formatPixels(actualWidth)} (${value.length} raw bytes).`
              );
            }

            // Convert scanline format
            let convertedScanline: Uint8Array;
            try {
              convertedScanline = convertScanline(
                value,
                imageHeader.width,
                imageHeader.bitDepth,
                imageHeader.colorType,
                outputHeader.bitDepth,
                outputHeader.colorType
              );
            } catch (error) {
              throw createStitchError(
                `unable to normalize positioned image #${imageIdx + 1} at Y=${outputY}`,
                error
              );
            }

            // Apply clipping if needed
            let scanlineToComposite = convertedScanline;
            let compositeX = startX;
            let compositeWidth = endX - startX;

            if (clipInfo && !clipInfo.fullyClipped) {
              // Extract the visible portion of the scanline
              scanlineToComposite = extractScanlinePortion(
                convertedScanline,
                clipInfo.sourceOffsetX,
                compositeWidth,
                bytesPerPixel
              );
            }

            // Composite onto output scanline
            compositeScanline(
              outputScanline,
              scanlineToComposite,
              compositeX,
              compositeWidth,
              bytesPerPixel,
              useAlphaBlending
            );

            currentScanlines[imageIdx]++;

            // Update progress
            if (progress && progress.remainingScanlines[imageIdx] > 0) {
              progress.remainingScanlines[imageIdx]--;
              if (progress.remainingScanlines[imageIdx] === 0) {
                progress.completed++;
                progress.callback(progress.completed, progress.total);
              }
            }
          }
        }
      }

      yield outputScanline;
    }
  }

  /**
   * Generate raw RGBA scanlines (without filtering)
   * Used for JPEG encoding
   */
  private async *generateRawScanlines(
    grid: number[][],
    rowHeights: number[],
    colWidths: number[][],
    totalWidth: number,
    headers: PngHeader[],
    iterators: AsyncGenerator<Uint8Array>[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array,
    progress?: ProgressTracker
  ): AsyncGenerator<Uint8Array> {
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
              const iterator = iterators[imageIdx];
              const { value, done } = await iterator.next();

              if (done || value === undefined) {
                const producedRows = localY;
                throw createStitchError(
                  `dimension mismatch for input #${imageIdx + 1} while assembling row ${row + 1}, column ${col + 1}. ` +
                    `Expected ${formatPixels(imageHeight)} tall image but decoder ended after ${formatPixels(producedRows)}.`
                );
              }

              const samplesPerPixel = getSamplesPerPixel(imageHeader.colorType);
              const expectedSourceLength = Math.ceil(
                (imageWidth * imageHeader.bitDepth * samplesPerPixel) / 8
              );

              if (value.length !== expectedSourceLength) {
                const bitsPerPixel = imageHeader.bitDepth * samplesPerPixel;
                const actualWidth = bitsPerPixel === 0 ? 0 : (value.length * 8) / bitsPerPixel;
                throw createStitchError(
                  `dimension mismatch for input #${imageIdx + 1} while assembling row ${row + 1}, column ${col + 1}. ` +
                    `Expected ${formatPixels(imageWidth)} wide scanline (${expectedSourceLength} raw bytes) but decoder produced ` +
                    `${formatPixels(actualWidth)} (${value.length} raw bytes).`
                );
              }

              let convertedScanline: Uint8Array;
              try {
                convertedScanline = convertScanline(
                  value,
                  imageWidth,
                  imageHeader.bitDepth,
                  imageHeader.colorType,
                  outputHeader.bitDepth,
                  outputHeader.colorType
                );
              } catch (error) {
                throw createStitchError(
                  `unable to normalize input #${imageIdx + 1} at row ${row + 1}, column ${col + 1}`,
                  error
                );
              }

              const expectedScanlineLength = imageWidth * bytesPerPixel;
              if (convertedScanline.length !== expectedScanlineLength) {
                const actualWidth = convertedScanline.length / bytesPerPixel;
                throw createStitchError(
                  `dimension mismatch for input #${imageIdx + 1} while assembling row ${row + 1}, column ${col + 1}. ` +
                    `Expected ${formatPixels(imageWidth)} wide scanline but decoder produced ${formatPixels(actualWidth)}.`
                );
              }

              // Pad scanline if image is narrower than column
              const paddedScanline = padScanline(
                convertedScanline,
                imageWidth,
                colWidth,
                bytesPerPixel,
                transparentColor
              );
              scanlines.push(paddedScanline);

              if (progress && progress.remainingScanlines[imageIdx] > 0) {
                progress.remainingScanlines[imageIdx] -= 1;
                if (progress.remainingScanlines[imageIdx] === 0) {
                  progress.completed += 1;
                  progress.callback(progress.completed, progress.total);
                }
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

        const expectedRowWidth = rowColWidths.reduce((sum, width) => sum + width, 0);
        const expectedRowLength = expectedRowWidth * bytesPerPixel;
        if (outputScanline.length !== expectedRowLength) {
          const actualWidth = outputScanline.length / bytesPerPixel;
          throw createStitchError(
            `dimension mismatch while assembling row ${row + 1}. Expected ${formatPixels(expectedRowWidth)} but assembled ${formatPixels(actualWidth)}.`
          );
        }

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

        // Yield raw scanline (no filtering for JPEG)
        yield outputScanline;
      }
    }
  }

  /**
   * Stream JPEG-compressed data
   * Buffers scanlines into 8-line MCU strips and feeds to JPEG encoder
   */
  private async *streamJpegData(
    grid: number[][],
    rowHeights: number[],
    colWidths: number[][],
    totalWidth: number,
    totalHeight: number,
    headers: PngHeader[],
    iterators: AsyncGenerator<Uint8Array>[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array,
    quality: number,
    progress?: ProgressTracker
  ): AsyncGenerator<Uint8Array> {
    // JPEG encoder expects 8-bit RGBA data
    // The output header is guaranteed to be 8-bit RGBA when this method is called
    // (enforced in the stream() method)

    // Create JPEG encoder
    const encoder = new JpegEncoder({
      width: totalWidth,
      height: totalHeight,
      quality
    });

    // Yield JPEG header
    for await (const chunk of encoder.header()) {
      yield chunk;
    }

    // Generate raw scanlines
    const scanlineGenerator = this.generateRawScanlines(
      grid,
      rowHeights,
      colWidths,
      totalWidth,
      headers,
      iterators,
      outputHeader,
      bytesPerPixel,
      transparentColor,
      progress
    );

    // Buffer scanlines into 8-line strips
    const MCU_HEIGHT = 8;
    const stripSize = totalWidth * MCU_HEIGHT * 4; // RGBA
    let stripBuffer = new Uint8Array(stripSize);
    let lineInStrip = 0;
    let lastScanline: Uint8Array | null = null;

    for await (const scanline of scanlineGenerator) {
      // Copy scanline into strip buffer
      stripBuffer.set(scanline, lineInStrip * totalWidth * 4);
      lastScanline = scanline;
      lineInStrip++;

      // When we have 8 lines, encode the strip
      if (lineInStrip === MCU_HEIGHT) {
        for await (const chunk of encoder.encodeStrip(stripBuffer, null)) {
          yield chunk;
        }
        lineInStrip = 0;
        stripBuffer = new Uint8Array(stripSize);
      }
    }

    // Handle remaining partial strip
    if (lineInStrip > 0) {
      // Pass the partial strip with the last scanline for edge pixel repetition
      // This prevents white blending artifacts in non-8-aligned heights
      const partialSize = lineInStrip * totalWidth * 4;
      const partialStrip = stripBuffer.subarray(0, partialSize);

      for await (const chunk of encoder.encodeStrip(partialStrip, lastScanline)) {
        yield chunk;
      }
    }

    // Yield JPEG footer
    for await (const chunk of encoder.finish()) {
      yield chunk;
    }
  }

  /**
   * Stream concatenated image output scanline-by-scanline
   * Supports both PNG and JPEG output formats
   * Supports both grid mode and positioned mode
   */
  async *stream(): AsyncGenerator<Uint8Array> {
    // Collect inputs into array if iterable
    const inputsArray: ImageInput[] = Array.isArray(this.options.inputs)
      ? this.options.inputs
      : await (async () => {
          const arr: ImageInput[] = [];
          const asyncIterator = (this.options.inputs as AsyncIterable<ImageInput>)[Symbol.asyncIterator];
          if (typeof asyncIterator === 'function') {
            for await (const input of this.options.inputs as AsyncIterable<ImageInput>) {
              arr.push(input);
            }
          } else {
            for (const input of this.options.inputs as Iterable<ImageInput>) {
              arr.push(input);
            }
          }
          return arr;
        })();

    if (inputsArray.length === 0) {
      throw new Error('At least one input image is required');
    }

    // Check if we're in positioned mode
    const isPositionedMode = hasPositionedImages(inputsArray);

    // Validate that we don't mix positioned and non-positioned
    if (isPositionedMode) {
      validatePositionedInputs(inputsArray);
    }

    // PASS 1: Create decoders and read headers (supports PNG, JPEG, HEIC)
    const decoderPlugins = this.options.decoders ?? getDefaultDecoderPlugins();
    const decoders = await createDecodersFromIterable(
      inputsArray,
      this.options.decoderOptions ?? {},
      decoderPlugins
    );

    // Get headers from all decoders
    const imageHeaders: ImageHeader[] = [];
    for (const decoder of decoders) {
      imageHeaders.push(await decoder.getHeader());
    }

    // Convert to PNG headers for internal processing
    const headers: PngHeader[] = imageHeaders.map(imageHeaderToPngHeader);

    try {
      // Determine common format that can represent all images
      const { bitDepth: targetBitDepth, colorType: targetColorType } = determineCommonFormat(headers);

      if (isPositionedMode) {
        // POSITIONED MODE
        yield* this.streamPositionedMode(
          inputsArray,
          decoders,
          headers,
          targetBitDepth,
          targetColorType
        );
      } else {
        // GRID MODE (existing implementation)
        yield* this.streamGridMode(
          decoders,
          headers,
          targetBitDepth,
          targetColorType
        );
      }
    } finally {
      // Clean up all decoders and release resources
      for (const decoder of decoders) {
        await decoder.close();
      }
    }
  }

  /**
   * Stream grid mode (existing row/column layout)
   */
  private async *streamGridMode(
    decoders: any[],
    headers: PngHeader[],
    targetBitDepth: number,
    targetColorType: number
  ): AsyncGenerator<Uint8Array> {
    // Validate grid mode requires layout specification
    const { layout } = this.options;
    if (!layout.columns && !layout.rows && !layout.width && !layout.height) {
      throw new Error('Grid mode requires layout: columns, rows, width, or height');
    }

    // Calculate layout with variable image sizes
    const gridLayout = calculateLayout(headers, this.options);
    const { grid, rowHeights, colWidths, totalWidth, totalHeight } = gridLayout;

    // JPEG output requires 8-bit RGBA format - force conversion if needed
    const outputFormat = this.options.outputFormat ?? 'png';
    const finalBitDepth = outputFormat === 'jpeg' ? 8 : targetBitDepth;
    const finalColorType = outputFormat === 'jpeg' ? 6 : targetColorType; // 6 = RGBA

    // Create output header using common format
    const outputHeader: PngHeader = {
      width: totalWidth,
      height: totalHeight,
      bitDepth: finalBitDepth,
      colorType: finalColorType,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // PASS 2: Stream scanlines with format-specific compression
    // Create iterators for each input decoder
    const iterators = decoders.map(decoder => decoder.scanlines());
    const bytesPerPixel = getBytesPerPixel(outputHeader.bitDepth, outputHeader.colorType);
    const transparentColor = getTransparentColor(
      outputHeader.colorType,
      outputHeader.bitDepth,
      this.options.backgroundColor
    );
    const progressTracker = this.createProgressTracker(headers);

    // Branch between PNG and JPEG output
    if (outputFormat === 'jpeg') {
      // JPEG output
      const quality = this.options.jpegQuality ?? 85;
      yield* this.streamJpegData(
        grid,
        rowHeights,
        colWidths,
        totalWidth,
        totalHeight,
        headers,
        iterators,
        outputHeader,
        bytesPerPixel,
        transparentColor,
        quality,
        progressTracker
      );
    } else {
      // PNG output (default)
      // Yield PNG signature
      yield PNG_SIGNATURE;

      // Yield IHDR
      yield serializeChunk(createIHDR(outputHeader));

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
        transparentColor,
        progressTracker
      );

      // Yield IEND
      yield serializeChunk(createIEND());
    }
  }

  /**
   * Stream positioned mode (free-form image placement with optional overlapping)
   */
  private async *streamPositionedMode(
    inputsArray: ImageInput[],
    decoders: any[],
    headers: PngHeader[],
    targetBitDepth: number,
    targetColorType: number
  ): AsyncGenerator<Uint8Array> {
    // Extract positions from inputs
    const positions = extractPositions(inputsArray).map((pos) => {
      if (!pos) {
        throw new Error('Internal error: non-positioned image in positioned mode');
      }
      return pos;
    });

    // Calculate canvas size (auto or explicit)
    const { width: canvasWidth, height: canvasHeight } = calculateCanvasSize(
      positions.map((pos, i) => ({
        x: pos.x,
        y: pos.y,
        width: headers[i].width,
        height: headers[i].height
      })),
      this.options.layout.width,
      this.options.layout.height
    );

    // Clip images to canvas and log warnings
    const logger = (message: string) => {
      // Use console.warn for clipping warnings
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(message);
      }
    };

    const { clippedImages, positionedImages } = clipImagesToCanvas(
      positions,
      headers,
      canvasWidth,
      canvasHeight,
      logger
    );

    // Build scanline index for efficient rendering
    const scanlineIndex = buildScanlineIndex(positionedImages, canvasHeight);

    // JPEG output requires 8-bit RGBA format - force conversion if needed
    const outputFormat = this.options.outputFormat ?? 'png';
    const finalBitDepth = outputFormat === 'jpeg' ? 8 : targetBitDepth;
    const finalColorType = outputFormat === 'jpeg' ? 6 : targetColorType; // 6 = RGBA

    // Create output header
    const outputHeader: PngHeader = {
      width: canvasWidth,
      height: canvasHeight,
      bitDepth: finalBitDepth,
      colorType: finalColorType,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };

    // Create iterators for each input decoder
    const iterators = decoders.map(decoder => decoder.scanlines());
    const bytesPerPixel = getBytesPerPixel(outputHeader.bitDepth, outputHeader.colorType);
    const transparentColor = getTransparentColor(
      outputHeader.colorType,
      outputHeader.bitDepth,
      this.options.backgroundColor
    );
    const progressTracker = this.createProgressTracker(headers);
    const useAlphaBlending = this.options.enableAlphaBlending !== false; // Default: true

    // Branch between PNG and JPEG output
    if (outputFormat === 'jpeg') {
      // JPEG output
      const quality = this.options.jpegQuality ?? 85;
      yield* this.streamPositionedJpegData(
        scanlineIndex,
        positionedImages,
        clippedImages,
        iterators,
        canvasWidth,
        canvasHeight,
        headers,
        outputHeader,
        bytesPerPixel,
        transparentColor,
        useAlphaBlending,
        quality,
        progressTracker
      );
    } else {
      // PNG output (default)
      // Yield PNG signature
      yield PNG_SIGNATURE;

      // Yield IHDR
      yield serializeChunk(createIHDR(outputHeader));

      // Stream positioned scanlines with PNG compression
      yield* this.streamPositionedPngData(
        scanlineIndex,
        positionedImages,
        clippedImages,
        iterators,
        canvasWidth,
        headers,
        outputHeader,
        bytesPerPixel,
        transparentColor,
        useAlphaBlending,
        progressTracker
      );

      // Yield IEND
      yield serializeChunk(createIEND());
    }
  }

  /**
   * Stream positioned PNG data with compression
   */
  private async *streamPositionedPngData(
    scanlineIndex: ScanlineIndex,
    positionedImages: PositionedImageInfo[],
    clippedImages: ClippedImageInfo[],
    iterators: AsyncGenerator<Uint8Array>[],
    totalWidth: number,
    headers: PngHeader[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array,
    useAlphaBlending: boolean,
    progress?: ProgressTracker
  ): AsyncGenerator<Uint8Array> {
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
    await deflator.initialize((compressedData) => {
      if (compressedData && compressedData.length > 0) {
        compressedChunks.push(compressedData);
      }
    });

    let scanlineCount = 0;
    let previousOutputScanline: Uint8Array | null = null;

    // Generate positioned scanlines
    const scanlineGenerator = this.generatePositionedScanlines(
      scanlineIndex,
      positionedImages,
      clippedImages,
      iterators,
      totalWidth,
      outputHeader.height,
      headers,
      outputHeader,
      bytesPerPixel,
      transparentColor,
      useAlphaBlending,
      progress
    );

    // Process each scanline with PNG filtering
    for await (const outputScanline of scanlineGenerator) {
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

      await deflator.push(scanlineWithFilter);
      scanlineCount++;

      // Periodic flush for progressive output
      if (scanlineCount % MAX_BATCH_SCANLINES === 0) {
        await deflator.flush();
      }

      // Yield any compressed chunks that were produced
      while (compressedChunks.length > 0) {
        const chunk = compressedChunks.shift()!;
        yield serializeChunk(createChunk('IDAT', chunk));
      }

      previousOutputScanline = outputScanline;
    }

    // Finish compression
    await deflator.finish();

    // Yield remaining compressed chunks
    while (compressedChunks.length > 0) {
      const chunk = compressedChunks.shift()!;
      yield serializeChunk(createChunk('IDAT', chunk));
    }
  }

  /**
   * Stream positioned JPEG data
   */
  private async *streamPositionedJpegData(
    scanlineIndex: ScanlineIndex,
    positionedImages: PositionedImageInfo[],
    clippedImages: ClippedImageInfo[],
    iterators: AsyncGenerator<Uint8Array>[],
    totalWidth: number,
    totalHeight: number,
    headers: PngHeader[],
    outputHeader: PngHeader,
    bytesPerPixel: number,
    transparentColor: Uint8Array,
    useAlphaBlending: boolean,
    quality: number,
    progress?: ProgressTracker
  ): AsyncGenerator<Uint8Array> {
    // Create JPEG encoder
    const encoder = new JpegEncoder({
      width: totalWidth,
      height: totalHeight,
      quality
    });

    // Yield JPEG header
    for await (const chunk of encoder.header()) {
      yield chunk;
    }

    // Generate positioned scanlines
    const scanlineGenerator = this.generatePositionedScanlines(
      scanlineIndex,
      positionedImages,
      clippedImages,
      iterators,
      totalWidth,
      totalHeight,
      headers,
      outputHeader,
      bytesPerPixel,
      transparentColor,
      useAlphaBlending,
      progress
    );

    // Buffer scanlines into 8-line MCU strips
    const MCU_HEIGHT = 8;
    const stripSize = totalWidth * MCU_HEIGHT * 4; // RGBA
    let stripBuffer = new Uint8Array(stripSize);
    let lineInStrip = 0;
    let lastScanline: Uint8Array | null = null;

    for await (const scanline of scanlineGenerator) {
      // Copy scanline into strip buffer
      stripBuffer.set(scanline, lineInStrip * totalWidth * 4);
      lastScanline = scanline;
      lineInStrip++;

      // When we have 8 lines, encode the strip
      if (lineInStrip === MCU_HEIGHT) {
        for await (const chunk of encoder.encodeStrip(stripBuffer, null)) {
          yield chunk;
        }
        lineInStrip = 0;
        stripBuffer = new Uint8Array(stripSize);
      }
    }

    // Handle remaining partial strip
    if (lineInStrip > 0) {
      const partialSize = lineInStrip * totalWidth * 4;
      const partialStrip = stripBuffer.subarray(0, partialSize);

      for await (const chunk of encoder.encodeStrip(partialStrip, lastScanline)) {
        yield chunk;
      }
    }

    // Yield JPEG footer
    for await (const chunk of encoder.finish()) {
      yield chunk;
    }
  }

  private createProgressTracker(headers: PngHeader[]): ProgressTracker | undefined {
    if (typeof this.options.onProgress !== 'function') {
      return undefined;
    }

    const tracker: ProgressTracker = {
      callback: this.options.onProgress,
      remainingScanlines: headers.map(header => Math.max(0, header.height)),
      completed: 0,
      total: headers.length
    };

    if (tracker.total === 0) {
      return tracker;
    }

    for (let index = 0; index < tracker.remainingScanlines.length; index++) {
      if (tracker.remainingScanlines[index] === 0) {
        tracker.completed += 1;
      }
    }

    if (tracker.completed > 0) {
      tracker.callback(tracker.completed, tracker.total);
    }

    return tracker;
  }
}

/**
 * Concatenate images with streaming (minimal memory usage)
 *
 * Supports PNG, JPEG, and HEIC input formats with automatic format detection.
 * Processes images scanline-by-scanline, keeping only a few rows in memory at a time.
 * Output can be PNG (lossless) or JPEG (lossy) format.
 *
 * Supported input formats:
 * - PNG (all color types, bit depths, interlaced)
 * - JPEG (baseline, progressive, grayscale, RGB)
 * - HEIC/HEIF (all variants)
 *
 * Supported output formats:
 * - PNG (lossless, default)
 * - JPEG (lossy, configurable quality)
 *
 * Supported input types:
 * - File paths (string)
 * - Uint8Array buffers
 * - ArrayBuffer
 * - Mixed input types and formats
 * - Variable image dimensions with automatic padding
 * - All layout options (columns, rows, width, height)
 *
 * @example
 * // Mix PNG, JPEG, and HEIC files - output as PNG
 * for await (const chunk of concatStreaming({
 *   inputs: ['photo.jpg', 'image.png', 'pic.heic'],
 *   layout: { columns: 3 }
 * })) {
 *   // Process chunk
 * }
 *
 * @example
 * // Output as JPEG with custom quality
 * for await (const chunk of concatStreaming({
 *   inputs: ['photo1.jpg', 'photo2.jpg'],
 *   layout: { columns: 2 },
 *   outputFormat: 'jpeg',
 *   jpegQuality: 90
 * })) {
 *   // Process chunk
 * }
 */
async function* coreConcatStreaming(
  options: ConcatOptions
): AsyncGenerator<Uint8Array> {
  const concatenator = new CoreStreamingConcatenator(options);
  yield* concatenator.stream();
}
/**
 * Concatenate images and return the PNG as a Uint8Array.
 */
async function concatCore(options: ConcatOptions): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of coreConcatStreaming(options)) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    result.set(chunk, offset);
    offset += chunk.length;
    chunks[i] = null as any;
  }

  return result;
}

const StreamingConcatenator = CoreStreamingConcatenator;

export { CoreStreamingConcatenator, StreamingConcatenator };

export { coreConcatStreaming as concatStreaming };

export { concatCore as concat };
