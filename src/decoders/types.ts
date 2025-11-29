/**
 * Image format types supported by the library
 */
export type ImageFormat = 'png' | 'jpeg' | 'heic' | 'unknown';

/**
 * Generic image header information, format-agnostic
 */
export interface ImageHeader {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Number of color channels (1=grayscale, 3=RGB, 4=RGBA) */
  channels: number;
  /** Bits per channel (typically 8 or 16) */
  bitDepth: number;
  /** Original image format */
  format: ImageFormat;
  /** Additional format-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Universal image decoder interface
 *
 * All format-specific decoders (PNG, JPEG, HEIC) implement this interface,
 * providing a unified way to access image data regardless of the source format.
 *
 * The interface is designed for streaming/progressive access to minimize memory usage:
 * - getHeader() provides metadata without decoding the full image
 * - scanlines() yields pixel data row-by-row as Uint8Array (RGBA format)
 * - close() releases resources (file handles, decoded buffers, etc.)
 */
export interface ImageDecoder {
  /**
   * Get the image header information
   *
   * This should be efficient and not require decoding the entire image.
   * For formats like JPEG/HEIC where full decode is needed, implementations
   * may cache the decoded result for subsequent scanline() calls.
   *
   * @returns Promise resolving to image header metadata
   */
  getHeader(): Promise<ImageHeader>;

  /**
   * Stream scanlines (rows) of pixel data on-demand
   *
   * Each scanline is returned as uncompressed RGBA pixel data:
   * - Format: R, G, B, A, R, G, B, A, ... (or R, G, B if no alpha)
   * - Byte order: row-by-row, left-to-right
   * - Length: width × channels × (bitDepth / 8)
   *
   * For formats that can't stream (JPEG, HEIC), implementations decode once
   * and yield scanlines progressively from the decoded buffer.
   *
   * @yields Uint8Array for each scanline (raw pixel data, no filter bytes)
   */
  scanlines(): AsyncGenerator<Uint8Array>;

  /**
   * Clean up any resources
   *
   * Releases file handles, decoded image buffers, and any other resources.
   * Should be called when done processing the image to free memory.
   *
   * @returns Promise that resolves when cleanup is complete
   */
  close(): Promise<void>;
}

/**
 * Options for creating image decoders
 */
export interface DecoderOptions {
  /** JPEG-specific decoding options */
  jpeg?: JpegDecoderOptions;
  /** HEIC-specific decoding options */
  heic?: HeicDecoderOptions;
}

/**
 * JPEG decoder configuration
 */
export interface JpegDecoderOptions {
  /** Prefer WASM decoder over native implementations */
  preferWasm?: boolean;
  /** Maximum memory usage per image in MB (for memory-constrained environments) */
  maxMemoryMB?: number;
  /** Use ImageDecoder API in browsers if available (default: true) */
  useImageDecoderAPI?: boolean;
}

/**
 * HEIC decoder configuration
 */
export interface HeicDecoderOptions {
  /** Custom path to libheif WASM files */
  wasmPath?: string;
  /** Use native browser support if available (Safari) (default: true) */
  useNativeIfAvailable?: boolean;
  /** Maximum memory usage per image in MB */
  maxMemoryMB?: number;
}

/**
 * Positioned image with explicit canvas coordinates
 * Allows placing images at arbitrary positions with potential overlapping
 */
export interface PositionedImage {
  /** X coordinate on canvas (left edge) */
  x: number;
  /** Y coordinate on canvas (top edge) */
  y: number;
  /** Optional z-index override for draw order (higher = rendered later) */
  zIndex?: number;
  /** Image source (any of the standard input types) */
  source: string | Uint8Array | ArrayBuffer | ImageDecoder | ImageSource;
}

/**
 * Factory function that returns image data
 */
export type ImageFactory = () => Promise<Blob | ArrayBuffer | Uint8Array>;

/**
 * Source for lazily loaded images
 */
export interface ImageSource {
  /** Width of the image in pixels */
  width: number;
  /** Height of the image in pixels */
  height: number;
  /** Function that returns the full image data */
  factory: ImageFactory;
}

/**
 * Type for image input sources
 */
export type ImageInput = string | Uint8Array | ArrayBuffer | ImageDecoder | PositionedImage | ImageSource;

/**
 * Plugin interface for registering decoder implementations.
 *
 * Plugins allow optional formats (like JPEG/HEIC) to be tree-shaken from
 * browser-focused bundles while remaining available for Node.js usage.
 */
export interface DecoderPlugin {
  /** Image format handled by this plugin */
  format: Exclude<ImageFormat, 'unknown'>;
  /**
   * Create a decoder for the provided input.
   * Implementations should throw when the input type is unsupported.
   */
  create(input: ImageInput, options?: DecoderOptions): Promise<ImageDecoder>;
}
