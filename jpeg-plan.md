### **Master Plan: A High-Performance, Universal, Streaming JPEG Encoder**

#### **1. Project Overview & Core Architecture**

**1.1. Core Principles**

*   **Streaming First:** The architecture must process images as horizontal strips (8 scanlines at a time) to ensure a low and constant memory footprint, regardless of image size.
*   **Maximum Quality Focus:** The design will default to and be optimized for the highest possible quality settings: 4:4:4 chroma subsampling (no subsampling) and a quantization quality of 100 (tables of all `1`s).
*   **High Performance & Responsiveness:** Computationally expensive algorithms (DCT, Huffman) will be executed in a separate, highly optimized Rust/Wasm module. This module will be run in a worker pool to keep the main application thread free.
*   **Universal (Isomorphic):** The final library will be published as a single `npm` package that works seamlessly in both browser and Node.js environments.

**1.2. Architectural Model: The Universal Orchestrator & Stateless Engine**

The system is split into two distinct packages within a monorepo:

*   **The Rust/Wasm Engine (`wasm-engine`):** A stateless, pure computational library. Its sole responsibility is to accept a buffer of raw pixel data and configuration tables and return a buffer of compressed bytes. It is entirely environment-agnostic.
*   **The JavaScript Orchestrator (`js-orchestrator`):** A stateful, environment-aware controller. It manages I/O, streaming logic, worker pool management, configuration, and final file assembly. It contains separate, thin entry points for the browser and Node.js to handle their unique APIs, which then delegate to a universal core.

#### **2. Repository & Build Structure**

**2.1. Tooling**
*   **Build System:** `npm` (v7+) with Workspaces.
*   **Rust/Wasm:** `rustup`, `cargo`, and `wasm-pack`.
*   **JS Bundler:** Vite (recommended) or a similar modern bundler.
*   **Dev Workflow:** `cargo-watch` for automatic Rust recompilation.

**2.2. Directory Structure**

jpeg-encoder-project/
├── .gitignore
├── package.json               # <-- Root package.json with workspace config & master scripts
└── packages/
    ├── wasm-engine/
    │   ├── Cargo.toml
    │   ├── package.json       # <-- Defines wasm-engine as a local npm package
    │   └── src/
    │       └── lib.rs         # <-- All Rust implementation
    └── js-orchestrator/
        ├── package.json       # <-- Defines the main library, its universal exports, and dev dependencies (Vite)
        └── src/
            ├── core/
            │   ├── encoder.js         # <-- Universal JpegEncoder class
            │   ├── jpeg-markers.js    # <-- JPEG header/footer writer functions
            │   └── constants.js       # <-- Standard Huffman tables, etc.
            ├── browser/
            │   ├── index.js           # <-- Public API entry point for browsers
            │   └── worker-pool.js     # <-- Web Worker pool implementation
            └── node/
                ├── index.js           # <-- Public API entry point for Node.js
                └── worker-pool.js     # <-- Node.js worker_threads pool implementation


**2.3. Build & Development Scripts (in root `package.json`)**
*   `"install:all": "npm install"`: Installs dependencies for all workspaces.
*   `"build:wasm": "wasm-pack build ./packages/wasm-engine --target bundler --out-dir ./packages/wasm-engine/pkg"`: Builds the universal Wasm module.
*   `"build:js": "npm run build -w js-orchestrator"`: Builds the JS library for production.
*   `"build": "npm run build:wasm && npm run build:js"`: The master build command.
*   `"dev": "npm run watch:wasm & npm run dev:js"`: Master dev command for a concurrent, auto-reloading workflow.

#### **3. Rust/Wasm Engine (`wasm-engine`) Implementation Guide**

**3.1. Philosophy:** Stateless, pure function. All context is passed in; no state is retained between calls.

**3.2. Public Wasm API (`src/lib.rs`)**
*   `#[wasm_bindgen]`
    `pub fn process_strip(pixel_data: &[u8], width: u32, luma_q_table: &[u8], chroma_q_table: &[u8]) -> Vec<u8>`
    *   **Parameters:**
        *   `pixel_data`: A flat RGBA buffer of `width * 8 * 4` bytes.
        *   `width`: Image width in pixels.
        *   `luma_q_table`, `chroma_q_table`: 64-element quantization tables.
    *   **Returns:** A `Vec<u8>` containing the compressed bitstream for the strip, with `0xFF` byte stuffing applied.

**3.3. Internal Structure & Key Function Signatures**
*   **Main Loop:** The `process_strip` function will loop from `x = 0` to `width` in steps of 8, processing one MCU at a time. It will maintain the three DC predictors, resetting them to 0 only at the start of the function call.
*   **Type Aliases:** `type BlockF32 = [f32; 64];`, `type BlockI16 = [i16; 64];`
*   **Color Conversion:** `fn rgb_to_ycbcr_block(rgba_block: &[u8]) -> (BlockF32, BlockF32, BlockF32)`
*   **DCT:** `fn forward_dct(block: &mut BlockF32)`
*   **Quantization:** `fn quantize(dct_block: &BlockF32, q_table: &[u8; 64]) -> BlockI16`
*   **Huffman Encoding:** `fn huffman_encode_mcu(y: &BlockI16, cb: &BlockI16, cr: &BlockI16, dc_predictors: &mut (i16, i16, i16), bitstream: &mut BitstreamWriter)`
*   **Bitstream Writer:** `struct BitstreamWriter { ... }` with methods like `write_bits(bits, count)` and a private buffer. It must handle `0xFF` -> `0xFF00` byte stuffing internally.
*   **Constants:** Standard Huffman tables and Zig-Zag scan order tables will be stored as `const` arrays.

#### **4. JavaScript Orchestrator (`js-orchestrator`) Implementation Guide**

**4.1. Philosophy:** A stateful controller that abstracts away environmental differences and provides a simple, universal public API.

**4.2. Universal Core (`src/core/`)**
*   `encoder.js`:
    *   `export class JpegEncoder { constructor(workerPool) { ... } }`
    *   `async encode(pixelStream, { width, height, quality }) -> Promise<Uint8Array>`
        *   `pixelStream`: An `AsyncGenerator<Uint8Array>` that yields full scanlines.
        *   Accepts a `workerPool` via dependency injection.
        *   Manages the 8-line buffer, dispatches strips to the worker pool, and assembles the final byte stream from ordered chunks.
*   `jpeg-markers.js`:
    *   `export function createDQT(lumaTable, chromaTable) -> Uint8Array`
    *   `export function createSOF0(width, height) -> Uint8Array`
    *   ... and other stateless helper functions for generating JPEG marker segments.

**4.3. Worker Abstraction**
*   A common interface must be defined for both environments to implement.
    *   `interface WorkerPool { postTask(data, transferList): Promise<result>; terminate(); }`

**4.4. Browser Entry Point (`src/browser/`)**
*   `index.js`:
    *   `export async function encode(source, options) -> Promise<Blob>`
        *   `source`: A browser-specific type like `<canvas>`, `ImageData`.
        *   **Responsibilities:**
            1.  Instantiate the `BrowserWorkerPool`.
            2.  Instantiate the core `JpegEncoder`, injecting the pool.
            3.  Create an `AsyncGenerator` to adapt the `source` into a scanline stream.
            4.  Await the `encoder.encode(...)` call.
            5.  Convert the final `Uint8Array` into a `Blob`.
*   `worker-pool.js`:
    *   `export class BrowserWorkerPool implements WorkerPool { ... }`: Manages a pool of `Web Worker` instances.

**4.5. Node.js Entry Point (`src/node/`)**
*   `index.js`:
    *   `export async function encode(source, options) -> Promise<Buffer>`
        *   `source`: A Node-specific type like a file path (string) or a `ReadableStream`.
        *   **Responsibilities:**
            1.  Instantiate the `NodeWorkerPool`.
            2.  Instantiate the core `JpegEncoder`, injecting the pool.
            3.  Create an `AsyncGenerator` to adapt the `source` into a scanline stream.
            4.  Await the `encoder.encode(...)` call.
            5.  Convert the final `Uint8Array` into a Node.js `Buffer`.
*   `worker-pool.js`:
    *   `export class NodeWorkerPool implements WorkerPool { ... }`: Manages a pool of `worker_threads` instances.

**4.6. Packaging (`js-orchestrator/package.json`)**
*   The `exports` field must be configured to point to the correct entry points for each environment, enabling universal consumption.

"exports": {
  ".": {
    "browser": "./dist/browser/index.js",
    "node": "./dist/node/index.js",
    "default": "./dist/node/index.js"
  }
}
