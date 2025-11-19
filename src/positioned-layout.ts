/**
 * Positioned Image Layout
 *
 * Preprocessing and data structures for efficient positioned image rendering.
 * Builds a scanline index to enable streaming with positioned images.
 */

import type { PngHeader } from './types.js';

/**
 * Information about a positioned image
 */
export interface PositionedImageInfo {
  /** Index into the decoders array */
  imageIdx: number;
  /** X position on canvas (left edge) */
  x: number;
  /** Y position on canvas (top edge) */
  y: number;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Current scanline position (incremented as we read) */
  currentScanline: number;
}

/**
 * Describes where an image intersects a specific output scanline
 */
export interface ScanlineIntersection {
  /** Index into the decoders array */
  imageIdx: number;
  /** Scanline number within the source image (0-indexed) */
  localY: number;
  /** X coordinate where this image starts on the output scanline */
  startX: number;
  /** X coordinate where this image ends on the output scanline (exclusive) */
  endX: number;
  /** Z-order for overlapping images (input order) */
  zIndex: number;
}

/**
 * Clipping information for images outside canvas bounds
 */
export interface ClippedImageInfo {
  /** Index into the inputs array */
  imageIdx: number;
  /** Original position */
  originalX: number;
  originalY: number;
  /** Original dimensions */
  originalWidth: number;
  originalHeight: number;
  /** Clipped position */
  clippedX: number;
  clippedY: number;
  /** Clipped dimensions */
  clippedWidth: number;
  clippedHeight: number;
  /** Source region to read (pixels to skip) */
  sourceOffsetX: number;
  sourceOffsetY: number;
  /** Whether image was fully clipped */
  fullyClipped: boolean;
}

/**
 * Index structure mapping output Y coordinates to intersecting images
 */
export type ScanlineIndex = Map<number, ScanlineIntersection[]>;

/**
 * Calculate canvas dimensions from positioned images
 * If explicit dimensions provided, use those; otherwise auto-calculate
 */
export function calculateCanvasSize(
  positionedImages: Array<{ x: number; y: number; width: number; height: number }>,
  explicitWidth?: number,
  explicitHeight?: number
): { width: number; height: number } {
  if (explicitWidth !== undefined && explicitHeight !== undefined) {
    return { width: explicitWidth, height: explicitHeight };
  }

  let maxRight = 0;
  let maxBottom = 0;

  for (const img of positionedImages) {
    maxRight = Math.max(maxRight, img.x + img.width);
    maxBottom = Math.max(maxBottom, img.y + img.height);
  }

  return {
    width: explicitWidth ?? Math.max(1, maxRight),
    height: explicitHeight ?? Math.max(1, maxBottom)
  };
}

/**
 * Clip positioned images to canvas bounds
 * Returns clipping information and logs warnings for clipped images
 */
export function clipImagesToCanvas(
  positions: Array<{ x: number; y: number }>,
  headers: PngHeader[],
  canvasWidth: number,
  canvasHeight: number,
  logger: (message: string) => void = console.warn
): {
  clippedImages: ClippedImageInfo[];
  positionedImages: PositionedImageInfo[];
} {
  const clippedImages: ClippedImageInfo[] = [];
  const positionedImages: PositionedImageInfo[] = [];

  for (let i = 0; i < positions.length; i++) {
    const { x, y } = positions[i];
    const header = headers[i];
    const { width, height } = header;

    // Calculate intersection with canvas
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(canvasWidth, x + width);
    const bottom = Math.min(canvasHeight, y + height);

    // Check if image is outside canvas bounds
    const isClipped = x < 0 || y < 0 || x + width > canvasWidth || y + height > canvasHeight;
    const fullyClipped = right <= left || bottom <= top;

    if (isClipped) {
      const clipInfo: ClippedImageInfo = {
        imageIdx: i,
        originalX: x,
        originalY: y,
        originalWidth: width,
        originalHeight: height,
        clippedX: left,
        clippedY: top,
        clippedWidth: fullyClipped ? 0 : right - left,
        clippedHeight: fullyClipped ? 0 : bottom - top,
        sourceOffsetX: Math.max(0, -x),
        sourceOffsetY: Math.max(0, -y),
        fullyClipped
      };
      clippedImages.push(clipInfo);

      // Log clipping warning
      if (fullyClipped) {
        logger(
          `Image #${i + 1} is completely outside canvas bounds: ` +
            `position=(${x}, ${y}), size=(${width}×${height}), canvas=(${canvasWidth}×${canvasHeight}). ` +
            `Image will not be rendered.`
        );
      } else {
        const clippedParts: string[] = [];
        if (x < 0) clippedParts.push(`left by ${-x}px`);
        if (y < 0) clippedParts.push(`top by ${-y}px`);
        if (x + width > canvasWidth) clippedParts.push(`right by ${x + width - canvasWidth}px`);
        if (y + height > canvasHeight) clippedParts.push(`bottom by ${y + height - canvasHeight}px`);

        logger(
          `Image #${i + 1} clipped (${clippedParts.join(', ')}): ` +
            `original=(${x}, ${y}, ${width}×${height}), ` +
            `visible=(${left}, ${top}, ${right - left}×${bottom - top}), ` +
            `canvas=(${canvasWidth}×${canvasHeight})`
        );
      }
    }

    // Only add to positioned images if not fully clipped
    if (!fullyClipped) {
      positionedImages.push({
        imageIdx: i,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        currentScanline: 0
      });
    }
  }

  return { clippedImages, positionedImages };
}

/**
 * Build scanline index for efficient positioned rendering
 *
 * For each output Y coordinate, creates a list of images that intersect
 * that scanline, sorted by z-order (input order = back to front).
 *
 * This allows the streaming renderer to know exactly which images to read
 * from on each scanline without needing to buffer the entire image.
 */
export function buildScanlineIndex(
  positionedImages: PositionedImageInfo[],
  canvasHeight: number
): ScanlineIndex {
  const index = new Map<number, ScanlineIntersection[]>();

  for (let outputY = 0; outputY < canvasHeight; outputY++) {
    const intersections: ScanlineIntersection[] = [];

    for (let i = 0; i < positionedImages.length; i++) {
      const img = positionedImages[i];

      // Does this image intersect this scanline?
      if (outputY >= img.y && outputY < img.y + img.height) {
        const localY = outputY - img.y;

        intersections.push({
          imageIdx: img.imageIdx,
          localY,
          startX: img.x,
          endX: img.x + img.width,
          zIndex: i // Input order = z-order
        });
      }
    }

    // Sort by zIndex so we composite in order (back to front)
    intersections.sort((a, b) => a.zIndex - b.zIndex);

    // Only store non-empty scanlines
    if (intersections.length > 0) {
      index.set(outputY, intersections);
    }
  }

  return index;
}

/**
 * Get the effective positioned image info for rendering
 * This accounts for clipping and source offsets
 */
export function getEffectivePositionedImages(
  positions: Array<{ x: number; y: number }>,
  headers: PngHeader[],
  canvasWidth: number,
  canvasHeight: number,
  logger?: (message: string) => void
): {
  positionedImages: PositionedImageInfo[];
  clippedImages: ClippedImageInfo[];
} {
  return clipImagesToCanvas(positions, headers, canvasWidth, canvasHeight, logger);
}
