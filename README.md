# image-stitch

[![CI](https://github.com/jburnhams/Png-concat/actions/workflows/ci.yml/badge.svg)](https://github.com/jburnhams/Png-concat/actions/workflows/ci.yml)


A streaming PNG concatenation library for Node.js and web browsers that works without canvas and can handle large files efficiently.

## Features

- **No Canvas Required**: Pure JavaScript/TypeScript implementation
- **Streaming Output**: Stream PNG output chunks without holding the entire result in memory
- **Cross-Platform**: Works in both Node.js and modern browsers
- **Zero Dependencies**: No external libraries required (uses only built-in APIs)
- **Type Safe**: Written in TypeScript with full type definitions
- **Well Tested**: Comprehensive unit test coverage (107 tests)
- **Flexible Layouts**: Horizontal, vertical, or grid arrangements
- **Arbitrary Image Sizes**: Automatically handles images of different dimensions with transparent padding
- **Pixel-Based Limits**: Control output size with width/height constraints that wrap or stop as needed

## Installation

```bash
npm install image-stitch
```

## Quick Start

```typescript
import { concatPngs } from 'image-stitch';
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

**Example - Arbitrary Image Sizes:**

```typescript
// Images with different dimensions are automatically padded with transparency
const result = await concatPngs({
  inputs: [
    'small_100x100.png',
    'medium_200x150.png',
    'large_300x250.png'
  ],
  layout: { columns: 3 }
  // Output: Uses max height per row and pads smaller images
});
```

**Example - Pixel-Based Limits:**

```typescript
// Limit output to max 800px wide - images wrap to new rows
const result = await concatPngs({
  inputs: ['img1.png', 'img2.png', 'img3.png', 'img4.png'],
  layout: { width: 800 }  // Automatically wraps to fit within width
});

// Limit output to max 600px tall - stops when height limit reached
const result = await concatPngs({
  inputs: ['img1.png', 'img2.png', 'img3.png', 'img4.png'],
  layout: { height: 600, columns: 1 }  // Vertical stack up to 600px
});
```

### Requirements

- All input images must have the same bit depth and color type
- Supports arbitrary image dimensions (images are padded with transparent background to fit)
- Supports 8-bit and 16-bit images
- Supports RGB, RGBA, Grayscale, and Grayscale+Alpha

## Streaming API

For applications that need to stream the output (e.g., HTTP responses, large files), use the streaming API:

### `concatPngsStream(options: ConcatOptions): AsyncGenerator<Uint8Array>`

Returns an async generator that yields PNG chunks as they are generated.

```typescript
import { concatPngsStream } from 'image-stitch';
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
import { concatPngsToStream } from 'image-stitch';
import { createWriteStream } from 'fs';

const readStream = concatPngsToStream({
  inputs: ['img1.png', 'img2.png'],
  layout: { columns: 2 }
});

readStream.pipe(createWriteStream('output.png'));
```

**Streaming to HTTP Response:**

```typescript
import { concatPngsToStream } from 'image-stitch';

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
import { parsePngHeader, parsePngChunks } from 'image-stitch';

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
} from 'image-stitch';
import { PngHeader, ColorType } from 'image-stitch';

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
} from 'image-stitch';

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
2. **Decompression**: Uses Web Compression Streams API (DecompressionStream) which works in both Node.js 18+ and modern browsers
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
- **Arbitrary image sizes**: Variable dimensions with transparent padding
- **Pixel-based limits**: Width/height constraints with row wrapping
- Error handling and validation
- **PngSuite integration**: Validates compatibility with the official PNG test suite created by Willem van Schaik, containing 175+ test images covering diverse PNG formats and edge cases

All 107 tests pass with 100% success rate.

Coverage
--------

Run the coverage report locally with:

```bash
npm run coverage
```

This produces a text summary on the console and an lcov file at `coverage/lcov.info`. The CI workflow also generates coverage and uploads the `coverage/lcov.info` file as a workflow artifact for each run.

## PngSuite Integration

This library has been validated against [PngSuite](http://www.schaik.com/pngsuite/), the official PNG test suite created by Willem van Schaik. PngSuite contains 175+ test images that comprehensively test PNG implementations across various formats and edge cases.

The test suite (`src/pngsuite.test.ts`) validates:
- Parsing of all basic PNG color types (Grayscale, RGB, Indexed, Grayscale+Alpha, RGBA)
- Support for both 8-bit and 16-bit color depths
- Handling of interlaced images
- Concatenation of various PNG formats
- Correct chunk reading and validation

PngSuite test images are included in the `pngsuite/` directory and are automatically tested as part of the test suite.

## Performance Considerations

- **Memory Usage**: The library processes images in scanline order, but currently loads full images into memory. For very large images, consider the total output size.
- **Compression**: Uses Web Compression Streams API with 'deflate' compression which produces optimized PNG files.
- **Filter Selection**: Automatically selects the best filter for each scanline to optimize compression.

## Browser Support

Works in all modern browsers that support:
- ES2022
- `CompressionStream` / `DecompressionStream` APIs
- `Uint8Array`

For Node.js: Requires Node.js 18.0.0 or later.

## Limitations

- Does not support interlaced PNGs
- Does not support palette-based (color type 3) PNGs
- Does not preserve ancillary chunks (tEXt, tIME, etc.)
- All input images must have the same bit depth and color type (but can have different dimensions)

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
