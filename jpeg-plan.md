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


### **Implementation Guide: Monorepo with npm, Rust, and JavaScript**

#### **1. Core Tooling**

You will need the following installed:
*   Node.js and npm (v7+ for workspace support)
*   The Rust toolchain (via `rustup`)
*   `wasm-pack`: The essential tool for building and packaging Rust-generated Wasm for the npm ecosystem. (`cargo install wasm-pack`)
*   A modern JS bundler. **Vite** is highly recommended for its speed and excellent out-of-the-box Wasm support.

#### **2. Directory Structure**

We will use **npm workspaces** to manage our two sub-packages within a single git repository.


jpeg-encoder-project/
├── .gitignore
├── package.json               # <-- The ROOT package.json, orchestrates everything.
└── packages/
    ├── wasm-engine/           # <-- The Rust/Wasm project (a self-contained package).
    │   ├── Cargo.toml
    │   ├── package.json       # <-- Defines this as an npm package.
    │   └── src/
    │       └── lib.rs
    └── js-orchestrator/       # <-- The JavaScript/Vite project (a self-contained package).
        ├── index.html
        ├── package.json       # <-- Depends on wasm-engine.
        ├── vite.config.js
        └── src/
            ├── main.js
            └── encoder.js


#### **3. Step-by-Step Setup**

**Step 1: Initialize the Root Project**

1.  Create the root folder and initialize npm.
    

    mkdir jpeg-encoder-project
    cd jpeg-encoder-project
    npm init -y
    

2.  Edit the root `jpeg-encoder-project/package.json` to define the workspaces:
    

    {
      "name": "jpeg-encoder-monorepo",
      "version": "1.0.0",
      "private": true, // This root package won't be published
      "workspaces": [
        "packages/*"
      ],
      "scripts": {
        // We will fill these in later
      }
    }
    


**Step 2: Create the `wasm-engine` Package**

1.  Create the Rust library.
    

    mkdir -p packages/wasm-engine/src
    cd packages/wasm-engine
    cargo init --lib
    

2.  Edit `packages/wasm-engine/Cargo.toml` to configure it for Wasm.
    

    [package]
    name = "wasm-engine"
    version = "0.1.0"
    edition = "2021"

    [lib]
    crate-type = ["cdylib"] # Critical for Wasm modules

    [dependencies]
    wasm-bindgen = "0.2"
    

3.  Create a `packages/wasm-engine/package.json`. `wasm-pack` will use this as a template for the final package it builds.
    

    {
      "name": "wasm-engine",
      "version": "0.1.0",
      "files": [
        "wasm_engine_bg.wasm",
        "wasm_engine.js",
        "wasm_engine.d.ts"
      ],
      "main": "wasm_engine.js",
      "types": "wasm_engine.d.ts"
    }
    

4.  Write your Rust code in `src/lib.rs`, exposing the `process_strip` function with `#[wasm_bindgen]`.

**Step 3: Create the `js-orchestrator` Package**

1.  Use Vite to scaffold the JS project.
    

    cd packages
    npm create vite@latest js-orchestrator -- --template vanilla # or react, vue, etc.
    cd js-orchestrator
    

2.  Edit `packages/js-orchestrator/package.json` to add the dependency on our local Wasm package.
    

    {
      "name": "js-orchestrator",
      "private": true,
      "version": "0.0.0",
      "type": "module",
      "scripts": {
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview"
      },
      "dependencies": {
        "wasm-engine": "workspace:*" // <-- This is the magic!
      },
      "devDependencies": {
        "vite": "^4.3.9"
      }
    }
    

    The `workspace:*` protocol tells npm to link the local `packages/wasm-engine` folder instead of looking for it on the npm registry.

**Step 4: Wire Everything Together with npm Scripts**

Now, go back to the **root `package.json`** and add the master scripts.


// In jpeg-encoder-project/package.json
"scripts": {
  "install:all": "npm install", // This will install dependencies for all workspaces
  "build:wasm": "wasm-pack build ./packages/wasm-engine --target web --out-dir ./packages/wasm-engine/pkg",
  "build:js": "npm run build -w js-orchestrator", // The -w flag runs a script in a specific workspace
  "build": "npm run build:wasm && npm run build:js",
  "dev": "npm run watch:wasm & npm run dev:js", // Concurrently run wasm watch and js dev server
  "dev:js": "npm run dev -w js-orchestrator",
  "watch:wasm": "cargo watch -s 'npm run build:wasm' -w ./packages/wasm-engine/src"
}

*To use `cargo watch`, you'll need to install it: `cargo install cargo-watch`.*

#### **4. The Development Workflow**

1.  **First-time setup:** From the root directory, run `npm run install:all`. This installs Vite and links the workspaces correctly.
2.  **Start the dev server:** From the root directory, run `npm run dev`.
    *   This kicks off two processes in parallel:
        *   `cargo watch` will monitor your `.rs` files. Any time you save a change in `packages/wasm-engine/src/`, it will automatically re-run `wasm-pack build`.
        *   Vite's dev server will start for the `js-orchestrator` package.
3.  **Code!**
    *   When you change Rust code, `cargo watch` rebuilds the Wasm package in `packages/wasm-engine/pkg`.
    *   Vite's server detects the change in the `node_modules/wasm-engine` dependency (which is a symlink to the `pkg` directory) and will automatically hot-reload the page.
    *   When you change JS code, Vite's HMR (Hot Module Replacement) updates the browser instantly.

#### **5. Production Build**

From the root directory, run one command:

npm run build

This will:
1.  Execute `wasm-pack build` with release optimizations (if you add `--release` to the `build:wasm` script).
2.  Execute `vite build`, which will bundle all your JS and the Wasm module into a highly optimized, static set of files in `packages/js-orchestrator/dist/`. This `dist` folder is what you deploy.

This monorepo structure provides a professional, scalable, and highly ergonomic development experience, keeping all related code in one repository while maintaining a clean separation of concerns.
