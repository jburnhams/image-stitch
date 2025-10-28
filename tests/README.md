# Browser Integration Tests

This directory contains happy-dom-based integration tests for the browser bundle.

## Running the tests

```bash
# Run browser integration tests
npm run test:browser

# Run all tests (unit + browser)
npm run test:all
```

## What these tests do

The browser tests use happy-dom (a lightweight DOM implementation) to verify:
1. The bundle loads without JavaScript syntax errors
2. No duplicate declarations exist in the bundled code (specifically checks for the getSamplesPerPixel issue)
3. The `concatPngs` function is properly exported
4. All required utility functions are present in the bundle
5. The HTML page structure is correct with all 5 examples
6. The bundle size is reasonable (~27KB)

These are integration tests that use the actual built bundle (`docs/png-concat.bundle.js`) to ensure the library works correctly in a browser environment without requiring a full browser to be installed.

## Why happy-dom instead of Playwright?

- **Lightweight**: No browser binaries to download
- **Fast**: Runs in milliseconds instead of seconds
- **CI-friendly**: Works in any environment without special setup
- **Sufficient**: We're testing bundle syntax and structure, not interactive features
