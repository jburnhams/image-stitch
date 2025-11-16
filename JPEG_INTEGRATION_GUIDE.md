# JPEG Output Integration Guide - Quick Reference

## Documents Created

This exploration has generated two comprehensive documents:

1. **CODEBASE_OVERVIEW.md** (22 KB)
   - Complete architectural overview
   - Line-by-line breakdown of key components
   - Current PNG output pipeline
   - Test structure and organization
   - Critical findings for JPEG integration

2. **ARCHITECTURE_DIAGRAMS.md** (31 KB)
   - Visual data flow diagrams
   - Module dependency graphs
   - Plugin architecture illustration
   - Streaming pipeline breakdown
   - Type system requirements
   - Integration points and impact analysis

---

## Key Findings Summary

### Current State
- **5,198 lines** of TypeScript
- **PNG output only** (hardcoded)
- **Multi-format input** support (PNG, JPEG, HEIC)
- **Streaming architecture** for memory efficiency
- **Plugin system** for decoders

### What Works
✅ Input decoders (PNG, JPEG, HEIC all decode to RGBA scanlines)
✅ Streaming architecture (O(width) memory, not O(total_size))
✅ Plugin system (could extend to encoders)
✅ Format detection (magic number-based)
✅ Compression system (pako deflate)

### What Needs Building
❌ JPEG encoder (DCT, Huffman, quantization)
❌ MCU block processing (8×8 pixel blocks)
❌ Color space conversion (RGB → YCbCr)
❌ JPEG marker writing (SOI, SOF, DQT, etc.)
❌ Type system updates (outputFormat: 'png' | 'jpeg')
❌ Output branching logic (PNG vs JPEG paths)

---

## Critical Files to Modify

### 1. **src/types.ts** (Small Change - 5 lines)
```typescript
// Current (line 78):
outputFormat?: 'png';

// Change to:
outputFormat?: 'png' | 'jpeg';

// Add new interface:
export interface JpegEncoderOptions {
  quality?: number;           // 0-100, default 85
  subsampling?: '4:4:4' | '4:2:2' | '4:2:0';
  progressiveMode?: boolean;
}
```

### 2. **src/image-concat-core.ts** (Large Change - Major Refactor)
```typescript
// Current: Lines 550-625 in stream() method
// Need to add branching:

async *stream(): AsyncGenerator<Uint8Array> {
  // PASS 1: Collect headers (unchanged)
  const headers = [...];
  
  // PASS 2: Branch on output format
  if (this.options.outputFormat === 'jpeg') {
    yield* this.streamJpegOutput(headers, ...);
  } else {
    yield* this.streamPngOutput(headers, ...);  // Current logic
  }
}

// New methods needed:
// - streamJpegOutput()
// - streamJpegMarkers()
// - generateMCUBlocks()
```

### 3. **New Files Needed** (4-6 files)
```
src/jpeg-writer.ts         (100-200 lines)
  - JPEG marker creation
  - SOI, SOF, DQT, DHT, SOS, EOI chunks

src/jpeg-encoder.ts        (300-500 lines)
  - Main JPEG encoding pipeline
  - DCT transform (8×8 blocks)
  - Quantization
  - Huffman encoding
  - Streaming MCU processing

src/color-conversion.ts    (50-100 lines)
  - RGB → YCbCr conversion
  - Optional chroma subsampling

src/jpeg-constants.ts      (100-200 lines)
  - Standard Huffman tables
  - Quantization tables
  - Zig-zag scan order

Tests:
tests/unit/jpeg-writer.test.ts
tests/integration/image-concat-jpeg.test.ts
```

### 4. **Node.js/Browser Wrappers** (Small Changes)
```typescript
// src/image-concat.ts
// src/image-concat-browser.ts
// Handle JPEG output format in concatToFile, concatToStream
```

---

## Architecture Decision: Implementation Strategy

### Option A: Pure JavaScript Implementation
**Pros:**
- No external dependencies
- No WASM compilation needed
- Single bundle works everywhere
- Reasonable size (+5-10KB)

**Cons:**
- DCT transform is computationally expensive
- Main thread blocking on large images
- Slower encoding

**Estimated Size:** +5-10KB (total ~32-37KB)

### Option B: Rust/WASM with Worker Pool
**Pros:**
- High performance (10-100× faster DCT)
- Offloads to workers (non-blocking)
- Professional grade quality
- As described in jpeg-plan.md

**Cons:**
- Complex build setup (rustup, wasm-pack)
- Large WASM binary (+50-200KB)
- Worker pool complexity
- Monorepo with npm workspaces

**Estimated Size:** +50-200KB + orchestration code

### Option C: Hybrid Approach (Recommended MVP)
**Pros:**
- Start with pure JS for MVP
- Later add optional WASM encoder
- Conditional loading (WASM on demand)
- Tree-shakeable: can exclude JPEG entirely

**Cons:**
- Two code paths to maintain
- More complex conditional imports

**Estimated Size:** +5KB (JS) + optional WASM

---

## Implementation Roadmap

### Phase 1: Type System & Infrastructure (1-2 days)
1. Update types.ts with `outputFormat: 'png' | 'jpeg'`
2. Add JpegEncoderOptions interface
3. Create jpeg-writer.ts (marker generation)
4. Create jpeg-constants.ts (tables & data)

### Phase 2: Core JPEG Encoder (3-5 days)
1. Implement color-conversion.ts (RGB → YCbCr)
2. Implement DCT transform
3. Implement quantization
4. Implement Huffman encoding
5. Create jpeg-encoder.ts (orchestration)

### Phase 3: Integration & Streaming (2-3 days)
1. Add branching in image-concat-core.ts
2. Implement MCU block generation
3. Wire up streamJpegOutput()
4. Update Node.js/Browser wrappers

### Phase 4: Testing & Validation (2-3 days)
1. Unit tests for JPEG writer
2. Unit tests for DCT/Huffman
3. Integration tests (full pipeline)
4. Compare output with standard JPEG files
5. Performance benchmarking

### Phase 5: Optimization (1-2 days)
1. Bundle size analysis
2. Performance profiling
3. WASM consideration (future)

---

## Memory & Performance Implications

### Memory Usage Pattern (Current PNG)
```
Per Output Scanline: width × channels bytes
Example: 2000px × 4 bytes = 8 KB per row
Total in flight: ~50 rows = ~400 KB (streaming deflate)
```

### With JPEG Output
```
Per MCU Block: 16 scanlines × width bytes (for buffering)
Example: 2000px × 4 bytes × 16 = 128 KB per MCU row
Additional: DCT coefficients in memory: ~50 KB
Total in flight: ~200 KB (still streaming)

Acceptable because JPEG needs 8×8 blocks anyway
```

### Streaming Architecture Holds
✅ JPEG can be encoded in 16-scanline (2 MCU block) batches
✅ Can yield JPEG markers progressively
✅ Can stream compressed output
✅ Memory-efficient design maintained

---

## Testing Strategy

### Unit Tests (tests/unit/)
- jpeg-writer.test.ts: Marker generation & serialization
- jpeg-encoder.test.ts: DCT, quantization, Huffman

### Integration Tests (tests/integration/)
- image-concat-jpeg.test.ts: Full pipeline with real images
- Compare outputs against baseline JPEGs

### Validation
- Use libjpeg-turbo to validate output
- Compare with PIL/Pillow JPEG output
- Validate JPEG file format (magic bytes, markers)

---

## Decoder/Encoder Symmetry Note

**IMPORTANT:** The decoder (jpeg-decoder.ts) takes encoded JPEG and outputs RGBA scanlines.

The encoder (jpeg-encoder.ts) should take RGBA scanlines and output encoded JPEG.

This maintains perfect symmetry:
```
JPEG File → [JPEG Decoder] → RGBA Scanlines
RGBA Scanlines → [JPEG Encoder] → JPEG File
```

---

## File Size Impact Analysis

### Current Browser Bundle
- Total: ~27 KB (minified)
- Core logic: ~8 KB
- Decoders: ~12 KB (includes JPEG decoder!)
- Compression: ~8 KB (pako)

### Adding JPEG Encoder
**Minimal Impact Option (Pure JS):**
- jpeg-encoder.ts: ~3 KB
- jpeg-writer.ts: ~2 KB
- color-conversion.ts: ~1 KB
- Total addition: ~6 KB
- **New bundle: ~33 KB** (22% increase)

**Full Featured Option (with Huffman tables):**
- jpeg-encoder.ts: ~5 KB
- jpeg-writer.ts: ~3 KB
- color-conversion.ts: ~1 KB
- jpeg-constants.ts: ~2 KB (tables)
- Total addition: ~11 KB
- **New bundle: ~38 KB** (41% increase)

---

## Quick Start for JPEG Integration

1. Read CODEBASE_OVERVIEW.md sections:
   - Section 2 (Type System)
   - Section 3 (PNG Output Pipeline)
   - Section 8 (Critical Findings)

2. Review ARCHITECTURE_DIAGRAMS.md:
   - Diagram 4 (PNG Pipeline Details)
   - Diagram 5 (Type System Requirements)
   - Diagram 6 (JPEG Proposal)
   - Diagram 8 (Integration Points)

3. Start implementing in this order:
   - Types (types.ts)
   - Constants (jpeg-constants.ts)
   - Writer (jpeg-writer.ts)
   - Color conversion (color-conversion.ts)
   - Main encoder (jpeg-encoder.ts)
   - Integration (image-concat-core.ts)
   - Wrappers (image-concat.ts, image-concat-browser.ts)
   - Tests

---

## Key Code Locations for Reference

| Purpose | File | Lines |
|---------|------|-------|
| Current PNG output logic | image-concat-core.ts | 550-625 |
| PNG filtering | png-filter.ts | ~150 lines |
| PNG writing | png-writer.ts | 108 lines |
| Streaming compression | streaming-deflate.ts | ~200 lines |
| Pixel conversion | pixel-ops.ts | ~300 lines |
| Type definitions | types.ts | 97 lines |
| Test structure | tests/unit/ | 11 test files |

---

## External Resources

For JPEG encoding, reference:
- JPEG specification (ISO/IEC 10918)
- Forward DCT algorithms
- Huffman coding standards
- libjpeg source code (for reference)

Existing libraries (if considering dependency):
- `jpeg-js` (pure JS, already a dependency)
- `sharp` (native/WASM, optional peer dep)
- `libjpeg-turbo-js` (WASM, smaller than full version)

---

## Success Criteria

Implementation will be successful when:

1. ✅ Types support both PNG and JPEG output
2. ✅ JPEG output produces valid JPEG files
3. ✅ Output validates against standard JPEG tools
4. ✅ Memory usage remains O(image_width) + block buffer
5. ✅ Streaming architecture maintained
6. ✅ All tests pass (unit + integration)
7. ✅ Bundle size impact acceptable (<50KB increase)
8. ✅ Performance acceptable (within 2-3× PNG speed)
9. ✅ Works in Node.js and browsers

---

## Additional Notes

**Current Branch:** claude/add-jpeg-output-01AMwjC7i5Ekv2A62KVFM6s2

This is tracking JPEG output feature development. All code should maintain compatibility with the existing PNG output pipeline.

**Backward Compatibility:** Must be 100% preserved. PNG output remains default when outputFormat is not specified.

**Plugin Pattern:** Could extend decoder plugin pattern to encoders for future extensibility to WebP, AVIF, etc.

