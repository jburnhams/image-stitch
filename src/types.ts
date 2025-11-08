import type { ImageInput, DecoderOptions, DecoderPlugin } from './decoders/types.js';

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
 * Multi-format image input source type
 */
export type ImageInputSource =
  | Array<ImageInput>
  | Iterable<ImageInput>
  | AsyncIterable<ImageInput>;

/**
 * Legacy PNG-only input source type (for backward compatibility)
 * @deprecated Use ImageInputSource instead
 */
export type PngInputSource = ImageInputSource;

/**
 * Configuration for image concatenation (multi-format support)
 */
export interface ConcatOptions {
  /**
   * Input image sources (PNG, JPEG, HEIC).
   * Can be an array, iterable, or async iterable of inputs.
   * Async iterables allow lazily generating tiles so large grids do not require
   * allocating every image up front.
   */
  inputs: ImageInputSource;

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

  /**
   * Format-specific decoder options
   */
  decoderOptions?: DecoderOptions;

  /**
   * Explicit decoder plugins to use. If omitted, the runtime defaults are used.
   * Providing this enables tree-shaking optional formats out of browser bundles.
   */
  decoders?: DecoderPlugin[];

  /**
   * Output format (currently only PNG supported, future: JPEG, WebP)
   */
  outputFormat?: 'png';
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
