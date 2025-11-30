import { test } from 'node:test';
import assert from 'node:assert';
import * as pngDecompress from '../../src/png-decompress.js';
import * as pngFilterModule from '../../src/png-filter.js';
import { ColorType, PngChunk, PngHeader } from '../../src/types.js';

const serial = { concurrency: false } as const;

type BlobPartLike = Uint8Array | ArrayBuffer | Blob;

class FakeReader {
  #chunks: Uint8Array[];
  #index = 0;

  constructor(chunks: Uint8Array[]) {
    this.#chunks = chunks;
  }

  async read(): Promise<{ value?: Uint8Array; done: boolean }> {
    if (this.#index >= this.#chunks.length) {
      return { done: true };
    }
    const value = this.#chunks[this.#index++];
    return { value, done: false };
  }

  releaseLock(): void {}
}

class FakeStream {
  #chunks: Uint8Array[];

  constructor(chunks: Uint8Array[]) {
    this.#chunks = chunks;
  }

  pipeThrough(_: unknown): FakeStream {
    return new FakeStream(this.#chunks);
  }

  getReader(): FakeReader {
    return new FakeReader(this.#chunks);
  }
}

class FakeBlob {
  #chunks: Uint8Array[];

  constructor(parts: BlobPartLike[]) {
    this.#chunks = parts.map((part) => {
      if (part instanceof Uint8Array) {
        return part;
      }
      if (part instanceof ArrayBuffer) {
        return new Uint8Array(part);
      }
      if (typeof ArrayBuffer !== 'undefined' && part instanceof Blob) {
        return new Uint8Array();
      }
      return new Uint8Array();
    });
  }

  stream(): FakeStream {
    return new FakeStream(this.#chunks);
  }
}

const originalBlob = globalThis.Blob;
const originalCompressionStream = globalThis.CompressionStream;
const originalDecompressionStream = globalThis.DecompressionStream;

class NoopCompressionStream {
  readable: ReadableStream<any>;
  writable: WritableStream<any>;

  constructor(_type: string) {
    const { readable, writable } = new TransformStream();
    this.readable = readable;
    this.writable = writable;
  }
}

class NoopDecompressionStream {
  readable: ReadableStream<any>;
  writable: WritableStream<any>;

  constructor(_type: string) {
    const { readable, writable } = new TransformStream();
    this.readable = readable;
    this.writable = writable;
  }
}

function installStreamStubs(): void {
  (globalThis as typeof globalThis & { Blob: typeof Blob }).Blob = FakeBlob as unknown as typeof Blob;
  (globalThis as typeof globalThis & { CompressionStream: typeof CompressionStream }).CompressionStream =
    NoopCompressionStream as unknown as typeof CompressionStream;
  (globalThis as typeof globalThis & { DecompressionStream: typeof DecompressionStream }).DecompressionStream =
    NoopDecompressionStream as unknown as typeof DecompressionStream;
}

function restoreStreamStubs(): void {
  if (originalBlob) {
    (globalThis as typeof globalThis & { Blob: typeof Blob }).Blob = originalBlob;
  } else {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'Blob');
  }

  if (originalCompressionStream) {
    (globalThis as typeof globalThis & { CompressionStream: typeof CompressionStream }).CompressionStream =
      originalCompressionStream;
  } else {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'CompressionStream');
  }

  if (originalDecompressionStream) {
    (globalThis as typeof globalThis & { DecompressionStream: typeof DecompressionStream }).DecompressionStream =
      originalDecompressionStream;
  } else {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'DecompressionStream');
  }
}

function createHeader(overrides: Partial<PngHeader> = {}): PngHeader {
  return {
    width: 2,
    height: 2,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0,
    ...overrides
  };
}

function createIdatChunk(data: Uint8Array): PngChunk {
  return {
    length: data.length,
    type: 'IDAT',
    data,
    crc: 0
  };
}

test('decompressImageData unfilters non-interlaced data', serial, async () => {
  installStreamStubs();
  try {
    const header = createHeader();
    const row1 = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    const row2 = Uint8Array.of(9, 10, 11, 12, 13, 14, 15, 16);
    const filtered = new Uint8Array([
      0,
      ...row1,
      0,
      ...row2
    ]);

    const result = await pngDecompress.decompressImageData([
      createIdatChunk(filtered)
    ], header);

    assert.deepStrictEqual(Array.from(result), [...row1, ...row2]);
  } finally {
    restoreStreamStubs();
  }
});

test('decompressImageData throws on truncated data', serial, async () => {
  installStreamStubs();
  try {
    const header = createHeader();
    const truncated = new Uint8Array([0, 1, 2, 3, 4, 5]);

    await assert.rejects(
      () => pngDecompress.decompressImageData([
        createIdatChunk(truncated)
      ], header),
      /Unexpected end of decompressed data/
    );
  } finally {
    restoreStreamStubs();
  }
});

test('decompressImageData handles Adam7 interlaced headers', serial, async () => {
  installStreamStubs();
  try {
    const header = createHeader({ interlaceMethod: 1, width: 1, height: 1 });
    const result = await pngDecompress.decompressImageData([
      createIdatChunk(new Uint8Array([0]))
    ], header);

    assert.deepStrictEqual(Array.from(result), [0, 0, 0, 0]);
  } finally {
    restoreStreamStubs();
  }
});

test('compressImageData prepends filter bytes per row', serial, async () => {
  installStreamStubs();
  try {
    const header = createHeader();
    const bytesPerPixel = 4;
    const rowLength = header.width * bytesPerPixel;
    const pixels = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8,
      9, 10, 11, 12, 13, 14, 15, 16
    ]);

    const expected: number[] = [];
    let offset = 0;
    let previousLine: Uint8Array | null = null;
    for (let y = 0; y < header.height; y++) {
      const scanline = pixels.slice(offset, offset + rowLength);
      offset += rowLength;
      const { filterType, filtered } = pngFilterModule.filterScanline(scanline, previousLine, bytesPerPixel);
      expected.push(filterType, ...filtered);
      previousLine = scanline;
    }

    const compressed = await pngDecompress.compressImageData(pixels, header);

    assert.deepStrictEqual(Array.from(compressed), expected);
  } finally {
    restoreStreamStubs();
  }
});

test('extractPixelData requires IDAT chunks', serial, async () => {
  installStreamStubs();
  try {
    const header = createHeader();
    const nonIdat: PngChunk = { length: 0, type: 'tEXt', data: new Uint8Array(), crc: 0 };
    await assert.rejects(
      () => pngDecompress.extractPixelData([nonIdat], header),
      /No IDAT chunks found/
    );
  } finally {
    restoreStreamStubs();
  }
});
