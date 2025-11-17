# JPEG Encoder Bug Report

## Summary
The WASM jpeg-encoder library is producing malformed JPEG files with duplicate SOI/EOI markers.

## Root Cause
The `encode_strip()` method in the WASM encoder is returning a complete JPEG file (including SOI marker `ff d8`) on its **first call**, instead of returning only the compressed scan data.

## Evidence

### Test Output
When encoding a 64x32 RGBA image:

```
=== HEADER ===
Header chunk: 623 bytes (starts with ff d8) ✓ CORRECT

=== FIRST STRIP (y=0) ===
Strip chunk: 623 bytes ✗ WRONG - Same size as header!
   Should contain compressed scan data only
   Instead contains complete JPEG starting with ff d8

=== SUBSEQUENT STRIPS ===
Strip chunks: 20 bytes, 16 bytes, etc. ✓ CORRECT

=== FOOTER ===
Footer chunk 1: 3 bytes (ends with ff d9)
Footer chunk 2: 2 bytes (ff d9) ✗ DUPLICATE EOI marker
```

### Result
- **2 SOI markers** (ff d8): offset 0 and offset 623
- **2 EOI markers** (ff d9): offset 1283 and 1285
- JPEG parsers fail with "unexpected marker: ffd8"

## Expected Behavior
- `header_bytes()`: Return SOI + JFIF header + tables
- `encode_strip()`: Return **only compressed scan data** (no SOI/EOI)
- `footer_bytes()`: Return **single** EOI marker (ff d9)

## Fix Required
In the jpeg-encoder WASM/Rust code:
1. Ensure `encode_strip()` does NOT output SOI markers
2. Ensure `footer_bytes()` outputs exactly ONE EOI marker
3. The first `encode_strip()` call should behave the same as subsequent calls

## Impact
- All JPEG output is malformed
- Browsers/tools that parse JPEG strictly will reject the files
- Files may appear grey or fail to decode

## Files Affected
- `jpeg-encoder` WASM library (github:jburnhams/jpeg-encoder)
- All code using JPEG output format in image-stitch
