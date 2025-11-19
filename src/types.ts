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
   *
   * Supports two modes:
   * 1. Grid mode: Regular image inputs arranged in rows/columns
   * 2. Positioned mode: PositionedImage objects with explicit x,y coordinates
   *    - Images can be placed anywhere on the canvas
   *    - Images can overlap (later images drawn on top)
   *    - If ANY input is positioned, ALL inputs must be positioned
   */
  inputs: ImageInputSource;

  /** Layout configuration */
  layout: {
    /** Number of images per row (horizontal concatenation) - ignored in positioned mode */
    columns?: number;
    /** Number of images per column (vertical concatenation) - ignored in positioned mode */
    rows?: number;
    /**
     * Output width in pixels
     * - Grid mode: alternative to columns
     * - Positioned mode: canvas width (auto-calculated from image bounds if omitted)
     */
    width?: number;
    /**
     * Output height in pixels
     * - Grid mode: alternative to rows
     * - Positioned mode: canvas height (auto-calculated from image bounds if omitted)
     */
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
   * Output format (PNG or JPEG)
   * - 'png': Lossless PNG format (default)
   * - 'jpeg': Lossy JPEG format
   */
  outputFormat?: 'png' | 'jpeg';

  /**
   * JPEG quality (1-100, default: 85)
   * Only applies when outputFormat is 'jpeg'
   * Higher values = better quality but larger file size
   */
  jpegQuality?: number;

  /**
   * Background color for padding areas (when source images don't fill the output)
   *
   * Supports multiple formats:
   * - Hex colors: '#RRGGBB', '#RRGGBBAA', '#RGB', '#RGBA'
   * - RGB/RGBA arrays: [r, g, b] or [r, g, b, a] with values 0-255
   * - Named colors: 'transparent' (default), 'black', 'white', 'red', 'green', 'blue'
   *
   * Default: 'transparent' (rgba(0, 0, 0, 0))
   *
   * For JPEG output (which doesn't support transparency):
   * - Transparent colors are composited as black
   * - Specify an opaque color for better control
   *
   * @example
   * backgroundColor: '#FF0000'      // Red
   * backgroundColor: '#FF0000AA'    // Semi-transparent red
   * backgroundColor: [255, 0, 0]    // Red (RGB)
   * backgroundColor: [255, 0, 0, 128] // Semi-transparent red (RGBA)
   * backgroundColor: 'white'        // White
   */
  backgroundColor?: string | [number, number, number] | [number, number, number, number];

  /**
   * Enable alpha blending for overlapping positioned images
   *
   * When true, overlapping images are blended using the alpha channel.
   * When false, later images completely replace earlier images (faster).
   *
   * Only applies to positioned mode. Ignored in grid mode.
   *
   * Default: true
   */
  enableAlphaBlending?: boolean;

  /**
   * Optional progress callback invoked when each input image finishes streaming.
   * Receives the number of completed inputs and the total inputs to process.
   */
  onProgress?: (completed: number, total: number) => void;
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
