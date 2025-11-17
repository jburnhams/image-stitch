/**
 * Test Path Utilities
 *
 * Provides clean path constants for test files to avoid messy relative paths.
 * All paths are resolved relative to the compiled test output directory.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Calculate repo root from this file's location
// This file compiles to: build/tests/tests/utils/test-paths.js
// Repo root is: ../../../../ from there
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '../../../../');

// Common test directories
export const PNGSUITE_DIR = path.join(REPO_ROOT, 'pngsuite', 'png');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'utils', 'fixtures');
export const EXPECTED_OUTPUTS_DIR = path.join(FIXTURES_DIR, 'expected-outputs');
export const DOCS_DIST_DIR = path.join(REPO_ROOT, 'docs-dist');
export const DIST_DIR = path.join(REPO_ROOT, 'dist');

// Validate that paths exist and point to the right location
function validatePaths(): void {
  if (!fs.existsSync(PNGSUITE_DIR)) {
    throw new Error(
      `PNG suite directory not found at: ${PNGSUITE_DIR}\n` +
      `Calculated from REPO_ROOT: ${REPO_ROOT}\n` +
      `Test may be running from unexpected location.`
    );
  }

  // Check that we have at least some PNG files
  const pngFiles = fs.readdirSync(PNGSUITE_DIR).filter(f => f.endsWith('.png'));
  if (pngFiles.length === 0) {
    throw new Error(
      `PNG suite directory exists but contains no PNG files: ${PNGSUITE_DIR}\n` +
      `Expected to find test images like basi0g08.png, basn2c08.png, etc.`
    );
  }
}

// Validate paths on module load
validatePaths();

/**
 * Helper to load a PNG from the pngsuite directory
 */
export function loadPngsuiteImage(filename: string): Uint8Array {
  const filepath = path.join(PNGSUITE_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(
      `PNG suite image not found: ${filename}\n` +
      `Looked in: ${PNGSUITE_DIR}\n` +
      `Full path: ${filepath}`
    );
  }
  return fs.readFileSync(filepath);
}
