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
- **Browser bundlers** – Vite, webpack and other bundlers that use the `browser` condition pick up the browser build
  automatically when you `import 'image-stitch'`. You can also import `image-stitch/bundle` explicitly (it has its own
  types, including `concatCanvases`). The browser build ships with PNG and JPEG decoding; add HEIC only when you need it.
- **Browser global** – drop `<script src="https://cdn.jsdelivr.net/npm/image-stitch/dist/browser/image-stitch.min.js"></script>` into any page and use `window.ImageStitch`.
- **Node.js specific** – `import ... from 'image-stitch/node'` ensures you get the full Node.js build (useful for JSDOM testing).
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

### Layouts

Choose which images share a row:

- `{ columns: n }` or `{ rows: n }` gives a fixed grid, filled row by row (or column by column).
- `{ width: px }` and/or `{ height: px }` gives a flow layout: images fill a row left to right and wrap when the next one
  would make the row wider than `width`. Add `columns` or `rows` to cap it further. Images that do not fit within a
  `height` or `rows` limit are left out, with a console warning.

Then choose how the cells line up. The two settings are independent:

| `alignRows` | `alignColumns` | Result |
| --- | --- | --- |
| `true` (default) | `false` (default) | Rows line up; images in each row are packed side by side |
| `true` | `true` | Full grid: every column as wide as its widest image, every row as tall as its tallest |
| `false` | `true` | Columns line up and each column stacks its images with no gaps (masonry) |
| `false` | `false` | No grid: images are packed side by side and each one sits directly on whatever is above it |

```ts
await concatToBuffer({
  inputs: photos,
  layout: { columns: 3, alignColumns: true, alignRows: false } // masonry columns
});
```

`alignColumns` only applies to `columns`/`rows` grids, because flow rows hold different numbers of images. Gaps are
filled with `backgroundColor` (transparent by default).

### Write straight to a file (Node.js)

```ts
import { concatToFile, concatToStream } from 'image-stitch';

// Streams to disk, so the full output is never held in memory
await concatToFile({ inputs: ['a.png', 'b.png'], layout: { columns: 2 } }, 'stitched.png');

// Or pipe a Readable wherever you like
concatToStream({ inputs: ['a.png', 'b.png'], layout: { columns: 2 } }).pipe(process.stdout);
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

👉 Read the full guides, API docs, and interactive demos at [image-stitch GitHub Pages](https://jburnhams.github.io/image-stitch/).

## Browser bundle & optional decoders

The browser bundle registers the PNG and JPEG decoders by default. HEIC support is heavier, so opt in with a plugin
(pass every decoder you need, because `decoders` replaces the defaults):

```ts
import { concatToBuffer } from 'image-stitch/bundle';
import { pngDecoder } from 'image-stitch/decoders/png';
import { jpegDecoder } from 'image-stitch/decoders/jpeg';
import { heicDecoder } from 'image-stitch/decoders/heic';

await concatToBuffer({
  inputs: [pngBytes, jpegBytes, heicBytes],
  layout: { columns: 3 },
  decoders: [pngDecoder, jpegDecoder, heicDecoder]
});
```

Node.js imports (`import { concatToBuffer } from 'image-stitch'`) continue to register PNG, JPEG, and HEIC decoders automatically.

## Environment Support

`image-stitch` supports Node.js, modern browsers, and hybrid environments like JSDOM.

### Node.js

Standard usage works out of the box with `npm install image-stitch`.
Node environments automatically use efficient native libraries (like `sharp` if installed) or pure JS fallbacks (`jpeg-js`, `pako`).

### JSDOM & Testing

For JSDOM environments (e.g. Jest/Vitest tests), you can ensure robust behavior by using the Node-specific export or configuring custom constructors.

**Option 1: Force Node Logic (Recommended)**

Import from `image-stitch/node` to bypass browser bundles and use Node.js capabilities (file system, streams, buffers) even if JSDOM mocks browser globals.

```ts
import { concatToBuffer } from 'image-stitch/node';
// Uses Node.js logic and dependencies (pako, jpeg-js, etc.)
```

**Option 2: Dependency Injection**

If you prefer to use browser-like APIs (Canvas) in your tests, you can inject compatible constructors (like `napi-rs/canvas` or `canvas`).

```ts
import { concatToBuffer } from 'image-stitch';
import { Image, Canvas } from '@napi-rs/canvas';

await concatToBuffer({
  inputs: [...],
  layout: { columns: 2 },
  decoderOptions: {
    customConstructors: { Image, Canvas } // injected constructors
  }
});
```
