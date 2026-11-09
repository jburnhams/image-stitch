/**
 * Image Concatenation (Multi-Format Support)
 *
 * Scanline-by-scanline streaming approach that minimizes memory usage.
 * Supports PNG, JPEG, and HEIC input formats with automatic format detection.
 *
 * The pipeline has three independent stages:
 * 1. Layout: read only the image headers and work out where every image goes.
 * 2. Scanlines: produce one full-width output row at a time (grid or positioned mode).
 * 3. Encoding: turn those rows into PNG or JPEG bytes as they arrive.
 */

import { ConcatOptions, PngHeader } from './types.js';
import { PNG_SIGNATURE, getSamplesPerPixel } from './utils.js';
import { filterScanline, getBytesPerPixel } from './png-filter.js';
import { createIHDR, createIEND, serializeChunk, createChunk } from './png-writer.js';
import { createDecodersFromIterable, hasPositionedImages, extractPositions, validatePositionedInputs } from './decoders/decoder-factory.js';
import { getDefaultDecoderPlugins } from './decoders/plugin-registry.js';
import type { ImageDecoder, ImageHeader, ImageInput } from './decoders/types.js';
import { determineCommonFormat, convertScanline, getTransparentColor, compositeScanline, extractScanlinePortion } from './pixel-ops.js';
import { StreamingDeflator } from './streaming-deflate.js';
import { JpegEncoder } from './jpeg-encoder.js';
import { calculateCanvasSize, buildScanlineIndex, clipImagesToCanvas, type ClippedImageInfo, type ScanlineIndex } from './positioned-layout.js';

function createStitchError(message: string, cause?: unknown): Error {
  const baseMessage = `Failed to stitch images: ${message}`;
  if (cause instanceof Error) {
    return new Error(baseMessage, { cause });
  }

  return new Error(baseMessage);
}

function formatPixels(value: number): string {
  return Number.isInteger(value) ? `${value}px` : `${value.toFixed(2)}px`;
}

function warn(message: string): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(message);
  }
}

/**
 * Convert ImageHeader to PngHeader for internal PNG processing
 * Maps generic image headers to PNG-specific format
 */
function imageHeaderToPngHeader(header: ImageHeader): PngHeader {
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
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
}

/**
 * Create a scanline of `width` pixels filled with `color`
 */
function createFilledScanline(width: number, bytesPerPixel: number, color: Uint8Array): Uint8Array {
  const scanline = new Uint8Array(width * bytesPerPixel);
  if (color.some((byte) => byte !== 0)) {
    for (let i = 0; i < width; i++) {
      scanline.set(color, i * bytesPerPixel);
    }
  }
  return scanline;
}

function assertPositiveInteger(value: unknown, name: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`layout.${name} must be a positive integer, got ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

/**
 * Grid layout. Each cell is placed at (cellX, cellY) and every row is
 * `rowHeights[row]` pixels tall.
 */
export interface GridLayout {
  /** grid[row][col] is an input index, or -1 for an empty cell */
  grid: number[][];
  /** Height of each row (tallest image in the row) */
  rowHeights: number[];
  /** Width of each cell, per row. Fixed grids share column widths across rows. */
  colWidths: number[][];
  totalWidth: number;
  totalHeight: number;
  /** Indices of inputs that did not fit within the width/height/rows limits */
  dropped: number[];
}

function makeColumnGrid(numImages: number, columns: number): number[][] {
  const rows = Math.ceil(numImages / columns);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, col) => {
      const idx = row * columns + col;
      return idx < numImages ? idx : -1;
    })
  );
}

function makeRowGrid(numImages: number, rows: number): number[][] {
  const columns = Math.ceil(numImages / rows);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, col) => {
      const idx = col * rows + row;
      return idx < numImages ? idx : -1;
    })
  );
}

/**
 * Flow layout: fill rows left to right, wrapping when the next image would
 * exceed `maxWidth` (or `fixedColumns` images). Stops when the next row would
 * exceed `maxHeight` or `fixedRows`; any remaining inputs are dropped.
 */
function makeFlowGrid(
  headers: Array<{ width: number; height: number }>,
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
    const { width: imageWidth, height: imageHeight } = headers[i];

    const wouldExceedWidth = maxWidth !== undefined && currentRowWidth + imageWidth > maxWidth;
    const wouldExceedColumns = fixedColumns !== undefined && currentRow.length >= fixedColumns;

    if ((wouldExceedWidth || wouldExceedColumns) && currentRow.length > 0) {
      const wouldExceedRows = fixedRows !== undefined && grid.length + 1 >= fixedRows;
      const wouldExceedHeight =
        maxHeight !== undefined && totalHeight + currentRowMaxHeight + imageHeight > maxHeight;

      if (wouldExceedRows || wouldExceedHeight) {
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
  }

  if (currentRow.length > 0) {
    grid.push(currentRow);
  }

  return grid;
}

/**
 * Work out where every image goes in grid mode.
 *
 * - `columns` (or `rows`) alone gives a regular grid. Column widths are the
 *   widest image in that column and row heights the tallest image in that
 *   row, so cells line up across the whole grid.
 * - `width` and/or `height` give a flow layout that wraps when a row would
 *   become too wide. `columns`/`rows` can be combined with them as extra caps.
 *
 * Images smaller than their cell are top-left aligned and the rest of the cell
 * is filled with the background colour.
 */
export function calculateLayout(
  headers: Array<{ width: number; height: number }>,
  layout: ConcatOptions['layout']
): GridLayout {
  const numImages = headers.length;
  const { columns, rows, width, height } = layout;

  let grid: number[][];
  let alignColumns = true;

  if (columns && !height) {
    grid = makeColumnGrid(numImages, columns);
  } else if (rows && !width) {
    grid = makeRowGrid(numImages, rows);
  } else if (width || height) {
    grid = makeFlowGrid(headers, width, height, columns, rows);
    alignColumns = false;
  } else {
    grid = [Array.from({ length: numImages }, (_, i) => i)];
  }

  const rowHeights = grid.map((row) =>
    row.reduce((max, idx) => (idx >= 0 ? Math.max(max, headers[idx].height) : max), 0)
  );

  let colWidths: number[][];
  if (alignColumns) {
    const numCols = Math.max(0, ...grid.map((row) => row.length));
    const shared = Array.from({ length: numCols }, (_, col) =>
      grid.reduce((max, row) => {
        const idx = row[col] ?? -1;
        return idx >= 0 ? Math.max(max, headers[idx].width) : max;
      }, 0)
    );
    colWidths = grid.map((row) => shared.slice(0, row.length));
  } else {
    colWidths = grid.map((row) => row.map((idx) => (idx >= 0 ? headers[idx].width : 0)));
  }

  const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const totalWidth = Math.max(0, ...colWidths.map((row) => row.reduce((sum, w) => sum + w, 0)));

  const placed = new Set(grid.flat());
  const dropped: number[] = [];
  for (let i = 0; i < numImages; i++) {
    if (!placed.has(i)) {
      dropped.push(i);
    }
  }

  return { grid, rowHeights, colWidths, totalWidth, totalHeight, dropped };
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

/**
 * Counts scanlines read per input and reports an input as complete once every
 * row it contributes to the output has been read. Inputs that contribute no
 * rows (zero height, fully clipped, or dropped by the layout) count as
 * complete straight away.
 */
class ProgressTracker {
  private completed = 0;

  constructor(
    private readonly callback: (completed: number, total: number) => void,
    private readonly remaining: number[]
  ) {
    this.completed = remaining.filter((rows) => rows <= 0).length;
    if (this.completed > 0) {
      this.callback(this.completed, this.remaining.length);
    }
  }

  rowRead(imageIdx: number): void {
    if (this.remaining[imageIdx] <= 0) {
      return;
    }
    this.remaining[imageIdx] -= 1;
    if (this.remaining[imageIdx] === 0) {
      this.completed += 1;
      this.callback(this.completed, this.remaining.length);
    }
  }
}

// ---------------------------------------------------------------------------
// Concatenator
// ---------------------------------------------------------------------------

interface OutputPlan {
  header: PngHeader;
  bytesPerPixel: number;
  background: Uint8Array;
  scanlines: AsyncGenerator<Uint8Array>;
}

/**
 * Streaming image concatenation with minimal memory usage
 *
 * 1. Pass 1 reads only headers to validate and plan the layout.
 * 2. Pass 2 produces the output one scanline at a time and encodes it as it goes.
 *
 * Memory usage is O(output_width), not O(total_pixels), for streaming decoders.
 */
class CoreStreamingConcatenator {
  private options: ConcatOptions;

  constructor(options: ConcatOptions) {
    this.validateOptions(options);
    this.options = options;
  }

  private validateOptions(options: ConcatOptions): void {
    if (!options || typeof options !== 'object') {
      throw new Error('Options object is required');
    }

    if (
      !options.inputs ||
      (Array.isArray(options.inputs) && options.inputs.length === 0)
    ) {
      throw new Error('At least one input image is required');
    }

    if (!options.layout || typeof options.layout !== 'object') {
      throw new Error('layout is required (use {} for positioned images)');
    }

    assertPositiveInteger(options.layout.columns, 'columns');
    assertPositiveInteger(options.layout.rows, 'rows');
    assertPositiveInteger(options.layout.width, 'width');
    assertPositiveInteger(options.layout.height, 'height');

    const format = options.outputFormat ?? 'png';
    if (format !== 'png' && format !== 'jpeg') {
      throw new Error(`outputFormat must be 'png' or 'jpeg', got ${String(format)}`);
    }

    if (options.jpegQuality !== undefined) {
      const q = options.jpegQuality;
      if (typeof q !== 'number' || !Number.isFinite(q) || q < 1 || q > 100) {
        throw new Error(`jpegQuality must be a number from 1 to 100, got ${String(q)}`);
      }
    }
  }

  private async collectInputs(): Promise<ImageInput[]> {
    const { inputs } = this.options;
    if (Array.isArray(inputs)) {
      return inputs;
    }

    const arr: ImageInput[] = [];
    if (typeof (inputs as AsyncIterable<ImageInput>)[Symbol.asyncIterator] === 'function') {
      for await (const input of inputs as AsyncIterable<ImageInput>) {
        arr.push(input);
      }
    } else {
      for (const input of inputs as Iterable<ImageInput>) {
        arr.push(input);
      }
    }
    return arr;
  }

  /**
   * Stream concatenated image output chunk by chunk.
   * Supports PNG and JPEG output, in grid or positioned mode.
   */
  async *stream(): AsyncGenerator<Uint8Array> {
    const inputsArray = await this.collectInputs();

    if (inputsArray.length === 0) {
      throw new Error('At least one input image is required');
    }

    const isPositionedMode = hasPositionedImages(inputsArray);
    if (isPositionedMode) {
      validatePositionedInputs(inputsArray);
    } else {
      const { columns, rows, width, height } = this.options.layout;
      if (!columns && !rows && !width && !height) {
        throw new Error('Grid mode requires layout: columns, rows, width, or height');
      }
    }

    // PASS 1: create decoders and read headers
    const decoderPlugins = this.options.decoders ?? getDefaultDecoderPlugins();
    const decoders = await createDecodersFromIterable(
      inputsArray,
      this.options.decoderOptions ?? {},
      decoderPlugins
    );

    try {
      const headers: PngHeader[] = [];
      for (const decoder of decoders) {
        headers.push(imageHeaderToPngHeader(await decoder.getHeader()));
      }

      const plan = isPositionedMode
        ? this.planPositioned(inputsArray, decoders, headers)
        : this.planGrid(decoders, headers);

      // PASS 2: encode scanlines as they are produced
      if ((this.options.outputFormat ?? 'png') === 'jpeg') {
        yield* encodeJpeg(plan.scanlines, plan.header.width, plan.header.height, this.options.jpegQuality ?? 85);
      } else {
        yield* encodePng(plan.scanlines, plan.header, plan.bytesPerPixel);
      }
    } finally {
      for (const decoder of decoders) {
        await decoder.close();
      }
    }
  }

  private createOutputHeader(width: number, height: number, headers: PngHeader[]): PngHeader {
    if (width <= 0 || height <= 0) {
      throw createStitchError(`output would be empty (${width}x${height})`);
    }

    // JPEG output requires 8-bit RGBA, PNG keeps the richest common format
    const isJpeg = (this.options.outputFormat ?? 'png') === 'jpeg';
    const common = determineCommonFormat(headers);

    return {
      width,
      height,
      bitDepth: isJpeg ? 8 : common.bitDepth,
      colorType: isJpeg ? 6 : common.colorType,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0
    };
  }

  private createProgressTracker(requiredRows: number[]): ProgressTracker | undefined {
    if (typeof this.options.onProgress !== 'function') {
      return undefined;
    }
    return new ProgressTracker(this.options.onProgress, requiredRows);
  }

  private planGrid(decoders: ImageDecoder[], headers: PngHeader[]): OutputPlan {
    const layout = calculateLayout(headers, this.options.layout);

    if (layout.dropped.length > 0) {
      warn(
        `image-stitch: ${layout.dropped.length} of ${headers.length} images did not fit within the layout limits ` +
          `and were left out (inputs ${layout.dropped.map((i) => `#${i + 1}`).join(', ')}).`
      );
    }

    const header = this.createOutputHeader(layout.totalWidth, layout.totalHeight, headers);
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const background = getTransparentColor(header.colorType, header.bitDepth, this.options.backgroundColor);

    const droppedSet = new Set(layout.dropped);
    const progress = this.createProgressTracker(headers.map((h, i) => (droppedSet.has(i) ? 0 : h.height)));

    return {
      header,
      bytesPerPixel,
      background,
      scanlines: generateGridScanlines(layout, decoders, headers, header, bytesPerPixel, background, progress)
    };
  }

  private planPositioned(inputsArray: ImageInput[], decoders: ImageDecoder[], headers: PngHeader[]): OutputPlan {
    const positions = extractPositions(inputsArray).map((pos) => {
      if (!pos) {
        throw new Error('Internal error: non-positioned image in positioned mode');
      }
      return pos;
    });

    const { width: canvasWidth, height: canvasHeight } = calculateCanvasSize(
      positions.map((pos, i) => ({ x: pos.x, y: pos.y, width: headers[i].width, height: headers[i].height })),
      this.options.layout.width,
      this.options.layout.height
    );

    const { clippedImages, positionedImages } = clipImagesToCanvas(
      positions,
      headers,
      canvasWidth,
      canvasHeight,
      warn
    );

    const scanlineIndex = buildScanlineIndex(positionedImages, canvasHeight);
    const header = this.createOutputHeader(canvasWidth, canvasHeight, headers);
    const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
    const background = getTransparentColor(header.colorType, header.bitDepth, this.options.backgroundColor);

    const clipByImage = new Map<number, ClippedImageInfo>(clippedImages.map((c) => [c.imageIdx, c]));

    // Rows each input must be read for: everything down to its last visible row
    const requiredRows = headers.map(() => 0);
    for (const img of positionedImages) {
      requiredRows[img.imageIdx] = (clipByImage.get(img.imageIdx)?.sourceOffsetY ?? 0) + img.height;
    }

    return {
      header,
      bytesPerPixel,
      background,
      scanlines: generatePositionedScanlines(
        scanlineIndex,
        clipByImage,
        decoders,
        headers,
        header,
        bytesPerPixel,
        background,
        this.options.enableAlphaBlending !== false,
        this.createProgressTracker(requiredRows)
      )
    };
  }
}

// ---------------------------------------------------------------------------
// Scanline generators
// ---------------------------------------------------------------------------

/**
 * Read the next scanline from an input and convert it to the output format.
 * Throws a descriptive error if the decoder produces the wrong amount of data.
 */
async function readConvertedScanline(
  iterator: AsyncGenerator<Uint8Array>,
  imageIdx: number,
  imageHeader: PngHeader,
  rowsRead: number,
  outputHeader: PngHeader,
  bytesPerPixel: number,
  where: string
): Promise<Uint8Array> {
  const { value, done } = await iterator.next();

  if (done || value === undefined) {
    throw createStitchError(
      `dimension mismatch for input #${imageIdx + 1} ${where}. ` +
        `Expected ${formatPixels(imageHeader.height)} tall image but decoder ended after ${formatPixels(rowsRead)}.`
    );
  }

  const samplesPerPixel = getSamplesPerPixel(imageHeader.colorType);
  const bitsPerPixel = imageHeader.bitDepth * samplesPerPixel;
  const expectedSourceLength = Math.ceil((imageHeader.width * bitsPerPixel) / 8);

  if (value.length !== expectedSourceLength) {
    const actualWidth = bitsPerPixel === 0 ? 0 : (value.length * 8) / bitsPerPixel;
    throw createStitchError(
      `dimension mismatch for input #${imageIdx + 1} ${where}. ` +
        `Expected ${formatPixels(imageHeader.width)} wide scanline (${expectedSourceLength} raw bytes) but decoder produced ` +
        `${formatPixels(actualWidth)} (${value.length} raw bytes).`
    );
  }

  let converted: Uint8Array;
  try {
    converted = convertScanline(
      value,
      imageHeader.width,
      imageHeader.bitDepth,
      imageHeader.colorType,
      outputHeader.bitDepth,
      outputHeader.colorType
    );
  } catch (error) {
    throw createStitchError(`unable to normalize input #${imageIdx + 1} ${where}`, error);
  }

  if (converted.length !== imageHeader.width * bytesPerPixel) {
    throw createStitchError(
      `dimension mismatch for input #${imageIdx + 1} ${where}. ` +
        `Expected ${formatPixels(imageHeader.width)} wide scanline but decoder produced ${formatPixels(converted.length / bytesPerPixel)}.`
    );
  }

  return converted;
}

/**
 * Produce full-width output scanlines (unfiltered, in the output pixel format) for grid mode
 */
async function* generateGridScanlines(
  layout: GridLayout,
  decoders: ImageDecoder[],
  headers: PngHeader[],
  outputHeader: PngHeader,
  bytesPerPixel: number,
  background: Uint8Array,
  progress?: ProgressTracker
): AsyncGenerator<Uint8Array> {
  const { grid, rowHeights, colWidths, totalWidth } = layout;
  const iterators = new Map<number, AsyncGenerator<Uint8Array>>();
  const backgroundRow = createFilledScanline(totalWidth, bytesPerPixel, background);

  for (let row = 0; row < grid.length; row++) {
    const rowColWidths = colWidths[row];

    for (let localY = 0; localY < rowHeights[row]; localY++) {
      const output = backgroundRow.slice();
      let x = 0;

      for (let col = 0; col < grid[row].length; col++) {
        const imageIdx = grid[row][col];

        if (imageIdx >= 0 && localY < headers[imageIdx].height) {
          let iterator = iterators.get(imageIdx);
          if (!iterator) {
            iterator = decoders[imageIdx].scanlines();
            iterators.set(imageIdx, iterator);
          }

          const scanline = await readConvertedScanline(
            iterator,
            imageIdx,
            headers[imageIdx],
            localY,
            outputHeader,
            bytesPerPixel,
            `while assembling row ${row + 1}, column ${col + 1}`
          );
          output.set(scanline, x * bytesPerPixel);
          progress?.rowRead(imageIdx);
        }

        x += rowColWidths[col];
      }

      yield output;
    }
  }
}

/**
 * Produce full-width output scanlines for positioned mode, compositing
 * overlapping images in z-order and handling clipping.
 */
async function* generatePositionedScanlines(
  scanlineIndex: ScanlineIndex,
  clipByImage: Map<number, ClippedImageInfo>,
  decoders: ImageDecoder[],
  headers: PngHeader[],
  outputHeader: PngHeader,
  bytesPerPixel: number,
  background: Uint8Array,
  useAlphaBlending: boolean,
  progress?: ProgressTracker
): AsyncGenerator<Uint8Array> {
  const iterators = new Map<number, AsyncGenerator<Uint8Array>>();
  const rowsRead = new Array<number>(headers.length).fill(0);
  const backgroundRow = createFilledScanline(outputHeader.width, bytesPerPixel, background);

  for (let outputY = 0; outputY < outputHeader.height; outputY++) {
    const output = backgroundRow.slice();
    const intersections = scanlineIndex.get(outputY);

    for (const { imageIdx, localY, startX, endX } of intersections ?? []) {
      const clipInfo = clipByImage.get(imageIdx);
      const sourceRow = localY + (clipInfo?.sourceOffsetY ?? 0);
      const where = `at Y=${outputY}`;

      let iterator = iterators.get(imageIdx);
      if (!iterator) {
        iterator = decoders[imageIdx].scanlines();
        iterators.set(imageIdx, iterator);
      }

      // Skip rows clipped off the top of the canvas
      while (rowsRead[imageIdx] < sourceRow) {
        const { done } = await iterator.next();
        if (done) {
          throw createStitchError(
            `dimension mismatch for input #${imageIdx + 1} ${where}. ` +
              `Expected ${formatPixels(headers[imageIdx].height)} tall image but decoder ended after ${formatPixels(rowsRead[imageIdx])}.`
          );
        }
        rowsRead[imageIdx]++;
        progress?.rowRead(imageIdx);
      }

      const scanline = await readConvertedScanline(
        iterator,
        imageIdx,
        headers[imageIdx],
        rowsRead[imageIdx],
        outputHeader,
        bytesPerPixel,
        where
      );
      rowsRead[imageIdx]++;
      progress?.rowRead(imageIdx);

      const width = endX - startX;
      const visible = clipInfo
        ? extractScanlinePortion(scanline, clipInfo.sourceOffsetX, width, bytesPerPixel)
        : scanline;

      compositeScanline(output, visible, startX, width, bytesPerPixel, useAlphaBlending);
    }

    yield output;
  }
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

/**
 * Encode unfiltered scanlines as a PNG, yielding chunks as they are compressed
 */
async function* encodePng(
  scanlines: AsyncIterable<Uint8Array>,
  header: PngHeader,
  bytesPerPixel: number
): AsyncGenerator<Uint8Array> {
  yield PNG_SIGNATURE;
  yield serializeChunk(createIHDR(header));

  const MAX_BATCH_BYTES = 1024 * 1024;
  const scanlineSize = header.width * bytesPerPixel + 1;
  const flushEvery = Math.max(50, Math.floor(MAX_BATCH_BYTES / scanlineSize));

  const deflator = new StreamingDeflator({ level: 6, maxBatchSize: MAX_BATCH_BYTES });
  const compressed: Uint8Array[] = [];
  await deflator.initialize((data) => {
    if (data && data.length > 0) {
      compressed.push(data);
    }
  });

  let previous: Uint8Array | null = null;
  let count = 0;

  for await (const scanline of scanlines) {
    const { filterType, filtered } = filterScanline(scanline, previous, bytesPerPixel);
    const withFilterByte = new Uint8Array(1 + filtered.length);
    withFilterByte[0] = filterType;
    withFilterByte.set(filtered, 1);

    await deflator.push(withFilterByte);
    previous = scanline;

    if (++count % flushEvery === 0) {
      await deflator.flush();
    }

    while (compressed.length > 0) {
      yield serializeChunk(createChunk('IDAT', compressed.shift()!));
    }
  }

  await deflator.finish();
  while (compressed.length > 0) {
    yield serializeChunk(createChunk('IDAT', compressed.shift()!));
  }

  yield serializeChunk(createIEND());
}

/**
 * Encode 8-bit RGBA scanlines as a baseline JPEG, buffering 8-row MCU strips
 */
async function* encodeJpeg(
  scanlines: AsyncIterable<Uint8Array>,
  width: number,
  height: number,
  quality: number
): AsyncGenerator<Uint8Array> {
  const encoder = new JpegEncoder({ width, height, quality });
  yield* encoder.header();

  const MCU_HEIGHT = 8;
  const rowBytes = width * 4;
  let strip = new Uint8Array(rowBytes * MCU_HEIGHT);
  let linesInStrip = 0;
  let lastScanline: Uint8Array | null = null;

  for await (const scanline of scanlines) {
    strip.set(scanline, linesInStrip * rowBytes);
    lastScanline = scanline;
    linesInStrip++;

    if (linesInStrip === MCU_HEIGHT) {
      yield* encoder.encodeStrip(strip, null);
      linesInStrip = 0;
      strip = new Uint8Array(rowBytes * MCU_HEIGHT);
    }
  }

  if (linesInStrip > 0) {
    // Partial final strip: the encoder repeats the last row to fill the MCU
    yield* encoder.encodeStrip(strip.subarray(0, linesInStrip * rowBytes), lastScanline);
  }

  yield* encoder.finish();
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Concatenate images with streaming (minimal memory usage)
 *
 * Supports PNG, JPEG, and HEIC inputs with automatic format detection, and
 * PNG (lossless, default) or JPEG (lossy) output.
 *
 * @example
 * for await (const chunk of concatStreaming({
 *   inputs: ['photo.jpg', 'image.png', 'pic.heic'],
 *   layout: { columns: 3 }
 * })) {
 *   // write chunk somewhere
 * }
 */
async function* coreConcatStreaming(
  options: ConcatOptions
): AsyncGenerator<Uint8Array> {
  const concatenator = new CoreStreamingConcatenator(options);
  yield* concatenator.stream();
}

/**
 * Concatenate images and return the encoded output as a Uint8Array.
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
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

const StreamingConcatenator = CoreStreamingConcatenator;

export { CoreStreamingConcatenator, StreamingConcatenator };

export { coreConcatStreaming as concatStreaming };

export { concatCore as concat };
