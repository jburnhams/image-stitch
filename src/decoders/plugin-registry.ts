import type { DecoderPlugin } from './types.js';
import { pngDecoder } from './png-decoder.js';

let defaultPlugins: DecoderPlugin[] | null = null;

function ensureDefaultPlugins(): DecoderPlugin[] {
  if (!defaultPlugins || defaultPlugins.length === 0) {
    // Always fall back to the built-in PNG decoder so consumers who only
    // import the factory helpers still get a working configuration.
    defaultPlugins = [pngDecoder];
  }
  return defaultPlugins;
}

export function setDefaultDecoderPlugins(plugins: DecoderPlugin[]): void {
  defaultPlugins = [...plugins];
}

export function getDefaultDecoderPlugins(): DecoderPlugin[] {
  return ensureDefaultPlugins();
}

export function clearDefaultDecoderPlugins(): void {
  defaultPlugins = null;
}
