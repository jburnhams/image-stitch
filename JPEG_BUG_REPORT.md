# JPEG Encoder Bug Report - RESOLVED ✓

## Summary
~~The WASM jpeg-encoder library is producing malformed JPEG files with duplicate SOI/EOI markers.~~

**UPDATE**: Issue was in our wrapper code, not the WASM library. **FIXED** in commit 6bb02d1.

## Root Cause - CORRECTED
~~The `encode_strip()` method in the WASM encoder is returning a complete JPEG file (including SOI marker `ff d8`) on its **first call**, instead of returning only the compressed scan data.~~

**ACTUAL CAUSE**: Our `jpeg-encoder.ts` wrapper was incorrectly calling:
1. `header_bytes()` before the first `encode_strip()` call
2. `footer_bytes()` after `finish()`

The WASM encoder works correctly - it includes:
- JPEG header (SOI + JFIF) in the **first** `encode_strip()` call
- JPEG footer (EOI marker) in the `finish()` call

We were duplicating these by calling the static helper methods.

## Evidence

### Test Output (BEFORE FIX)
When encoding a 64x32 RGBA image:

```
=== HEADER ===
Header chunk: 623 bytes (starts with ff d8) ← Called header_bytes()

=== FIRST STRIP (y=0) ===
Strip chunk: 623 bytes ← encode_strip() ALSO outputs header!
   Contains complete JPEG starting with ff d8

=== SUBSEQUENT STRIPS ===
Strip chunks: 20 bytes, 16 bytes, etc.

=== FOOTER ===
Footer chunk 1: 3 bytes (ends with ff d9) ← finish() includes EOI
Footer chunk 2: 2 bytes (ff d9) ← Called footer_bytes()
```

### Result (BEFORE)
- **2 SOI markers** (ff d8): offset 0 and offset 623
- **2 EOI markers** (ff d9): offset 1283 and 1285
- JPEG parsers fail with "unexpected marker: ffd8"

### Result (AFTER FIX)
- **1 SOI marker** at offset 0 ✓
- **1 EOI marker** at end of file ✓
- JPEG decodes correctly ✓
- Contains actual color data (not grey) ✓

## Correct Usage
The WASM encoder should be used as:
```typescript
const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgba, quality);

// NO header_bytes() call!

// First strip includes header automatically
const chunk1 = encoder.encode_strip(firstStrip);

// Subsequent strips
const chunk2 = encoder.encode_strip(secondStrip);
// ...

// Finish includes EOI automatically
const finalChunk = encoder.finish();

// NO footer_bytes() call!
```

## Fix Applied ✓
In `src/jpeg-encoder.ts`:
1. **`header()` method**: Removed call to `header_bytes()` - just initializes encoder
2. **`finish()` method**: Removed call to `footer_bytes()` - already in finish() output

No changes needed to jpeg-encoder WASM library - it works correctly!

## Impact (RESOLVED)
- ✓ All JPEG output is now valid
- ✓ JPEGs decode properly in all browsers/tools
- ✓ Docs pages show correct colors (not grey)

## Files Changed
- `src/jpeg-encoder.ts` - Fixed wrapper to use WASM encoder correctly
- `tests/integration/browser.test.ts` - Added visual color validation
- `tests/unit/jpeg-structure.test.ts` - Added comprehensive structure tests
