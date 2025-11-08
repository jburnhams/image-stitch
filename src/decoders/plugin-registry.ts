import type { DecoderPlugin } from './types.js';

let defaultPlugins: DecoderPlugin[] | null = null;

export function setDefaultDecoderPlugins(plugins: DecoderPlugin[]): void {
  defaultPlugins = [...plugins];
}

export function getDefaultDecoderPlugins(): DecoderPlugin[] {
  if (!defaultPlugins || defaultPlugins.length === 0) {
    throw new Error(
      'No decoder plugins registered. Provide options.decoders or call setDefaultDecoderPlugins().' 
    );
  }
  return defaultPlugins;
}

export function clearDefaultDecoderPlugins(): void {
  defaultPlugins = null;
}
