# Image-Stitch Codebase Structure & JPEG Output Integration Overview

## Executive Summary

This is a streaming image concatenation library (5,198 lines of TypeScript) that currently outputs **PNG format only**. The architecture is designed for minimal memory usage, supporting multiple input formats (PNG, JPEG, HEIC) while converting everything to PNG output. To add JPEG output support, we need to introduce a new JPEG encoder while maintaining the streaming architecture.

---

## 1. Current Structure of `src/` Directory

### Top-Level Source Files (Core Functionality)
```
src/
├── index.ts                      # Main entry point & public API
├── types.ts                      # Global TypeScript interfaces
├── image-concat.ts               # Node.js wrapper around core
├── image-concat-core.ts          # Main streaming concatenation engine (723 lines)
├── image-concat-browser.ts       # Browser entry point
├── bundle.ts                     # Browser bundle entry point
│
├── PNG Processing (Output Format)
├── png-writer.ts                 # PNG chunk serialization
├── png-parser.ts                 # PNG header/chunk parsing
├── png-filter.ts                 # PNG scanline filtering (adaptive)
├── png-decompress.ts             # PNG decompression pipeline
├── png-input-adapter.ts          # PNG input abstraction
│
├── Image Processing
├── streaming-deflate.ts           # Streaming deflate compression (with native CompressionStream fallback)
├── pixel-ops.ts                  # Pixel format conversion & manipulation
├── adam7.ts                      # Adam7 interlacing support
├── utils.ts                      # Utility functions (CRC32, byte operations)
│
├── decoders/                     # Format-specific decoders
│   ├── types.ts                  # Decoder interfaces & plugin system
│   ├── format-detection.ts       # Magic number-based format detection
│   ├── decoder-factory.ts        # Unified decoder creation
│   ├── plugin-registry.ts        # Plugin registry for decoders
│   ├── png.ts                    # PNG decoder wrapper
│   ├── png-decoder.ts            # PNG decoder implementation
│   ├── jpeg.ts                   # JPEG decoder wrapper
│   ├── jpeg-decoder.ts           # JPEG decoder (supports sharp/jpeg-js in Node, Canvas in browser)
│   ├── heic.ts                   # HEIC decoder wrapper
│   └── heic-decoder.ts           # HEIC decoder implementation
```

### Architecture Highlights
- **Total: ~5,200 lines of TypeScript**
- **Modular Design**: Separate concerns - decoders, processors, writers
- **Plugin System**: Decoders registered via plugin architecture for tree-shaking in bundles
- **Streaming-First**: All operations work on scanlines (image rows) to minimize memory

---

## 2. How `src/types.ts` Defines Options & Interfaces

### Key Exports

#### **Main Options Interface - `ConcatOptions`** (lines 43-85)
```typescript
export interface ConcatOptions {
  inputs: ImageInputSource;           // Array, Iterable, or AsyncIterable of inputs
  layout: {
    columns?: number;                 // Images per row
    rows?: number;                    // Images per column
    width?: number;                   // Max output width in pixels
    height?: number;                  // Max output height in pixels
  };
  decoderOptions?: DecoderOptions;    // Format-specific decoder config
  decoders?: DecoderPlugin[];         // Explicit decoder plugins
  outputFormat?: 'png';               // CURRENTLY: ONLY 'png' IS SUPPORTED
  onProgress?: (completed: number, total: number) => void;
}
```

**IMPORTANT**: `outputFormat?: 'png'` shows that JPEG output is **not yet implemented**. This is where we need to extend the type system!

#### **Decoder System Interfaces** (decoders/types.ts, lines 35-126)
```typescript
// Generic image header (format-agnostic)
export interface ImageHeader {
  width: number;
  height: number;
  channels: number;                   // 1=grayscale, 3=RGB, 4=RGBA
  bitDepth: number;                   // 8 or 16
  format: ImageFormat;                // 'png' | 'jpeg' | 'heic' | 'unknown'
  metadata?: Record<string, unknown>;
}

// Universal decoder interface - ALL formats implement this
export interface ImageDecoder {
  getHeader(): Promise<ImageHeader>;              // Get metadata
  scanlines(): AsyncGenerator<Uint8Array>;        // Stream pixel data
  close(): Promise<void>;                         // Clean up resources
}

// Plugin interface for registration
export interface DecoderPlugin {
  format: Exclude<ImageFormat, 'unknown'>;
  create(input: ImageInput, options?: DecoderOptions): Promise<ImageDecoder>;
}
```

### Design Pattern Observations
1. **Format-Agnostic Architecture**: `ImageDecoder` interface lets any format work identically
2. **Plugin Registry Pattern**: Decoders are registered, not hardcoded
3. **Streaming Design**: `scanlines()` yields data progressively (not all at once)
4. **Options Limitation**: Currently only PNG output format is defined

---

## 3. How `src/image-concat-core.ts` Currently Handles PNG Output

### Architecture Overview (723 lines)

#### **Main Class: `CoreStreamingConcatenator`** (lines 277-655)

**Two-Pass Streaming Design**:

```
PASS 1: Header Collection
├─ Load decoders from all inputs
├─ Read headers from each decoder (format-agnostic)
├─ Convert ImageHeader → PngHeader using imageHeaderToPngHeader()
└─ Determine common format for all inputs

PASS 2: Streaming Scanline Processing
├─ Create iterators for each decoder
├─ For each output row:
│  ├─ Collect scanlines from all input images in that row
│  ├─ Convert pixel formats (JPEG RGB → PNG RGBA, etc.)
│  ├─ Combine scanlines horizontally
│  ├─ Apply PNG filtering
│  └─ Compress with deflate
└─ Write PNG chunks (IHDR, IDAT, IEND)
```

#### **Key Functions in Concatenation Flow**

1. **`imageHeaderToPngHeader()`** (lines 45-69)
   - Converts generic ImageHeader to PNG-specific PngHeader
   - Maps channel count to PNG color type:
     - 1 channel → Grayscale (type 0)
     - 2 channels → Grayscale + Alpha (type 4)
     - 3 channels → RGB (type 2)
     - 4 channels → RGBA (type 6)

2. **`stream()` Method** (lines 550-625) - Main Entry Point
   ```typescript
   async *stream(): AsyncGenerator<Uint8Array> {
     // PASS 1: Create decoders and read headers
     const decoderPlugins = this.options.decoders ?? getDefaultDecoderPlugins();
     const decoders = await createDecodersFromIterable(...);
     const imageHeaders = [];
     for (const decoder of decoders) {
       imageHeaders.push(await decoder.getHeader());
     }
     const headers = imageHeaders.map(imageHeaderToPngHeader);
     
     // Determine common format
     const { bitDepth, colorType } = determineCommonFormat(headers);
     
     // Calculate layout
     const layout = calculateLayout(headers, this.options);
     
     // Create output header
     const outputHeader: PngHeader = {
       width: totalWidth,
       height: totalHeight,
       bitDepth: targetBitDepth,
       colorType: targetColorType,
       compressionMethod: 0,   // Deflate
       filterMethod: 0,        // Adaptive filtering
       interlaceMethod: 0      // No interlacing
     };
     
     // PASS 2: Yield PNG signature + IHDR
     yield PNG_SIGNATURE;
     yield serializeChunk(createIHDR(outputHeader));
     
     // Stream scanlines with compression
     yield* this.streamCompressedData(...);
     
     // Yield IEND
     yield serializeChunk(createIEND());
   }
   ```

3. **`streamCompressedData()`** (lines 309-384) - Streaming Compression
   - Uses `StreamingDeflator` (pako deflate library)
   - Batches scanlines (max 1MB)
   - Flushes with `Z_SYNC_FLUSH` to enable progressive output
   - Yields IDAT chunks immediately as they're compressed

4. **`generateFilteredScanlines()`** (lines 389-545) - Core Processing
   - Processes one output scanline at a time
   - For each row in the grid:
     - Collects scanlines from all images in that row
     - Converts pixel formats using `convertScanline()` from pixel-ops
     - Pads narrower images with transparent color
     - Applies PNG filtering (adaptive)
     - Creates scanline with filter byte

### PNG Output Pipeline

```
Input Images (Any Format)
    ↓
[Decoders (PNG/JPEG/HEIC)]
    ↓
Generic Scanlines (RGBA)
    ↓
[Pixel Format Conversion]
    ↓
Output Format (bitDepth, colorType)
    ↓
[Combine Scanlines Horizontally]
    ↓
[PNG Filtering (Adaptive)]
    ↓
[Streaming Deflate Compression]
    ↓
[PNG Chunk Serialization]
    ↓
PNG Output (PNG signature + IHDR + IDAT chunks + IEND)
```

### Key Limitations for JPEG Output

1. **PNG-Specific Functions Called**:
   - `PNG_SIGNATURE` (hard-coded 8-byte PNG magic number)
   - `createIHDR()` - PNG-specific header chunk
   - `createIEND()` - PNG-specific end chunk
   - `filterScanline()` - PNG-specific adaptive filtering
   - `StreamingDeflate` - PNG-specific deflate compression

2. **Output Format Hardcoded**: No branching logic for different output formats

---

## 4. Build Configuration in `scripts/build-bundles.mjs`

### Purpose
Generates three bundle outputs from ESM-compiled source:

```
Source (TypeScript)
    ↓
[tsc -p tsconfig.esm.json]
    ↓
ESM Output (dist/esm/)
    ↓
[build-bundles.mjs]
    ├─→ dist/bundles/image-stitch.esm.js     (ES Module bundle)
    ├─→ dist/browser/image-stitch.js         (IIFE browser bundle)
    └─→ dist/browser/image-stitch.min.js     (Minified IIFE)
```

### Key Build Process Steps (lines 277-401)

1. **Module Collection** (lines 242-258)
   - Traverses module dependency tree starting from `dist/esm/bundle.js`
   - Resolves all imports recursively
   - Builds topologically-sorted module list

2. **Pako Handling** (lines 154-169)
   - Special case for the pako (deflate) library
   - Uses minified `pako_deflate.min.js` in bundles
   - Wraps in module/exports compatibility layer

3. **Import Resolution** (lines 128-144)
   - Local imports (`.js` files): Resolved to full paths
   - External imports (`pako`): Special handling
   - Node.js imports (`fs`, `stream`): Replaced with fallbacks

4. **Fallback Creation** (lines 95-126)
   - Node.js-specific APIs replaced for browser:
     - `node:fs` → Throws "not available" error
     - `node:stream` → Throws "not available" error
     - `node:fs/promises` → Throws "not available" error

5. **Bundle Generation** (lines 326-370)
   ```javascript
   // ESM Bundle: Simple concatenation of all modules
   const esmBundle = chunks.join('\n') + exportStatements.join('\n');
   
   // IIFE Bundle: Wrapped in immediately-invoked function expression
   // Exposes all exports via global.ImageStitch
   const iifeSource = `(function (global) {
     'use strict';
     ${chunks.join('\n')}
     const api = { ...exports };
     global.ImageStitch = api;
   })(typeof window !== 'undefined' ? window : globalThis)`;
   
   // Minified: Removes comments, empty lines, whitespace
   ```

### Implications for JPEG Output

- **Tree-Shaking**: If JPEG encoder is optional, import it conditionally
- **Bundle Size**: JPEG encoder could significantly increase bundle size (Rust/WASM vs pure JS)
- **Plugin System**: Could register JPEG encoder as optional plugin

---

## 5. TypeScript Configuration & Build Targets

### Configuration Files

#### **`tsconfig.base.json`** - Shared Base Config
```json
{
  "compilerOptions": {
    "target": "ES2022",              // Target ECMAScript 2022
    "module": "NodeNext",            // Dynamic module detection
    "lib": ["ES2022", "DOM"],        // ES2022 + DOM APIs
    "strict": true,                  // Strict type checking
    "moduleResolution": "nodenext",  // Node.js module resolution
    "resolveJsonModule": true,       // Allow import of JSON
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  }
}
```

#### **`tsconfig.esm.json`** - ES Module Build
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist/esm",
    "module": "NodeNext",            // ES2022 modules with Node.js ext resolution
    "declaration": true,             // Generate .d.ts files
    "declarationDir": "./dist/types", // Types in separate directory
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

#### **`tsconfig.cjs.json`** - CommonJS Build
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist/cjs",
    "module": "CommonJS",            // Traditional CommonJS modules
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

#### **`tsconfig.tests.json`** - Test Build
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./build/tests",
    "rootDir": ".",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

### Build Output Structure
```
dist/
├── esm/                          # ES Module output
│   ├── index.js
│   ├── image-concat-core.js
│   ├── png-writer.js
│   ├── decoders/
│   └── *.d.ts.map
├── cjs/                          # CommonJS output
│   ├── index.cjs
│   ├── image-concat-core.cjs
│   └── *.cjs.map
├── bundles/
│   ├── image-stitch.esm.js       # Single-file ESM bundle
│   └── image-stitch.esm.js.map
├── browser/
│   ├── image-stitch.js           # IIFE for browsers
│   ├── image-stitch.js.map
│   ├── image-stitch.min.js       # Minified
│   └── image-stitch.min.js.map
└── types/
    ├── index.d.ts
    ├── types.d.ts
    ├── decoders/
    └── *.d.ts.map
```

### Build Commands (from package.json)
```bash
npm run build:esm        # TypeScript → dist/esm
npm run build:cjs        # TypeScript → dist/cjs
npm run build:bundles    # dist/esm → bundles + browser
npm run build            # Full build (clean + esm + cjs + bundles)
```

---

## 6. Existing Test Structure

### Test Organization

#### **Unit Tests** (`tests/unit/`) - Fast, Isolated Tests (Used for Coverage)
```
tests/unit/
├── adam7.test.ts                 # Adam7 interlacing logic
├── decoder-factory.test.ts        # Decoder creation and format detection
├── format-detection.test.ts       # Magic number-based format detection
├── mixed-formats.test.ts          # Multi-format decoding
├── pixel-ops.test.ts              # Pixel format conversion utilities
├── png-decompress.test.ts         # PNG decompression pipeline
├── png-filter.test.ts             # PNG scanline filtering
├── png-parser.test.ts             # PNG chunk parsing
├── png-writer.test.ts             # PNG chunk serialization
├── streaming-deflate.test.ts      # Compression stream
└── utils.test.ts                  # Utility functions (CRC32, byte ops)
```

**Execution**: `npm run test:unit` → Runs `build/tests/tests/unit/*.test.js`

**Coverage**: `npm run coverage` → Uses c8 to generate LCOV reports

#### **Integration Tests** (`tests/integration/`) - Slow/External-Resource Tests
```
tests/integration/
├── image-concat.test.ts          # Main concatenation logic (with real files)
├── image-concat-browser.test.ts  # Browser-specific concatenation
├── browser.test.ts               # Browser bundle tests (with happy-dom)
├── heic-decoder.test.ts          # HEIC format decoder
├── jpeg-decoder.test.ts          # JPEG format decoder
├── memory.test.ts                # Memory usage validation
├── pixel-conversion.test.ts       # Pixel format conversion edge cases
└── pngsuite.test.ts              # Standard PNG test suite compliance
```

**Execution**: `npm run test:integration` → Requires `npm run build:docs` first

**Pre-requisites**: Integration tests need:
- Browser bundles built (`npm run build:docs`)
- Real test images/fixtures
- Optional dependencies (sharp, libheif-js)

#### **Test Utilities** (`tests/utils/`)
```
tests/utils/
├── fixtures/
│   └── expected-outputs/
│       ├── example1.png
│       ├── example2.png
│       ├── example3.png
│       ├── example4.png
│       └── example5.png
├── fixtures/
│   └── ... (test images: PNG, JPEG, HEIC)
├── image-fixtures.ts             # Test image generation utilities
├── memory-monitor.ts             # Memory usage tracking
└── generate-expected-outputs.js  # Script to generate baseline PNG outputs
```

### Test Framework
- **Runner**: Node.js native `test` module (no external test runner)
- **Assertions**: Node.js native `assert` module
- **Coverage**: c8 (code coverage reporter)
- **Browser Testing**: happy-dom (lightweight DOM implementation)

### Key Test Commands
```bash
npm run test              # Run unit tests only (fast)
npm run test:unit         # Explicit unit test run
npm run test:integration  # Integration tests (requires build:docs)
npm run test:all          # Run both unit and integration
npm run coverage          # Generate coverage report (LCOV format)
```

### Test Architecture Observations
1. **Fast/Slow Split**: Clear separation for CI efficiency
2. **PNG-Heavy**: Most tests validate PNG output
3. **No Jest/Vitest**: Uses native Node.js test runner (minimal dependencies)
4. **Real Fixtures**: Uses actual PNG/JPEG/HEIC images for validation
5. **Expected Outputs**: Committed PNG files serve as baseline for regression testing

---

## 7. Key Files & Lines of Code Summary

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Core Engine | image-concat-core.ts | 723 | Main streaming concatenator (PNG output only) |
| PNG Writer | png-writer.ts | 108 | PNG chunk serialization |
| PNG Parser | png-parser.ts | ~250 | PNG header/chunk parsing |
| PNG Filtering | png-filter.ts | ~150 | Scanline filtering |
| Compression | streaming-deflate.ts | ~200 | Streaming deflate with native fallback |
| Pixel Ops | pixel-ops.ts | ~300 | Format conversion (RGB↔RGBA, subsampling) |
| JPEG Decoder | jpeg-decoder.ts | 379 | Multi-backend JPEG decoder |
| PNG Decoder | png-decoder.ts | ~200 | PNG decoder |
| Decoders | decoders/*.ts | ~600 | Plugin system + format detection |
| | **TOTAL** | **~5,200** | |

---

## 8. Critical Findings for JPEG Output Integration

### What Currently Exists
✅ **Input Format Support**: PNG, JPEG, HEIC decoders work seamlessly
✅ **Format Detection**: Automatic magic number detection
✅ **Streaming Architecture**: Scanline-by-scanline processing
✅ **Plugin System**: Decoders registered via plugin architecture
✅ **Compression**: Streaming deflate compression (used for PNG)

### What Needs to Be Added for JPEG Output
❌ **Type System**: `outputFormat?: 'png'` needs to support `'jpeg'`
❌ **JPEG Encoder**: No JPEG encoding logic exists
❌ **Output Branch Logic**: No conditional logic for different output formats
❌ **JPEG Markers**: No code to write JPEG SOI, SOF, DHT, DQT, SOS, EOI markers
❌ **MCU Processing**: No 8x8 block (MCU) processing for JPEG
❌ **Huffman Encoding**: No variable-length coding for JPEG
❌ **Quantization**: No JPEG quantization tables
❌ **DCT Transform**: No forward DCT (Discrete Cosine Transform)
❌ **Color Conversion**: RGB→YCbCr conversion for JPEG
❌ **Chroma Subsampling**: JPEG 4:2:0/4:2:2 downsampling (optional)

### Architecture Decision Required
The `jpeg-plan.md` document describes building a **Rust/WASM JPEG encoder** with worker pools. However, this is a separate architectural decision. For MVP, could start with:

1. **Pure JavaScript Approach**: Use jpeg-js (available via npm)
2. **Hybrid Approach**: Pure JS for basic quality, Rust/WASM for production quality
3. **Library Dependency**: Use an existing library (would need to add as dependency)

---

## 9. Integration Points to Modify

### Files That Need Changes for JPEG Support

1. **`src/types.ts`** (lines 76-78)
   - Extend `outputFormat?: 'png'` → `'png' | 'jpeg'`
   - Add JPEG encoding options interface

2. **`src/image-concat-core.ts`** (main changes)
   - Modify `stream()` method to branch on output format
   - Add `encodeAsJpeg()` method (parallel to PNG pipeline)
   - Handle different JPEG markers vs PNG chunks

3. **`src/image-concat.ts`** (Node.js wrapper)
   - Handle JPEG output in `concatToFile()` and `concatToStream()`

4. **`src/image-concat-browser.ts`** (Browser wrapper)
   - Handle JPEG Blob output in browser context

5. **New Files Needed**
   - `src/jpeg-writer.ts` - JPEG marker creation & serialization
   - `src/jpeg-encoder.ts` - Main JPEG encoding pipeline
   - `src/color-conversion.ts` - RGB→YCbCr conversion
   - Possibly: `src/jpeg-dct.ts`, `src/jpeg-huffman.ts`, etc.

6. **Tests**
   - `tests/unit/jpeg-writer.test.ts`
   - `tests/integration/image-concat-jpeg.test.ts`
   - Test fixtures with expected JPEG outputs

---

## Summary

The codebase is well-architected for **streaming image input** from multiple formats, but is **completely PNG-focused for output**. Adding JPEG output requires:

1. **Type System Changes**: Extend `outputFormat` to support `'jpeg'`
2. **Architectural Branching**: Split output logic based on format
3. **New Module**: Complete JPEG encoding pipeline (or leverage existing library)
4. **Testing**: Add comprehensive JPEG output tests with fixtures

The existing decoder and streaming infrastructure is perfectly suited to feed a JPEG encoder—the challenge is building that encoder efficiently.
