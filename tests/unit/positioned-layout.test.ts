import { test } from 'node:test';
import assert from 'node:assert';
import {
  calculateCanvasSize,
  clipImagesToCanvas,
  buildScanlineIndex,
  type PositionedImageInfo
} from '../../src/positioned-layout.js';
import type { PngHeader } from '../../src/types.js';
import { ColorType } from '../../src/types.js';

function createHeader(width: number, height: number): PngHeader {
  return {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };
}

test('calculateCanvasSize: explicit dimensions', () => {
  const positions = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 150, y: 150, width: 50, height: 50 }
  ];

  const size = calculateCanvasSize(positions, 500, 400);
  assert.strictEqual(size.width, 500);
  assert.strictEqual(size.height, 400);
});

test('calculateCanvasSize: auto-calculate from image bounds', () => {
  const positions = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 150, y: 50, width: 50, height: 75 }
  ];

  const size = calculateCanvasSize(positions);
  assert.strictEqual(size.width, 200); // 150 + 50
  assert.strictEqual(size.height, 125); // 50 + 75
});

test('calculateCanvasSize: explicit width only', () => {
  const positions = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 0, y: 150, width: 50, height: 50 }
  ];

  const size = calculateCanvasSize(positions, 300, undefined);
  assert.strictEqual(size.width, 300);
  assert.strictEqual(size.height, 200); // 150 + 50
});

test('calculateCanvasSize: empty positions', () => {
  const size = calculateCanvasSize([]);
  assert.strictEqual(size.width, 1);  // Minimum size
  assert.strictEqual(size.height, 1);
});

test('clipImagesToCanvas: no clipping needed', () => {
  const positions = [
    { x: 0, y: 0 },
    { x: 100, y: 0 }
  ];
  const headers = [
    createHeader(100, 100),
    createHeader(100, 100)
  ];

  const result = clipImagesToCanvas(positions, headers, 200, 100, () => {});

  assert.strictEqual(result.clippedImages.length, 0);
  assert.strictEqual(result.positionedImages.length, 2);
  assert.deepStrictEqual(result.positionedImages[0], {
    imageIdx: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    currentScanline: 0
  });
});

test('clipImagesToCanvas: clip left edge', () => {
  const positions = [{ x: -25, y: 0 }];
  const headers = [createHeader(100, 100)];

  const logs: string[] = [];
  const logger = (msg: string) => logs.push(msg);

  const result = clipImagesToCanvas(positions, headers, 200, 100, logger);

  assert.strictEqual(result.clippedImages.length, 1);
  assert.strictEqual(result.clippedImages[0].fullyClipped, false);
  assert.strictEqual(result.clippedImages[0].sourceOffsetX, 25);
  assert.strictEqual(result.clippedImages[0].sourceOffsetY, 0);
  assert.strictEqual(result.clippedImages[0].clippedX, 0);
  assert.strictEqual(result.clippedImages[0].clippedWidth, 75);

  assert.strictEqual(result.positionedImages.length, 1);
  assert.strictEqual(result.positionedImages[0].x, 0);
  assert.strictEqual(result.positionedImages[0].width, 75);

  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /clipped.*left by 25px/i);
});

test('clipImagesToCanvas: clip right edge', () => {
  const positions = [{ x: 150, y: 0 }];
  const headers = [createHeader(100, 100)];

  const logs: string[] = [];
  const result = clipImagesToCanvas(positions, headers, 200, 100, (msg) => logs.push(msg));

  assert.strictEqual(result.clippedImages.length, 1);
  assert.strictEqual(result.clippedImages[0].clippedWidth, 50); // Only 50px visible
  assert.strictEqual(result.positionedImages[0].width, 50);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /clipped.*right by 50px/i);
});

test('clipImagesToCanvas: clip top edge', () => {
  const positions = [{ x: 0, y: -30 }];
  const headers = [createHeader(100, 100)];

  const logs: string[] = [];
  const result = clipImagesToCanvas(positions, headers, 100, 100, (msg) => logs.push(msg));

  assert.strictEqual(result.clippedImages[0].sourceOffsetY, 30);
  assert.strictEqual(result.clippedImages[0].clippedY, 0);
  assert.strictEqual(result.clippedImages[0].clippedHeight, 70);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /clipped.*top by 30px/i);
});

test('clipImagesToCanvas: clip bottom edge', () => {
  const positions = [{ x: 0, y: 80 }];
  const headers = [createHeader(100, 100)];

  const logs: string[] = [];
  const result = clipImagesToCanvas(positions, headers, 100, 100, (msg) => logs.push(msg));

  assert.strictEqual(result.clippedImages[0].clippedHeight, 20);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /clipped.*bottom by 80px/i);
});

test('clipImagesToCanvas: clip multiple edges', () => {
  const positions = [{ x: -10, y: -20 }];
  const headers = [createHeader(150, 150)];

  const logs: string[] = [];
  const result = clipImagesToCanvas(positions, headers, 100, 100, (msg) => logs.push(msg));

  // Image at (-10, -20) with size 150x150 on 100x100 canvas
  // X: -10 to 140, clipped to 0-100 = 100px wide, offset by 10
  // Y: -20 to 130, clipped to 0-100 = 100px tall, offset by 20
  assert.strictEqual(result.clippedImages[0].sourceOffsetX, 10);
  assert.strictEqual(result.clippedImages[0].sourceOffsetY, 20);
  assert.strictEqual(result.clippedImages[0].clippedX, 0);
  assert.strictEqual(result.clippedImages[0].clippedY, 0);
  assert.strictEqual(result.clippedImages[0].clippedWidth, 100);
  assert.strictEqual(result.clippedImages[0].clippedHeight, 100);

  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /clipped.*left by 10px.*top by 20px.*right by 40px.*bottom by 30px/i);
});

test('clipImagesToCanvas: fully outside (left)', () => {
  const positions = [{ x: -150, y: 0 }];
  const headers = [createHeader(100, 100)];

  const logs: string[] = [];
  const result = clipImagesToCanvas(positions, headers, 100, 100, (msg) => logs.push(msg));

  assert.strictEqual(result.clippedImages.length, 1);
  assert.strictEqual(result.clippedImages[0].fullyClipped, true);
  assert.strictEqual(result.positionedImages.length, 0);

  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /completely outside canvas/i);
});

test('clipImagesToCanvas: fully outside (right)', () => {
  const positions = [{ x: 200, y: 0 }];
  const headers = [createHeader(100, 100)];

  const logs: string[] = [];
  const result = clipImagesToCanvas(positions, headers, 100, 100, (msg) => logs.push(msg));

  assert.strictEqual(result.clippedImages[0].fullyClipped, true);
  assert.strictEqual(result.positionedImages.length, 0);
  assert.match(logs[0], /completely outside canvas/i);
});

test('buildScanlineIndex: single image', () => {
  const positionedImages: PositionedImageInfo[] = [
    {
      imageIdx: 0,
      x: 10,
      y: 20,
      width: 50,
      height: 30,
      currentScanline: 0
    }
  ];

  const index = buildScanlineIndex(positionedImages, 100);

  // Check scanlines before image
  assert.strictEqual(index.has(19), false);

  // Check scanlines within image
  for (let y = 20; y < 50; y++) {
    assert.strictEqual(index.has(y), true, `Scanline ${y} should exist`);
    const intersections = index.get(y)!;
    assert.strictEqual(intersections.length, 1);
    assert.strictEqual(intersections[0].imageIdx, 0);
    assert.strictEqual(intersections[0].localY, y - 20);
    assert.strictEqual(intersections[0].startX, 10);
    assert.strictEqual(intersections[0].endX, 60);
    assert.strictEqual(intersections[0].zIndex, 0);
  }

  // Check scanlines after image
  assert.strictEqual(index.has(50), false);
});

test('buildScanlineIndex: non-overlapping images', () => {
  const positionedImages: PositionedImageInfo[] = [
    { imageIdx: 0, x: 0, y: 0, width: 50, height: 50, currentScanline: 0 },
    { imageIdx: 1, x: 50, y: 0, width: 50, height: 50, currentScanline: 0 }
  ];

  const index = buildScanlineIndex(positionedImages, 100);

  // Scanline 25 should have both images side by side
  const intersections = index.get(25)!;
  assert.strictEqual(intersections.length, 2);

  // Check z-order (should be sorted)
  assert.strictEqual(intersections[0].imageIdx, 0);
  assert.strictEqual(intersections[0].zIndex, 0);
  assert.strictEqual(intersections[1].imageIdx, 1);
  assert.strictEqual(intersections[1].zIndex, 1);
});

test('buildScanlineIndex: overlapping images', () => {
  const positionedImages: PositionedImageInfo[] = [
    { imageIdx: 0, x: 0, y: 0, width: 100, height: 100, currentScanline: 0 },
    { imageIdx: 1, x: 50, y: 50, width: 100, height: 100, currentScanline: 0 }
  ];

  const index = buildScanlineIndex(positionedImages, 200);

  // Scanline 25 should only have image 0
  const intersections25 = index.get(25)!;
  assert.strictEqual(intersections25.length, 1);
  assert.strictEqual(intersections25[0].imageIdx, 0);

  // Scanline 75 should have both images (overlapping)
  const intersections75 = index.get(75)!;
  assert.strictEqual(intersections75.length, 2);
  assert.strictEqual(intersections75[0].imageIdx, 0); // Back
  assert.strictEqual(intersections75[0].zIndex, 0);
  assert.strictEqual(intersections75[1].imageIdx, 1); // Front
  assert.strictEqual(intersections75[1].zIndex, 1);

  // Scanline 125 should only have image 1
  const intersections125 = index.get(125)!;
  assert.strictEqual(intersections125.length, 1);
  assert.strictEqual(intersections125[0].imageIdx, 1);
});

test('buildScanlineIndex: empty scanlines', () => {
  const positionedImages: PositionedImageInfo[] = [
    { imageIdx: 0, x: 0, y: 0, width: 50, height: 50, currentScanline: 0 },
    { imageIdx: 1, x: 0, y: 100, width: 50, height: 50, currentScanline: 0 }
  ];

  const index = buildScanlineIndex(positionedImages, 200);

  // Scanlines 0-49 should have image 0
  assert.strictEqual(index.has(25), true);

  // Scanlines 50-99 should be empty
  assert.strictEqual(index.has(75), false);

  // Scanlines 100-149 should have image 1
  assert.strictEqual(index.has(125), true);

  // Scanlines 150-199 should be empty
  assert.strictEqual(index.has(175), false);
});

test('buildScanlineIndex: z-order preservation', () => {
  const positionedImages: PositionedImageInfo[] = [
    { imageIdx: 2, x: 0, y: 0, width: 100, height: 100, currentScanline: 0 },
    { imageIdx: 5, x: 25, y: 25, width: 100, height: 100, currentScanline: 0 },
    { imageIdx: 1, x: 50, y: 50, width: 100, height: 100, currentScanline: 0 }
  ];

  const index = buildScanlineIndex(positionedImages, 200);

  // Scanline 75 should have all three images
  const intersections = index.get(75)!;
  assert.strictEqual(intersections.length, 3);

  // Z-order should match input order
  assert.strictEqual(intersections[0].imageIdx, 2);
  assert.strictEqual(intersections[0].zIndex, 0);
  assert.strictEqual(intersections[1].imageIdx, 5);
  assert.strictEqual(intersections[1].zIndex, 1);
  assert.strictEqual(intersections[2].imageIdx, 1);
  assert.strictEqual(intersections[2].zIndex, 2);
});
