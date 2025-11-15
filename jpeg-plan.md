### **Master Plan: High-Performance Streaming JPEG Encoder**

#### **1. Project Overview & Architecture**

**1.1. Core Principles**

*   **Streaming First:** The design must handle arbitrarily large images without holding the entire uncompressed pixel data or compressed output stream in memory. Processing will occur on horizontal strips of the image.
*   **Maximum Quality Focus:** The primary goal is minimal data loss. The default configuration will use 4:4:4 chroma subsampling (none) and a quantization quality of 100.
*   **High Performance:** Computationally intensive tasks will be offloaded from the main UI thread and accelerated using WebAssembly, keeping the application responsive.

**1.2. Architectural Split: The Orchestrator/Engine Model**

The architecture is cleanly divided into two main components:

*   **The JavaScript Orchestrator:** This is the high-level controller. It handles all browser-facing tasks: I/O, streaming logic, Web Worker management, user configuration, and final file assembly. It understands the JPEG file format and manages the overall state of the encoding process. It embodies the "policy" of the application.
*   **The Rust/Wasm Engine:** This is the low-level, high-performance workhorse. It is a pure, stateless computational module that accepts a buffer of pixel data and configuration tables, and returns a buffer of compressed bytes. It has no knowledge of the file format or the application's state. It embodies the "mechanism" of compression.

**1.3. High-Level Data Flow**

1.  **JS:** Reads a "strip" of 8 scanlines from the source (e.g., `<canvas>`, file stream).
2.  **JS:** Creates configuration data (Quantization Tables).
3.  **JS:** Dispatches the pixel strip and config to a Web Worker to prevent UI blocking.
4.  **Worker:** Calls the stateless Rust/Wasm function, passing the pixel data and tables.
5.  **Wasm:** Executes the full compression pipeline (Color -> DCT -> Quantize -> Huffman) on the strip.
6.  **Wasm:** Returns a `Uint8Array` of compressed data to the Worker.
7.  **Worker:** Transfers the compressed chunk back to the main JS thread.
8.  **JS:** Appends the chunk to the final output stream, which is being assembled in memory (chunk-by-chunk, not monolithically).
9.  **JS:** Repeats until all scanlines are processed.
10. **JS:** Prepends headers, appends the footer, and finalizes the `Blob`.

---

#### **2. Rust/Wasm Engine Implementation Guide**

**2.1. Philosophy: Stateless & Computation-Focused**

The Rust module should be built as a library exposing a single, pure function. It should not hold any state between calls. All necessary context (pixel data, tables) is provided with each call.

**2.2. Public Wasm API**

The module will expose one primary function, bound using `wasm-pack` / `wasm-bindgen`.

*   `process_strip(pixel_data: &[u8], width: u32, luma_q_table: &[u8; 64], chroma_q_table: &[u8; 64]) -> Vec<u8>`
    *   `pixel_data`: A flat `[R,G,B,A, R,G,B,A, ...]` buffer containing exactly 8 scanlines of the image.
    *   `width`: The width of the image in pixels.
    *   `luma_q_table`, `chroma_q_table`: The 64-element quantization tables provided by the JS orchestrator.
    *   **Returns:** A `Vec<u8>` containing the fully compressed bitstream for this strip, including any necessary byte stuffing.

**2.3. Internal Processing Pipeline**

The `process_strip` function will iterate through its input data MCU by MCU (Minimum Coded Unit). For 4:4:4, one MCU is a set of three 8x8 blocks (one Y, one Cb, one Cr).

For each MCU:
1.  Extract the 8x8 RGBA block.
2.  Convert the block to three 8x8 Y, Cb, Cr blocks.
3.  For each of the three component blocks:
    *   Level-shift values (subtract 128).
    *   Perform the Forward DCT.
    *   Quantize using the appropriate table.
4.  Huffman encode the three quantized blocks into a shared bitstream, correctly handling the DC prediction between MCUs.

**2.4. Key Internal Components & Function Signatures**

*   **Types:** Define type aliases for clarity: `type BlockF32 = [f32; 64];`, `type BlockI16 = [i16; 64];`.
*   **Color Conversion:** `fn rgb_to_ycbcr_block(rgba_block: &[u8; 256]) -> (BlockF32, BlockF32, BlockF32)`
*   **DCT:** `fn forward_dct(block: &mut BlockF32)` (operates in-place for efficiency).
*   **Quantization:** `fn quantize(dct_block: &BlockF32, q_table: &[u8; 64]) -> BlockI16`
*   **Huffman Encoding:** `fn huffman_encode_mcu(y: &BlockI16, cb: &BlockI16, cr: &BlockI16, dc_predictors: &mut (i16, i16, i16), bitstream: &mut BitstreamWriter)`
*   **Bitstream Writer:** A `struct` to manage writing variable-length codes to a `Vec<u8>`, automatically handling `0xFF` byte stuffing.

**2.5. Critical Implementation Details**

*   **DC Prediction:** The DC predictor values for Y, Cb, and Cr must be maintained across calls *within* the `process_strip` function for a single strip. They are reset to 0 for each new strip.
*   **Huffman Tables:** The standard JPEG Huffman tables should be stored as constants within the Rust code. The encoder does not need to generate them.
*   **Byte Stuffing:** The bitstream writer must insert a `0x00` byte after any `0xFF` byte written to the output stream.

**2.6. Build & Tooling**

*   Use `wasm-pack` to build, test, and publish the package.
*   For performance, investigate compiling with Rust's SIMD features enabled via the target-feature flag (`-C target-feature=+simd128`) for the `wasm32-unknown-unknown` target.

---

#### **3. JavaScript Orchestrator Implementation Guide**

**3.1. Philosophy: State Management, I/O, and Configuration**

The JS code is the master controller. It manages the file structure, user settings, and the overall asynchronous encoding process.

**3.2. Core Class Structure**

A class-based approach is recommended for managing the encoding process.

*   `class JpegEncoder { constructor(options) {} ... }`

**3.3. Public API**

*   `async encode(pixelDataSource, options) -> Blob`
    *   `pixelDataSource`: An object that provides scanlines, e.g., an `AsyncGenerator<Uint8Array>` or a function that can be called to retrieve scanlines.
    *   `options`: An object with `{ width: number, height: number, quality: number }`.
    *   **Returns:** A `Promise` that resolves to a `Blob` of type `image/jpeg`.

**3.4. Key Internal Responsibilities & Function Signatures**

The class will be responsible for generating all JPEG marker segments.

*   **JPEG Marker Writers:** Each should return a `Uint8Array`.
    *   `_writeSOI() -> Uint8Array`
    *   `_writeDQT(lumaTable, chromaTable) -> Uint8Array`
    *   `_writeSOF0(width, height) -> Uint8Array`
    *   `_writeDHT() -> Uint8Array`
    *   `_writeSOS() -> Uint8Array`
    *   `_writeEOI() -> Uint8Array`
*   **Streaming Logic:** The main loop inside `encode()`. It will manage an 8-line circular buffer and orchestrate sending strips to the worker pool.
*   **Final Assembly:** `_finalize(headerChunks, dataChunks, footerChunks) -> Blob`

**3.5. Configuration Management**

*   `_createQuantizationTable(quality: number) -> Uint8Array`
    *   This function implements the logic to generate quantization tables. For `quality >= 100`, it must return a 64-element `Uint8Array` filled with `1`s. Lower qualities would scale the standard JPEG tables.

**3.6. Asynchronous Operations & Worker Integration**

*   The `encode` method should be fully `async`.
*   A pool of Web Workers should be used to parallelize the processing of strips.
*   The pixel data `ArrayBuffer` for each strip must be *transferred* to the worker (not copied) for maximum performance.
*   The main thread will collect the compressed `Uint8Array` chunks returned from the workers in order. The final blob is created only after the last chunk is received.
