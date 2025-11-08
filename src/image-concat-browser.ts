import { ConcatOptions } from './types.js';
import type { ImageInput } from './decoders/types.js';
import { CoreStreamingConcatenator } from './image-concat-core.js';

type AsyncOrSyncIterable<T> = Iterable<T> | AsyncIterable<T>;

export type BrowserImageInput = ImageInput | Blob | HTMLCanvasElement;

type BrowserCanvasInput = HTMLCanvasElement;

export type BrowserImageInputSource =
  | Array<BrowserImageInput>
  | AsyncOrSyncIterable<BrowserImageInput>;

type BrowserCanvasInputSource =
  | Array<BrowserCanvasInput>
  | AsyncOrSyncIterable<BrowserCanvasInput>;

export type BrowserConcatOptions = Omit<ConcatOptions, 'inputs'> & {
  inputs: BrowserImageInputSource;
};

export interface ConcatCanvasesBaseOptions
  extends Omit<BrowserConcatOptions, 'inputs'> {
  canvases: BrowserCanvasInputSource;
}

export interface ConcatCanvasesBlobOptions extends ConcatCanvasesBaseOptions {
  output?: 'blob';
  /** MIME type for the generated blob. Defaults to image/png. */
  mimeType?: string;
}

export interface ConcatCanvasesCanvasOptions extends ConcatCanvasesBaseOptions {
  output: 'canvas';
  /**
   * Optional canvas instance to draw the stitched result into. When omitted a new
   * canvas element is created using the global document.
   */
  targetCanvas?: HTMLCanvasElement;
}

export type ConcatCanvasesOptions =
  | ConcatCanvasesBlobOptions
  | ConcatCanvasesCanvasOptions;

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function isHtmlCanvasElement(value: unknown): value is HTMLCanvasElement {
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    value instanceof HTMLCanvasElement
  );
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof (canvas as unknown as { convertToBlob?: () => Promise<Blob> }).convertToBlob === 'function') {
    return (canvas as unknown as { convertToBlob: () => Promise<Blob> }).convertToBlob();
  }

  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to Blob.'));
        }
      });
    });
  }

  throw new Error('HTMLCanvasElement toBlob() is not supported in this environment.');
}

async function normalizeBrowserInput(input: BrowserImageInput): Promise<ImageInput> {
  if (isBlob(input)) {
    const buffer = await input.arrayBuffer();
    return new Uint8Array(buffer);
  }

  if (isHtmlCanvasElement(input)) {
    const blob = await canvasToBlob(input);
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  return input;
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const clone = new Uint8Array(bytes.byteLength);
  clone.set(bytes);
  return clone.buffer;
}

function isAsyncIterable<T>(value: AsyncOrSyncIterable<T>): value is AsyncIterable<T> {
  return typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';
}

function isIterable<T>(value: AsyncOrSyncIterable<T>): value is Iterable<T> {
  return typeof (value as Iterable<T>)[Symbol.iterator] === 'function';
}

async function collectInputs<T>(
  inputs: AsyncOrSyncIterable<T> | Array<T>
): Promise<T[]> {
  if (Array.isArray(inputs)) {
    return inputs.slice();
  }

  if (isAsyncIterable(inputs)) {
    const collected: T[] = [];
    for await (const value of inputs) {
      collected.push(value);
    }
    return collected;
  }

  if (isIterable(inputs)) {
    return Array.from(inputs);
  }

  throw new Error('Unsupported input source.');
}

function normalizeInputSource(inputs: BrowserImageInputSource): AsyncIterable<ImageInput> {
  if (Array.isArray(inputs)) {
    return (async function* () {
      for (const input of inputs) {
        yield await normalizeBrowserInput(input);
      }
    })();
  }

  if (isAsyncIterable(inputs)) {
    return (async function* () {
      for await (const input of inputs) {
        yield await normalizeBrowserInput(input);
      }
    })();
  }

  if (isIterable(inputs)) {
    return (async function* () {
      for (const input of inputs) {
        yield await normalizeBrowserInput(input);
      }
    })();
  }

  throw new Error('Unsupported input source type for browser concatenation.');
}

function normalizeOptions(options: BrowserConcatOptions): ConcatOptions {
  return {
    ...options,
    inputs: normalizeInputSource(options.inputs)
  } satisfies ConcatOptions;
}

class BrowserStreamingConcatenator extends CoreStreamingConcatenator {
  constructor(options: BrowserConcatOptions) {
    super(normalizeOptions(options));
  }
}

export { BrowserStreamingConcatenator as StreamingConcatenator };

async function* browserConcatStreaming(
  options: BrowserConcatOptions
): AsyncGenerator<Uint8Array> {
  const concatenator = new BrowserStreamingConcatenator(options);
  yield* concatenator.stream();
}

export async function concatToBuffer(
  options: BrowserConcatOptions
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of browserConcatStreaming(options)) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    result.set(chunk, offset);
    offset += chunk.length;
    chunks[i] = null as unknown as Uint8Array;
  }

  return result;
}

/**
 * @deprecated Use {@link concatToBuffer} instead.
 */
function concatBrowser(options: BrowserConcatOptions): Promise<Uint8Array> {
  return concatToBuffer(options);
}

export { browserConcatStreaming as concatStreaming, concatBrowser as concat };

export async function concatToFile(): Promise<never> {
  throw new Error('concatToFile is not available in browser environments.');
}

async function renderPngToCanvas(
  pngBytes: Uint8Array,
  targetCanvas?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  if (typeof Blob === 'undefined') {
    throw new Error('Blob is not supported in this environment.');
  }

  const blob = new Blob([toBlobPart(pngBytes)], { type: 'image/png' });

  const createCanvas = (): HTMLCanvasElement => {
    if (targetCanvas) {
      return targetCanvas;
    }

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      return document.createElement('canvas');
    }

    throw new Error('No document available to create a canvas element.');
  };

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const canvas = createCanvas();
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const bitmapRenderer = canvas.getContext('bitmaprenderer');
    if (bitmapRenderer && 'transferFromImageBitmap' in bitmapRenderer) {
      bitmapRenderer.transferFromImageBitmap(bitmap);
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
      return canvas;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
      throw new Error('2D canvas context is not available.');
    }

    ctx.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
    return canvas;
  }

  if (typeof Image !== 'undefined') {
    const canvas = createCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context is not available.');
    }

    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = (error) => reject(error);
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }

    return canvas;
  }

  throw new Error('Canvas rendering is not supported in this environment. Use output: "blob" instead.');
}

export async function concatCanvases(
  options: ConcatCanvasesCanvasOptions
): Promise<HTMLCanvasElement>;
export async function concatCanvases(
  options: ConcatCanvasesBlobOptions
): Promise<Blob>;
export async function concatCanvases(
  options: ConcatCanvasesOptions
): Promise<HTMLCanvasElement | Blob> {
  const {
    canvases,
    output = 'blob',
    mimeType,
    targetCanvas,
    ...forwardOptions
  } = options as ConcatCanvasesOptions & {
    mimeType?: string;
    targetCanvas?: HTMLCanvasElement;
  };
  const normalizedInputs = await collectInputs(canvases);

  if (normalizedInputs.length === 0) {
    throw new Error('At least one canvas is required to stitch.');
  }

  const pngBytes = await concatToBuffer({
    ...(forwardOptions as Omit<BrowserConcatOptions, 'inputs'>),
    inputs: normalizedInputs
  });

  if (output === 'canvas') {
    return renderPngToCanvas(pngBytes, targetCanvas);
  }

  const type = mimeType ?? 'image/png';
  return new Blob([toBlobPart(pngBytes)], { type });
}
