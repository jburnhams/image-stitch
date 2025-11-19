# image-stitch

image-stitch combines images into a single output without relying on Canvas APIs. It works in Node.js and modern browsers, including streaming scenarios for large images.

**Features:**
- **Multi-format input**: PNG, JPEG, HEIC with automatic format detection
- **Multi-format output**: PNG (lossless) or JPEG (lossy with quality control)
- **Streaming processing**: Minimal memory usage for large images
- **No canvas dependency**: Works in Node.js and browsers
- **Flexible layouts**: Grid, columns, rows, or positioned images with overlapping
- **Alpha blending**: Proper compositing for overlapping positioned images

## Install

```bash
npm install image-stitch
```

### Pick the right build

- **ESM (default)** – `import { concatToBuffer } from 'image-stitch'` resolves to `dist/esm/index.js` with rich type definitions.
- **CommonJS** – legacy bundlers or Node.js `require` load `dist/cjs/index.cjs` automatically.
- **Tree-shakeable bundle** – `import 'image-stitch/bundle'` for a single-file ESM artifact that keeps dependencies external. The
  browser bundle ships with PNG support out of the box; add JPEG/HEIC decoders only when you need them.
- **Browser global** – drop `<script src="https://cdn.jsdelivr.net/npm/image-stitch/dist/browser/image-stitch.min.js"></script>` into any page and use `window.ImageStitch`.
- **Deno** – `import { concatToBuffer } from 'npm:image-stitch/deno/mod.ts'` targets the ESM build with Node compatibility.

All bundles ship with source maps and `.d.ts` files so editors stay fully typed.

## Basic usage

```ts
import { concatToBuffer } from 'image-stitch';
import { readFileSync, writeFileSync } from 'fs';

const result = await concatToBuffer({
  inputs: [
    readFileSync('one.png'),
    readFileSync('two.png')
  ],
  layout: { columns: 2 }
});

writeFileSync('stitched.png', result);
```

### JPEG output

By default, image-stitch outputs PNG (lossless). You can also output JPEG (lossy) with configurable quality:

```ts
import { concatToBuffer } from 'image-stitch';

// Output as JPEG with custom quality
const result = await concatToBuffer({
  inputs: ['photo1.jpg', 'photo2.jpg', 'image.png'],
  layout: { columns: 3 },
  outputFormat: 'jpeg',  // 'png' (default) or 'jpeg'
  jpegQuality: 90        // 1-100, default: 85
});

writeFileSync('stitched.jpg', result);
```

JPEG output features:
- **Lossy compression** with configurable quality (1-100)
- **Smaller file sizes** compared to PNG for photos
- **8-bit RGBA format** (automatically converts higher bit depths)
- **Streaming support** via `concatToStream()` and `concatStreaming()`
- **Mixed inputs** - combine PNG, JPEG, HEIC inputs into JPEG output

### Positioned images (flexible layout)

Place images at arbitrary x,y coordinates with support for overlapping and alpha blending:

```ts
import { concatToBuffer, type PositionedImage } from 'image-stitch';

const inputs: PositionedImage[] = [
  { x: 0, y: 0, source: 'background.png' },
  { x: 50, y: 50, zIndex: 10, source: 'overlay.png' },      // Overlaps background with explicit zIndex
  { x: 200, y: 100, source: imageBuffer }
];

const result = await concatToBuffer({
  inputs,
  layout: {
    width: 500,    // Optional: canvas width (auto-calculated if omitted)
    height: 400    // Optional: canvas height (auto-calculated if omitted)
  },
  enableAlphaBlending: true  // Default: true (blend overlapping images)
});
```

Positioned image features:
- **Arbitrary placement** - position images anywhere on the canvas using x,y coordinates
- **Overlapping support** - images can overlap with proper alpha blending (z-order = input order or custom `zIndex`)
- **Auto canvas sizing** - canvas dimensions calculated from image bounds if not specified
- **Automatic clipping** - images outside canvas bounds are clipped with console warnings
- **Alpha blending** - optional blending for overlapping images (disable for faster compositing)
- **Streaming** - maintains O(canvas_width) memory usage, not O(total_pixels)

```ts
// Example: Create a composite with watermark
const composite = await concatToBuffer({
  inputs: [
    { x: 0, y: 0, source: 'photo.jpg' },
    { x: 420, y: 380, source: 'watermark.png' }  // Bottom-right corner
  ],
  layout: {},  // Canvas auto-sized to fit all images
  outputFormat: 'jpeg',
  jpegQuality: 90
});
```

### Track progress

Pass an `onProgress` callback to receive a counter whenever an input tile finishes streaming. The callback receives the number of
completed inputs and the total inputs in the operation, making it easy to update loading indicators while large grids process.

```ts
await concatToBuffer({
  inputs: tiles,
  layout: { rows: 4, columns: 4 },
  onProgress(current, total) {
    console.log(`Stitched ${current}/${total}`);
  }
});
```

👉 Read the full guides, API docs, and interactive demos at [image-stitch GitHub Pages](https://jburnhams.github.io/Png-concat/).

## Browser bundle & optional decoders

Modern browsers provide native HEIC/JPEG decoding primitives, so the browser-focused bundle keeps only the PNG decoder by
default. Opt in to extra formats with lightweight plugins:

```ts
import { concatToBuffer } from 'image-stitch/bundle';
import { jpegDecoder } from 'image-stitch/decoders/jpeg';
import { heicDecoder } from 'image-stitch/decoders/heic';

await concatToBuffer({
  inputs: [jpegBytes, heicBytes],
  layout: { columns: 2 },
  decoders: [jpegDecoder, heicDecoder]
});
```

Node.js imports (`import { concatToBuffer } from 'image-stitch'`) continue to register PNG, JPEG, and HEIC decoders automatically.
