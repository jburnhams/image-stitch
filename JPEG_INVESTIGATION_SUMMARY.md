# JPEG Grey Output Investigation Summary

## Issue Reported
JPEG outputs on documentation pages appear all grey. User suspected browser-specific issue.

## Root Cause Identified
The WASM jpeg-encoder library (github:jburnhams/jpeg-encoder) has a critical bug where `encode_strip()` returns a **complete duplicate JPEG file** on its first call instead of compressed scan data.

### Evidence
- **Duplicate SOI markers**: Found at offsets 0 (correct) and 623 (incorrect)
- **Duplicate EOI markers**: Found at end of file (two `ff d9` sequences)
- **First strip output**: Returns 623 bytes - exactly the same size as the header, containing a complete JPEG starting with `ff d8`
- **Impact**: All JPEG files are malformed and fail strict JPEG parsers

## Testing Coverage Analysis

### What Tests Existed
- ✓ JPEG signature validation (checks `ff d8` start marker)
- ✓ JPEG output size > 0
- ✗ **NO visual/pixel validation**
- ✗ **NO structure validation** (marker counts)
- ✗ **NO decoding tests**

### Why Tests Didn't Catch It
1. Existing test only checked if output started with `ff d8` - which was true
2. No test actually decoded the JPEG to verify pixels
3. No test validated JPEG structure (marker counts/positions)
4. Integration tests in Node passed because jpeg-js is lenient with malformed JPEGs

## Tests Added

### 1. Browser Bundle Visual Comparison Test
**File**: `tests/integration/browser.test.ts`
- Decodes JPEG output using jpeg-js
- Validates pixel data is not all grey/black
- Checks for actual color variation
- **This test caught the bug immediately**

### 2. JPEG Structure Validation Tests
**File**: `tests/unit/jpeg-structure.test.ts` (NEW)
- Validates exactly 1 SOI marker at offset 0
- Validates exactly 1 EOI marker at end
- Validates `encodeStrip()` doesn't output SOI markers
- Tests multiple image sizes and quality settings
- Ensures JPEG is decodable
- Validates pixel data preservation

## CI/Testing Questions Answered

### "What is npm run test:browser?"
**Answer**: There is NO `npm run test:browser` script. The browser tests run as part of:
```bash
npm run test:integration
```

### Where Browser Tests Run
1. **Locally**: `npm run test:integration`
   - Builds docs (including browser bundle)
   - Runs all integration tests including browser tests

2. **CI**: `.github/workflows/integration-tests.yml`
   - Runs `npm run test:integration`
   - Executes on every push to main and all PRs
   - Uses Node.js 25 on Ubuntu

### Test Script Breakdown
```json
{
  "test:unit": "Unit tests only (fast, for coverage)",
  "test:integration": "Integration + browser tests (slow, builds docs first)",
  "test:all": "Runs both unit and integration",
  "coverage": "Unit tests with coverage report"
}
```

## Fix Required

### In jpeg-encoder Library (github:jburnhams/jpeg-encoder)
The Rust/WASM code needs fixing:

1. **`encode_strip()`** should NEVER output SOI (`ff d8`) markers
   - First call is currently outputting a complete JPEG
   - Should only return compressed scan data

2. **`footer_bytes()`** should output exactly ONE EOI marker
   - Currently outputting duplicate `ff d9` sequences

3. **Ensure consistency** across all `encode_strip()` calls
   - First call should behave same as subsequent calls

### Temporary Workaround
Could filter out duplicate markers in `jpeg-encoder.ts` wrapper, but **fixing the WASM library is the proper solution**.

## Test Recommendations

### Additional Tests Needed
1. ✓ **Visual comparison tests** - ADDED
2. ✓ **Structure validation tests** - ADDED
3. TODO: **End-to-end browser rendering tests** (actual browser screenshot comparison)
4. TODO: **Streaming JPEG tests** (verify StreamingConcatenator JPEG output)
5. TODO: **Cross-decoder tests** (test with multiple JPEG decoders: jpeg-js, sharp, browser native)

### Test Coverage Improvements
- Add JPEG tests to CI explicitly
- Run visual comparison on every JPEG output test
- Add property-based tests for various image configurations
- Test edge cases: 1x1, non-MCU-aligned sizes, extreme quality settings

## Files Changed
- `tests/integration/browser.test.ts` - Added visual JPEG validation test
- `tests/unit/jpeg-structure.test.ts` - NEW comprehensive structure tests
- `JPEG_BUG_REPORT.md` - Bug documentation for jpeg-encoder fix
- `JPEG_INVESTIGATION_SUMMARY.md` - This file

## Next Steps
1. ✓ Document bug thoroughly
2. ✓ Add comprehensive tests to prevent regression
3. **Fix jpeg-encoder WASM library** (separate repo)
4. Update jpeg-encoder dependency once fixed
5. Run all new tests to verify fix
6. Consider adding visual regression testing for docs pages
