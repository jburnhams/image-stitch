# Browser Integration Tests

This directory contains Playwright-based integration tests for the browser bundle.

## Running the tests

Before running the tests, you need to install Playwright browsers:

```bash
npx playwright install
```

Then run the tests:

```bash
# Run headless tests
npm run test:browser

# Run tests in headed mode (see the browser)
npm run test:browser:headed

# Run all tests (unit + browser)
npm run test:all
```

## What these tests do

The browser tests verify:
1. The bundle loads without JavaScript syntax errors
2. No duplicate declarations exist in the bundled code
3. The `concatPngs` function is properly exported and available
4. All interactive examples on the GitHub Pages site work correctly
5. Image concatenation works in horizontal, vertical, and grid layouts
6. Different image sizes are handled correctly
7. Width limiting with automatic wrapping works

These are integration tests that use the actual built bundle (`docs/png-concat.bundle.js`) to ensure the library works correctly in a real browser environment.
