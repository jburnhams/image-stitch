import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the docs directory
const docsPath = path.join(__dirname, '..', 'docs');

test.describe('Browser Bundle Tests', () => {
  test('bundle loads without syntax errors', async ({ page }) => {
    const errors: string[] = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    // Load the page
    await page.goto(`file://${docsPath}/index.html`);

    // Wait for the page to fully load
    await page.waitForLoadState('networkidle');

    // Check for any JavaScript errors
    expect(errors).toEqual([]);
  });

  test('concatPngs function is available', async ({ page }) => {
    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Check if concatPngs is available
    const isFunctionAvailable = await page.evaluate(() => {
      return typeof (window as any).concatPngs !== 'undefined';
    });

    expect(isFunctionAvailable).toBe(true);
  });

  test('Example 1: Horizontal concatenation works', async ({ page }) => {
    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Click the "Run Example" button for Example 1
    await page.click('#example1 button:has-text("Run Example")');

    // Wait for the result to appear
    await page.waitForSelector('#result1 .result img', { timeout: 10000 });

    // Check that the result image was created
    const resultImage = await page.$('#result1 .result img');
    expect(resultImage).not.toBeNull();

    // Check that the download button appeared
    const downloadButton = await page.$('#download1');
    const isVisible = await downloadButton?.isVisible();
    expect(isVisible).toBe(true);
  });

  test('Example 2: Vertical concatenation works', async ({ page }) => {
    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Click the "Run Example" button for Example 2
    await page.click('#example2 button:has-text("Run Example")');

    // Wait for the result to appear
    await page.waitForSelector('#result2 .result img', { timeout: 10000 });

    // Check that the result image was created
    const resultImage = await page.$('#result2 .result img');
    expect(resultImage).not.toBeNull();
  });

  test('Example 3: Grid layout works', async ({ page }) => {
    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Click the "Run Example" button for Example 3
    await page.click('#example3 button:has-text("Run Example")');

    // Wait for the result to appear
    await page.waitForSelector('#result3 .result img', { timeout: 10000 });

    // Check that the result image was created
    const resultImage = await page.$('#result3 .result img');
    expect(resultImage).not.toBeNull();
  });

  test('Example 4: Different image sizes works', async ({ page }) => {
    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Click the "Run Example" button for Example 4
    await page.click('#example4 button:has-text("Run Example")');

    // Wait for the result to appear
    await page.waitForSelector('#result4 .result img', { timeout: 10000 });

    // Check that the result image was created
    const resultImage = await page.$('#result4 .result img');
    expect(resultImage).not.toBeNull();
  });

  test('Example 5: Width limit with wrapping works', async ({ page }) => {
    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Click the "Run Example" button for Example 5
    await page.click('#example5 button:has-text("Run Example")');

    // Wait for the result to appear
    await page.waitForSelector('#result5 .result img', { timeout: 10000 });

    // Check that the result image was created
    const resultImage = await page.$('#result5 .result img');
    expect(resultImage).not.toBeNull();
  });

  test('no duplicate declarations in bundle', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto(`file://${docsPath}/index.html`);
    await page.waitForLoadState('networkidle');

    // Check specifically for duplicate declaration errors
    const hasDuplicateError = errors.some(error =>
      error.includes('has already been declared') ||
      error.includes('Identifier') && error.includes('already been declared')
    );

    expect(hasDuplicateError).toBe(false);
  });
});
