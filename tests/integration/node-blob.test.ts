import { test } from 'node:test';
import assert from 'node:assert';
import { concatToBuffer } from '../../src/index.js';
import { PngHeader, ColorType } from '../../src/types.js';
import { createIHDR, createIEND, createChunk, buildPng } from '../../src/png-writer.js';
import { compressImageData } from '../../src/png-decompress.js';
import { parsePngHeader } from '../../src/png-parser.js';

// Helper to create valid PNG data
async function createTestPng(
  width: number,
  height: number,
  color: Uint8Array
): Promise<Uint8Array> {
  const header: PngHeader = {
    width,
    height,
    bitDepth: 8,
    colorType: ColorType.RGBA,
    compressionMethod: 0,
    filterMethod: 0,
    interlaceMethod: 0
  };

  const pixelData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixelData.set(color, i * 4);
  }

  const compressed = await compressImageData(pixelData, header);
  const ihdr = createIHDR(header);
  const idat = createChunk('IDAT', compressed);
  const iend = createIEND();

  return buildPng([ihdr, idat, iend]);
}

test('concatToBuffer supports Node.js Blob inputs', async () => {
    // Check if Blob is available (it should be in Node 20)
    if (typeof Blob === 'undefined') {
        assert.fail('Blob not supported in this Node.js version');
    }

    const redPng = await createTestPng(10, 10, new Uint8Array([255, 0, 0, 255]));
    const bluePng = await createTestPng(10, 10, new Uint8Array([0, 0, 255, 255]));

    const redBlob = new Blob([redPng as unknown as BlobPart], { type: 'image/png' });
    const blueBlob = new Blob([bluePng as unknown as BlobPart], { type: 'image/png' });

    const result = await concatToBuffer({
        inputs: [redBlob, blueBlob],
        layout: { columns: 2 }
    });

    assert.ok(result instanceof Uint8Array);
    const header = parsePngHeader(result);
    assert.strictEqual(header.width, 20);
    assert.strictEqual(header.height, 10);
});
