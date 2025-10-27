# png-concat

A streaming PNG concatenation library for Node.js and web browsers that works without canvas and can handle large files efficiently.

## Features

- **No Canvas Required**: Pure JavaScript/TypeScript implementation
- **Streaming Output**: Stream PNG output chunks without holding the entire result in memory
- **Cross-Platform**: Works in both Node.js and modern browsers
- **Zero Dependencies**: No external libraries required (uses only built-in APIs)
- **Type Safe**: Written in TypeScript with full type definitions
- **Well Tested**: Comprehensive unit test coverage (69 tests)
- **Flexible Layouts**: Horizontal, vertical, or grid arrangements

## Installation

```bash
npm install png-concat
```

## Quick Start

```typescript
import { concatPngs } from 'png-concat';
import { readFileSync, writeFileSync } from 'fs';

// Load PNG files
const png1 = readFileSync('image1.png');
const png2 = readFileSync('image2.png');
const png3 = readFileSync('image3.png');
const png4 = readFileSync('image4.png');

// Concatenate in a 2x2 grid
const result = await concatPngs({
  inputs: [png1, png2, png3, png4],
  layout: { columns: 2 }
});

// Save result
writeFileSync('output.png', result);
```

## API Reference

### `concatPngs(options: ConcatOptions): Promise<Uint8Array>`

Concatenate multiple PNG images into a single image.

**Options:**

```typescript
interface ConcatOptions {
  /** Input PNG files as Uint8Arrays or file paths (Node.js only) */
  inputs: Array<Uint8Array | string>;

  /** Layout configuration */
  layout: {
    /** Number of images per row (horizontal concatenation) */
    columns?: number;
    /** Number of images per column (vertical concatenation) */
    rows?: number;
    /** Output width in pixels (alternative to columns) */
    width?: number;
    /** Output height in pixels (alternative to rows) */
    height?: number;
  };
}
```

**Returns:** A `Uint8Array` containing the concatenated PNG file.

**Example - Horizontal Layout:**

```typescript
const result = await concatPngs({
  inputs: [png1, png2, png3],
  layout: { columns: 3 }  // 3 images in a row
});
```

**Example - Vertical Layout:**

```typescript
const result = await concatPngs({
  inputs: [png1, png2, png3],
  layout: { rows: 3 }  // 3 images in a column
});
```

**Example - Grid Layout:**

```typescript
const result = await concatPngs({
  inputs: [png1, png2, png3, png4, png5, png6],
  layout: { columns: 3 }  // 2 rows × 3 columns
});
```

**Example - Using File Paths (Node.js):**

```typescript
const result = await concatPngs({
  inputs: ['image1.png', 'image2.png', 'image3.png'],
  layout: { columns: 3 }
});
```

### Requirements

- All input images must have the same dimensions
- All input images must have the same bit depth and color type
- Supports 8-bit and 16-bit images
- Supports RGB, RGBA, Grayscale, and Grayscale+Alpha

## Streaming API

For applications that need to stream the output (e.g., HTTP responses, large files), use the streaming API:

### `concatPngsStream(options: ConcatOptions): AsyncGenerator<Uint8Array>`

Returns an async generator that yields PNG chunks as they are generated.

```typescript
import { concatPngsStream } from 'png-concat';
import { createWriteStream } from 'fs';

const writeStream = createWriteStream('output.png');

for await (const chunk of concatPngsStream({
  inputs: ['img1.png', 'img2.png', 'img3.png', 'img4.png'],
  layout: { columns: 2 }
})) {
  writeStream.write(chunk);
}

writeStream.end();
```

### `concatPngsToStream(options: ConcatOptions): Readable`

Returns a Node.js Readable stream that can be piped directly.

```typescript
import { concatPngsToStream } from 'png-concat';
import { createWriteStream } from 'fs';

const readStream = concatPngsToStream({
  inputs: ['img1.png', 'img2.png'],
  layout: { columns: 2 }
});

readStream.pipe(createWriteStream('output.png'));
```

**Streaming to HTTP Response:**

```typescript
import { concatPngsToStream } from 'png-concat';

app.get('/concat', (req, res) => {
  res.setHeader('Content-Type', 'image/png');

  const stream = concatPngsToStream({
    inputs: getImagePaths(),
    layout: { columns: 3 }
  });

  stream.pipe(res);
});
```

**Note:** The current streaming implementation yields PNG chunks (signature, IHDR, IDAT, IEND) as they are serialized. While this avoids holding the complete output file in memory as a single buffer, the pixel processing still requires loading input images and building the output image buffer before compression.

## Advanced Usage

### PNG Parser

Read and inspect PNG files:

```typescript
import { parsePngHeader, parsePngChunks } from 'png-concat';

const pngData = readFileSync('image.png');

// Get image dimensions and format
const header = parsePngHeader(pngData);
console.log(`Size: ${header.width}x${header.height}`);
console.log(`Color Type: ${header.colorType}`);
console.log(`Bit Depth: ${header.bitDepth}`);

// Read all PNG chunks
const chunks = parsePngChunks(pngData);
chunks.forEach(chunk => {
  console.log(`${chunk.type}: ${chunk.length} bytes`);
});
```

### PNG Writer

Create PNG files from scratch:

```typescript
import {
  createIHDR,
  createIEND,
  createChunk,
  buildPng,
  compressImageData
} from 'png-concat';
import { PngHeader, ColorType } from 'png-concat';

// Define image properties
const header: PngHeader = {
  width: 100,
  height: 100,
  bitDepth: 8,
  colorType: ColorType.RGBA,
  compressionMethod: 0,
  filterMethod: 0,
  interlaceMethod: 0
};

// Create pixel data (RGBA format)
const pixelData = new Uint8Array(100 * 100 * 4);
// ... fill with pixel values ...

// Compress and build PNG
const compressed = compressImageData(pixelData, header);
const ihdr = createIHDR(header);
const idat = createChunk('IDAT', compressed);
const iend = createIEND();

const png = buildPng([ihdr, idat, iend]);
writeFileSync('output.png', png);
```

### Pixel Manipulation

Low-level pixel operations:

```typescript
import {
  copyPixelRegion,
  fillPixelRegion,
  extractPixelData
} from 'png-concat';

// Extract raw pixel data from PNG
const chunks = parsePngChunks(pngData);
const header = parsePngHeader(pngData);
const pixels = extractPixelData(chunks, header);

// Copy a region from one image to another
copyPixelRegion(
  srcPixels, srcHeader,
  dstPixels, dstHeader,
  srcX, srcY,
  dstX, dstY,
  width, height
);
```

## How It Works

The library implements the full PNG specification including:

1. **PNG Parsing**: Reads PNG chunks, validates signatures and CRCs
2. **Decompression**: Uses zlib (Node.js) or DecompressionStream (browsers) to decompress image data
3. **Filtering**: Implements all 5 PNG filter types (None, Sub, Up, Average, Paeth)
4. **Pixel Manipulation**: Copies pixel regions between images
5. **Compression**: Recompresses image data with optimal filtering
6. **PNG Writing**: Builds valid PNG files with proper chunk structure

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Run example
npm run example
```

## Testing

The library includes comprehensive tests covering:

- PNG signature validation
- Chunk reading and writing
- CRC32 validation
- IHDR parsing and creation
- Filter algorithms (all 5 types)
- Round-trip filter/unfilter operations
- Image concatenation (horizontal, vertical, grid)
- Error handling and validation

All 62 tests pass with 100% success rate.

## Performance Considerations

- **Memory Usage**: The library processes images in scanline order, but currently loads full images into memory. For very large images, consider the total output size.
- **Compression**: Uses zlib level 9 (maximum compression) which is slower but produces smaller files.
- **Filter Selection**: Automatically selects the best filter for each scanline to optimize compression.

## Browser Support

Works in all modern browsers that support:
- ES2022
- `CompressionStream` / `DecompressionStream` APIs
- `Uint8Array`

For Node.js: Requires Node.js 18.0.0 or later.

## Limitations

- Currently requires all input images to have the same dimensions
- Does not support interlaced PNGs
- Does not support palette-based (color type 3) PNGs
- Does not preserve ancillary chunks (tEXt, tIME, etc.)

## License

MIT

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `npm test`
2. Code follows TypeScript best practices
3. New features include tests
4. Documentation is updated

## Related Projects

- [pngjs](https://www.npmjs.com/package/pngjs) - PNG encoder/decoder
- [sharp](https://www.npmjs.com/package/sharp) - High-performance image processing
- [jimp](https://www.npmjs.com/package/jimp) - Image manipulation library

This library differs by being:
- Zero dependencies (no external packages)
- No canvas required
- Focused specifically on concatenation
- Full TypeScript support

## Support

For issues and questions:
- GitHub Issues: [Report a bug or request a feature](https://github.com/jburnhams/Png-concat/issues)
- Documentation: Check this README and inline code comments
