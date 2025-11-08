# image-stitch

image-stitch combines PNG images into a single output without relying on Canvas APIs. It works in Node.js and modern browsers, including streaming scenarios for large images.

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
