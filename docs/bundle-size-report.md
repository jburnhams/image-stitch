# Bundle Size Analysis

## Size check status
- `npm run size` now passes: after removing the Node-only fallbacks from the browser bundle the generated ESM bundle (`dist/bundles/image-stitch.esm.js`) shrank to **113.31 KB** (limit 300 KB) and the browser IIFE (`dist/browser/image-stitch.min.js`) dropped to **49.57 KB** (limit 150 KB / 75 KB gzip). For historical context, the failing run captured below showed the ESM bundle at **306.74 KB**, exceeding the 300 KB limit enforced by `scripts/check-bundle-size.mjs` while the IIFE was 117.01 KB / 39.87 KB gzip.

## ESM bundle composition
The esbuild metafile for `dist/esm/bundle.js` shows that a small set of dependencies dominates the bundle size:

| Module / file | Bytes in bundle | Notes |
| --- | --- | --- |
| `node_modules/pako/dist/pako.esm.mjs` | 132,625 | Streaming deflate fallback pulled in via `StreamingDeflator`.
| `node_modules/jpeg-js/lib/decoder.js` | 40,673 | Node-only JPEG decode fallback.
| `node_modules/jpeg-js/lib/encoder.js` | 24,484 | Node-only JPEG encode helper.
| `dist/esm/image-concat-core.js` | 32,837 | Core stitching logic (expected cost).
| `dist/esm/pixel-ops.js` | 12,886 | Pixel manipulation routines shared by PNG/JPEG paths.
| `dist/esm/streaming-deflate.js` | 5,238 | Wrapper that dynamically loads `pako` when native compression is unavailable.
| `node_modules/jpeg-encoder-wasm/pkg/esm/*.js` | 9,450 | Thin wrappers around the JPEG encoder WASM module.

These files alone account for ~260 KB of the 307 KB payload.

## Why the heavy modules are included
- **`pako`** is only needed when `StreamingDeflator` falls back from the native `CompressionStream` API. That fallback is targeted at Node.js and very old browsers, yet the unconditional dynamic import in `src/streaming-deflate.ts` forces esbuild to bundle the entire library even when building the browser entry point. 【F:src/streaming-deflate.ts†L1-L109】
- **`jpeg-js`** (both decoder and encoder helpers) is used purely inside the Node.js code paths of the JPEG decoder when `sharp` is unavailable. The browser bundle still pulls it in because the dynamic import lives in `src/decoders/jpeg-decoder.ts`, which is shared between Node and browser builds. 【F:src/decoders/jpeg-decoder.ts†L171-L251】

## Opportunities to shrink the bundle safely
1. **Split browser vs. Node implementations for heavy components.** Creating browser-specific `StreamingDeflator` and `jpeg-decoder` modules (or adding `browser` conditions to `package.json`/esbuild config) would let the browser build avoid the `pako` and `jpeg-js` imports entirely, cutting ~200 KB while leaving the Node artifacts untouched.
2. **Mark optional peer dependencies as external during browser bundling.** Updating `scripts/build-bundles.mjs` to pass `external: ['pako', 'jpeg-js', 'sharp']` (and providing lightweight shims that throw in browser contexts) would prevent esbuild from bundling these modules when generating `dist/bundles`. Consumers who truly need the Node fallbacks would still get them when importing the ESM/CJS builds directly.
3. **Keep browser exports focused on browser-safe APIs.** `src/bundle.ts` re-exports everything from `image-concat-browser.ts`, including `concatToFile`, which immediately throws in browsers. Making the browser bundle export only the browser-ready helpers (buffer/canvas APIs and streaming concatenator) would reduce accidental pulls of Node-centric helpers.

Implementing (1) or (2) should be enough to bring `image-stitch.esm.js` well below the 300 KB limit without sacrificing functionality in supported environments.

## Remediation status
- **2025-11-19** – Implemented option (2) from above by stubbing `pako`, `jpeg-js`, and `sharp` during the bundle build so they are excluded from the browser artifacts while remaining available in the Node builds. This change reduced `dist/bundles/image-stitch.esm.js` to **113.31 KB** (was 306.74 KB) and the browser IIFE to **49.57 KB** (was 117.01 KB). The size check now passes again via `npm run size`. 【F:scripts/build-bundles.mjs†L66-L115】【96c0ad†L1-L37】
