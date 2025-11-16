# Image-Stitch Architecture Diagrams

## 1. Current Data Flow: Input Decoding → PNG Output

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INPUT IMAGES                                 │
│  File paths or Buffers (PNG, JPEG, HEIC)                           │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│              FORMAT DETECTION & DECODER SELECTION                   │
│  detectImageFormat() → determines format by magic number            │
│  decoderFactory.create() → instantiates appropriate decoder         │
└────────────────────┬────────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
    ┌───────┐   ┌───────┐   ┌───────┐
    │  PNG  │   │ JPEG  │   │ HEIC  │
    │Decoder│   │Decoder│   │Decoder│
    └───┬───┘   └───┬───┘   └───┬───┘
        │            │            │
        └────────────┼────────────┘
                     │
         (getHeader + scanlines)
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GENERIC PIXEL DATA                               │
│            Uint8Array scanlines (per row)                           │
│            - RGBA format (4 bytes per pixel)                        │
│            - Width × Height pixels total                            │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│              IMAGE LAYOUT & CONCATENATION LOGIC                     │
│  - Calculate grid layout (columns/rows)                             │
│  - Determine output dimensions                                      │
│  - Handle variable image sizes (padding with transparency)          │
│  - Determine common format (bitDepth, colorType)                    │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│            PIXEL FORMAT CONVERSION                                  │
│  convertScanline() → handles format differences                     │
│  - RGB → RGBA (add alpha channel)                                   │
│  - 16-bit → 8-bit conversions                                       │
│  - Grayscale ↔ RGB conversions                                      │
│  - Palette → truecolor conversions                                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│           SCANLINE COMBINING (Horizontal)                           │
│  combineScanlines() → merge pixels from multiple images             │
│  into single output scanline                                        │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PNG FILTERING                                    │
│  filterScanline() → applies adaptive PNG filter                     │
│  Reduces entropy for better compression                             │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│              STREAMING DEFLATE COMPRESSION                          │
│  StreamingDeflator:                                                 │
│  - Batches scanlines (max 1MB)                                      │
│  - Uses pako.Deflate with Z_SYNC_FLUSH                             │
│  - Yields compressed chunks immediately                             │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                PNG CHUNK SERIALIZATION                              │
│  - PNG signature (8 bytes)                                          │
│  - IHDR chunk (image header)                                        │
│  - IDAT chunks (compressed pixel data) ← streams from above         │
│  - IEND chunk (end marker)                                          │
│                                                                     │
│  Each chunk: [length(4)] [type(4)] [data(N)] [crc(4)]              │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   PNG FILE OUTPUT          │
        │   (Uint8Array)             │
        │   Written to file/stream    │
        └────────────────────────────┘
```

---

## 2. Current Module Dependency Graph

```
                    index.ts (Main Entry)
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   image-concat.ts  image-concat-     bundle.ts
   (Node.js)        browser.ts        (Browser)
                     (Browser)         │
        │               │               │
        └───────────────┼───────────────┘
                        │
            image-concat-core.ts
         (Streaming concatenator)
                        │
        ┌───────────────┼──────────────────┐
        │               │                  │
    decoders/      pixel-ops.ts      streaming-deflate.ts
    (All formats)  (Format conv)     (Compression)
        │               │                  │
        ├─png-decoder   ├─utils.ts        │
        ├─jpeg-decoder  ├─adam7.ts        └─pako (external)
        └─heic-decoder  └─png-filter.ts
              │                     │
              └─plugin-registry.ts  png-writer.ts
                      │             (Serialization)
                decoder-factory.ts
                format-detection.ts

Legend:
─── = dependency
...= external library
```

---

## 3. Decoder Plugin Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│          DECODER PLUGIN REGISTRY (plugin-registry.ts)           │
│                                                                 │
│  DefaultPlugins = [                                             │
│    pngDecoder,                                                  │
│    jpegDecoder,                                                 │
│    heicDecoder                                                  │
│  ]                                                              │
└──────────────────┬──────────────────────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │PngPlugin │ │JpegPlugin│ │HeicPlugin│
  │  format: │ │ format:  │ │ format:  │
  │ 'png'    │ │'jpeg'    │ │ 'heic'   │
  │ create() │ │ create() │ │ create() │
  └────┬─────┘ └────┬─────┘ └────┬─────┘
       │            │            │
       ▼            ▼            ▼
   PngFileDecoder   JpegFileDecoder   HeicFileDecoder
   PngBufferDecoder JpegBufferDecoder HeicBufferDecoder

All implement ImageDecoder interface:
{
  getHeader(): Promise<ImageHeader>
  scanlines(): AsyncGenerator<Uint8Array>
  close(): Promise<void>
}
```

---

## 4. PNG Output Pipeline (Detailed)

```
Memory-Efficient Streaming Pipeline
(Constant memory usage regardless of image size)

Input Images
    │
    ├─ [Image 1] ─┐
    ├─ [Image 2] ─┤
    └─ [Image 3] ─┤
                  │
                  ▼
            ┌─────────┐
            │ Decoder │  (File/Buffer → RGBA scanlines)
            │ Pool    │
            └────┬────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
    Header Info      Scanline Stream
    - width              (AsyncGenerator)
    - height             One row at a time
    - channels           width × channels bytes
    - bitDepth           RGBA format
        │                │
        └────────┬───────┘
                 ▼
        ┌──────────────────┐
        │ Grid Calculator  │
        │ - Determine cols │
        │ - Determine rows │
        │ - Pad sizes      │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────────┐
        │ Format Determiner    │
        │ (determineCommonFmt) │
        │ Find bitDepth &      │
        │ colorType that can   │
        │ represent all inputs │
        └────────┬─────────────┘
                 │
                 ▼ (for each output scanline)
        ┌──────────────────────────┐
        │ Collect Input Scanlines  │
        │ - One from each image    │
        │   in that row            │
        │ - Convert formats        │
        │ - Pad to column width    │
        └────────┬─────────────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │ Combine Horizontally     │
        │ - Merge scanlines        │
        │ - Pad to total width     │
        └────────┬─────────────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │ Apply PNG Filter         │
        │ filterScanline()         │
        │ - Adaptive filtering     │
        │ - Reduce entropy         │
        └────────┬─────────────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │ Streaming Deflate        │
        │ StreamingDeflator        │
        │ - Z_SYNC_FLUSH           │
        │ - Yield chunks as ready  │
        └────────┬─────────────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │ PNG Chunk Serialization  │
        │ - Add chunk headers      │
        │ - Calculate CRCs         │
        │ - Yield bytes            │
        └────────┬─────────────────┘
                 │
                 ▼
        ┌──────────────────────────┐
        │ PNG File Assembly        │
        │ [PNG Signature]          │
        │ [IHDR Chunk]             │
        │ [IDAT Chunks] ← stream   │
        │ [IEND Chunk]             │
        └────────┬─────────────────┘
                 │
                 ▼
            PNG Output File
            (Uint8Array)

Key Property: Memory usage ~O(image_width) not O(total_size)
Reason: Only one scanline in memory at a time
```

---

## 5. Type System for JPEG Output Integration

```
Current State:
┌────────────────────────────────────────┐
│       ConcatOptions                    │
│  ┌────────────────────────────────────┐│
│  │ inputs: ImageInputSource           ││
│  │ layout: { columns, rows, ... }     ││
│  │ decoderOptions?: DecoderOptions    ││
│  │ onProgress?: ProgressCallback       ││
│  │ outputFormat?: 'png' ──────┐        ││
│  └────────────────────────────────────┘│
└────────────────────┬───────────────────┘
                     │
           CURRENT LIMITATION:
           Only PNG output supported

Needed for JPEG:
┌────────────────────────────────────────┐
│       ConcatOptions (NEW)              │
│  ┌────────────────────────────────────┐│
│  │ outputFormat?: 'png' | 'jpeg' ◄──┐ ││
│  │ encoderOptions?: {              │ ││
│  │   jpeg?: {                      │ ││
│  │     quality?: 0-100  ────────┐  │ ││
│  │     subsampling?: '4:4:4'     │  │ ││
│  │                               │  │ ││
│  └───────────────────────────────┼──┼──┘│
│                                  │  │   │
│  These options flow to either:   │  │   │
│  ┌──────────────────────────┐    │  │   │
│  │ PNG Path (current)       │    │  │   │
│  │ - createIHDR()           │    │  │   │
│  │ - filterScanline()       │    │  │   │
│  │ - StreamingDeflate       │    │  │   │
│  └──────────────────────────┘    │  │   │
│                                  │  │   │
│  ┌──────────────────────────┐    │  │   │
│  │ JPEG Path (new) ◄────────┘    │  │   │
│  │ - createSOI()                 │  │   │
│  │ - createSOF()                 │  │   │
│  │ - createDQT()  ◄──────────────┘  │   │
│  │ - convertRGBtoYCbCr()             │   │
│  │ - processMCUBlock()               │   │
│  │ - HuffmanEncode()                 │   │
│  │ - createEOI()                     │   │
│  └──────────────────────────┘        │   │
│                                      │   │
│  Common path for both:               │   │
│  ┌──────────────────────────┐        │   │
│  │ Image Concatenation Core │        │   │
│  │ - Grid layout            │        │   │
│  │ - Format detection       │        │   │
│  │ - Scanline streaming ◄───┼───────┘   │
│  │ - Pixel conversion       │           │
│  └──────────────────────────┘           │
└────────────────────────────────────────┘
```

---

## 6. JPEG Output Pipeline (Proposed)

```
Common Upstream:
Input Images → Decoders → RGBA Scanlines → Grid Layout → Format Detection

JPEG-Specific Path:

RGBA Scanlines (Row by Row)
    │
    ├─ Buffer MCU Blocks ─┐
    │  (8×8 pixels, need  │
    │   16 scanlines)     │
    │                     ▼
    │              ┌──────────────────────┐
    │              │ Color Conversion     │
    │              │ RGB → YCbCr          │
    │              │ (optional:           │
    │              │  downsample to 4:2:0)│
    │              └─────────┬────────────┘
    │                        │
    │                        ▼
    │              ┌──────────────────────┐
    │              │ Forward DCT          │
    │              │ (Discrete Cosine Tr.)│
    │              │ 8×8 spatial → freq   │
    │              └─────────┬────────────┘
    │                        │
    │                        ▼
    │              ┌──────────────────────┐
    │              │ Quantization         │
    │              │ Divide by Q-table    │
    │              │ Round to integers    │
    │              └─────────┬────────────┘
    │                        │
    │                        ▼
    │              ┌──────────────────────┐
    │              │ Zig-Zag Scan         │
    │              │ Reorder coefficients │
    │              │ for better RLE       │
    │              └─────────┬────────────┘
    │                        │
    │                        ▼
    │              ┌──────────────────────┐
    │              │ Huffman Encoding     │
    │              │ Variable length code │
    │              │ (Maintain DC pred)   │
    │              └─────────┬────────────┘
    │                        │
    │                        ▼
    │              ┌──────────────────────┐
    │              │ Accumulate Bits      │
    │              │ Handle 0xFF stuffing │
    │              │ Yield bytes          │
    │              └─────────┬────────────┘
    │                        │
    ▼                        ▼
┌──────────────────────────────────┐
│  JPEG Chunk Serialization        │
│  - SOI (Start of Image)          │
│  - APP0 (JFIF marker)            │
│  - DQT (Quantization Tables)     │
│  - SOF0 (Start of Frame)         │
│  - DHT (Huffman Tables)          │
│  - SOS (Start of Scan)           │
│  - [Compressed Scanlines] ◄─────┘
│  - EOI (End of Image)            │
└─────────────┬────────────────────┘
              │
              ▼
        JPEG File Output
        (Uint8Array)
```

---

## 7. Current Test Coverage Map

```
Source Code          Unit Tests               Integration Tests
──────────────────   ──────────────────────   ──────────────────────
image-concat-core.ts ──────┐                  image-concat.test.ts
                            │                 image-concat-browser.test.ts
png-writer.ts ─────────────┤                  pixel-conversion.test.ts
png-parser.ts ─────────────┤                  pngsuite.test.ts
png-filter.ts ─────────────┤                  
png-decompress.ts ──────────┤                 
pixel-ops.ts ───────────────┤
streaming-deflate.ts ────────┤
adam7.ts ──────────────────┤
utils.ts ──────────────────┤
                            │
decoders/
├─format-detection.ts       ├──────────────► browser.test.ts
├─decoder-factory.ts        │
├─png-decoder.ts            │
├─jpeg-decoder.ts ──────────────────────────► jpeg-decoder.test.ts
│                                            
└─heic-decoder.ts ──────────────────────────► heic-decoder.test.ts
                                            
                           memory.test.ts
                           (All decoders)

Legend:
──► Direct test
        = No direct test (covered indirectly)
```

---

## 8. Integration Points for JPEG Output

```
┌─────────────────────────────────────────────────────────────────┐
│                     User API (index.ts)                         │
│                                                                 │
│  concat(options) ─────┐  (Keep backward compat, default 'png')  │
│  concatStreaming()    │                                         │
│  concatToBuffer()     │                                         │
│  concatToFile()       │                                         │
│  concatToStream()     │                                         │
└──────────────────┬────┴─────────────────────────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
image-concat.ts   (Node.js)    image-concat-browser.ts
(image-concat-    Wrapper      (Browser wrapper)
core wrapper)
     │             │             │
     └─────────────┼─────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │ image-concat-core.ts         │
    │  CoreStreamingConcatenator   │
    │                              │
    │  .stream() method:           │
    │  ┌────────────────────────┐  │
    │  │ PASS 1: Headers        │  │
    │  │ PASS 2: Output         │  │◄─── NEEDS BRANCHING HERE
    │  │                        │  │     if (outputFormat === 'jpeg')
    │  │  if outputFormat       │  │        → streamJpegOutput()
    │  │   === 'png' (current)  │  │     else → streamPngOutput()
    │  │   → streamPngOutput()  │  │
    │  └────────────────────────┘  │
    │                              │
    │  New methods needed:          │
    │  - streamJpegOutput()         │
    │  - determineJpegFormat()      │
    │  - generateMCUBlocks()        │
    └──────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   ┌──────────────┐    ┌──────────────┐
   │ PNG Path     │    │ JPEG Path    │
   │ (current)    │    │ (new)        │
   ├──────────────┤    ├──────────────┤
   │ png-writer   │    │ jpeg-writer  │
   │ png-filter   │    │ (NEW)        │
   │ pixel-ops    │    │              │
   │ streaming-   │    │ color-       │
   │ deflate      │    │ conversion   │
   │              │    │ (NEW)        │
   │              │    │              │
   │              │    │ jpeg-encoder │
   │              │    │ (NEW)        │
   └──────────────┘    └──────────────┘
         │                   │
         ▼                   ▼
    PNG output         JPEG output
```

---

## 9. Browser Bundle Impact

```
Current Bundle Composition:
┌──────────────────────────────────────┐
│  image-stitch.min.js (~27KB)         │
├──────────────────────────────────────┤
│ Core:                    ~8KB        │
│  - image-concat-core     ~4KB        │
│  - png-writer            ~1KB        │
│  - pixel-ops             ~1.5KB      │
│  - streaming-deflate     ~1.5KB      │
│                                      │
│ Decoders:                ~12KB       │
│  - png-decoder           ~3KB        │
│  - jpeg-decoder          ~4KB        │
│  - heic-decoder          ~5KB        │
│                                      │
│ Utilities:               ~7KB        │
│  - utils, adam7, etc.    ~7KB        │
│                                      │
│ pako (deflate):          ~8KB        │
│  - Minified version                  │
└──────────────────────────────────────┘

With JPEG Output (Estimated):
┌──────────────────────────────────────┐
│  Option A: Pure JS Encoder           │
│  Size: +5-10KB (total ~32-37KB)      │
│  - jpeg-writer           ~2KB        │
│  - jpeg-encoder          ~3KB        │
│  - color-conversion      ~1KB        │
│  - DCT/Huffman tables    ~1-2KB      │
│                                      │
│  Option B: Rust/WASM Encoder         │
│  Size: +50-200KB (total ~77-227KB)   │
│  - wasm module           ~50-200KB   │
│  - worker pool logic     ~2KB        │
│  - js-side orchestration ~2KB        │
│                                      │
│  Option C: Conditional Loading       │
│  Size: +5KB (core) + optional WASM   │
│  - Keep pure JS, load WASM on demand │
│  - Tree-shake unused code            │
└──────────────────────────────────────┘
```

