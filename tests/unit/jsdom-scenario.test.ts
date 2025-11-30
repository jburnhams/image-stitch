import { test } from 'node:test';
import assert from 'node:assert';
import { isNode } from '../../src/utils.js';
import { createDecompressionStream } from '../../src/streaming-inflate.js';
import { JpegBufferDecoder } from '../../src/decoders/jpeg-decoder.js';
import { HeicBufferDecoder } from '../../src/decoders/heic-decoder.js';

test('isNode() correctly identifies Node environment even with window present', () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {};

  assert.strictEqual(isNode(), true, 'Should return true for Node environment');

  if (originalWindow === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = originalWindow;
  }
});

test('createDecompressionStream falls back to pako when native API is missing', async () => {
  const originalDS = (globalThis as any).DecompressionStream;
  (globalThis as any).DecompressionStream = undefined;

  try {
    const stream = createDecompressionStream('deflate');
    assert.ok(stream, 'Should return a stream');
    assert.ok(stream.readable, 'Should have readable');
    assert.ok(stream.writable, 'Should have writable');

    // Verify it works by piping some compressed data
    const pako = await import('pako');
    const input = new TextEncoder().encode('Hello World');
    const compressed = pako.deflate(input);

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const writePromise = (async () => {
      await writer.write(compressed);
      await writer.close();
    })();

    const chunks = [];
    while(true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    await writePromise;

    const output = Buffer.concat(chunks);
    assert.strictEqual(new TextDecoder().decode(output), 'Hello World');

  } finally {
    if (originalDS) {
        (globalThis as any).DecompressionStream = originalDS;
    }
  }
});

test('JPEG decoder uses custom constructors when provided', async () => {
  let imageConstructed = false;
  let canvasConstructed = false;

  const MockImage = class {
    onload: (() => void) | null = null;
    onerror: ((err: any) => void) | null = null;
    src: string = '';
    width = 10;
    height = 10;
    constructor() {
      imageConstructed = true;
      // Simulate async load
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 10);
    }
  };

  const MockCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      canvasConstructed = true;
      this.width = w;
      this.height = h;
    }
    getContext() {
        return {
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8Array(this.width * this.height * 4) })
        };
    }
  };

  // Minimal JPEG header + data (fake but enough to pass parseJpegHeader?)
  // parseJpegHeader checks for SOI (FF D8) and SOF marker.
  // Let's create a minimal valid JPEG structure manually.
  // SOI: FF D8
  // SOF0: FF C0, length 00 11, precision 08, height 00 0A, width 00 0A, components 03 ...
  const jpegData = new Uint8Array([
      0xFF, 0xD8, // SOI
      0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x0A, 0x00, 0x0A, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0 (10x10)
      0xFF, 0xD9 // EOI
  ]);

  const decoder = new JpegBufferDecoder(jpegData, {
      customConstructors: {
          Image: MockImage as any,
          Canvas: MockCanvas as any
      }
  });

  // scanlines() calls decodeJpeg() which should check customConstructors
  const iterator = decoder.scanlines();
  await iterator.next();

  assert.strictEqual(imageConstructed, true, 'Should use custom Image constructor');
  assert.strictEqual(canvasConstructed, true, 'Should use custom Canvas constructor');
});

test('HEIC decoder uses custom constructors when provided', async () => {
  let imageConstructed = false;
  let canvasConstructed = false;

  const MockImage = class {
    onload: (() => void) | null = null;
    onerror: ((err: any) => void) | null = null;
    src: string = '';
    width = 10;
    height = 10;
    constructor() {
      imageConstructed = true;
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 10);
    }
  };

  const MockCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      canvasConstructed = true;
      this.width = w;
      this.height = h;
    }
    getContext() {
        return {
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8Array(this.width * this.height * 4) })
        };
    }
  };

  // Mock parseHeicHeader?
  // src/decoders/heic-decoder.ts parseHeicHeader returns {} always currently.
  // So getHeader calls decodeHeic.

  const heicData = new Uint8Array([0x00]); // Dummy data

  const decoder = new HeicBufferDecoder(heicData, {
      customConstructors: {
          Image: MockImage as any,
          Canvas: MockCanvas as any
      }
  });

  const iterator = decoder.scanlines();
  // HEIC decode might fail if the dummy data is invalid for Image/Blob conversion?
  // decodeHeicWithCanvas creates a Blob from data.
  // Then creates object URL.
  // Then loads Image.
  // MockImage doesn't check src content, just succeeds.
  // So it should work.

  // URL.createObjectURL/revokeObjectURL needed.
  const originalCreateObjectURL = (globalThis as any).URL?.createObjectURL;
  const originalRevokeObjectURL = (globalThis as any).URL?.revokeObjectURL;

  if (!(globalThis as any).URL) (globalThis as any).URL = {};
  (globalThis as any).URL.createObjectURL = () => 'blob:fake';
  (globalThis as any).URL.revokeObjectURL = () => {};

  try {
      await iterator.next();
      assert.strictEqual(imageConstructed, true, 'Should use custom Image constructor');
      assert.strictEqual(canvasConstructed, true, 'Should use custom Canvas constructor');
  } finally {
      if (originalCreateObjectURL) (globalThis as any).URL.createObjectURL = originalCreateObjectURL;
      if (originalRevokeObjectURL) (globalThis as any).URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
