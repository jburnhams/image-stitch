import type { PngInput, PngInputAdapter } from './png-input-adapter.js';

/**
 * PNG chunk structure
 */
export interface PngChunk {
  length: number;
  type: string;
  data: Uint8Array;
  crc: number;
}

/**
 * PNG image header (IHDR) information
 */
export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compressionMethod: number;
  filterMethod: number;
  interlaceMethod: number;
}

/**
 * Configuration for PNG concatenation
 */
export type PngInputSource =
  | Array<Uint8Array | ArrayBuffer | string | PngInputAdapter>
  | Iterable<PngInput>
  | AsyncIterable<PngInput>;

export interface ConcatOptions {
  /**
   * Input PNG sources. Can be an array, iterable, or async iterable of inputs.
   * Async iterables allow lazily generating tiles so large grids do not require
   * allocating every image up front.
   */
  inputs: PngInputSource;
  /** Layout configuration */
  layout: {
    /** Number of images per row (horizontal concatenation) */
    columns?: number;
    /** Number of images per column (vertical concatenation) */
    rows?: number;
    /** Output width in pixels (alternative to columns) */
    width?: number;
    /** Output height in pixels (alternative to rows) */
    height?: number;
  };
}

/**
 * PNG color types
 */
export enum ColorType {
  GRAYSCALE = 0,
  RGB = 2,
  PALETTE = 3,
  GRAYSCALE_ALPHA = 4,
  RGBA = 6
}
