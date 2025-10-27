# png-concat

A streaming PNG concatenation library for Node.js and web browsers that works without canvas and can handle large files efficiently.

## Features

- **No Canvas Required**: Pure JavaScript/TypeScript implementation
- **Streaming Support**: Process large files without loading everything into memory
- **Cross-Platform**: Works in both Node.js and modern browsers
- **Zero Dependencies**: No external libraries required (uses only built-in APIs)
- **Type Safe**: Written in TypeScript with full type definitions
- **Well Tested**: Comprehensive unit test coverage

## Installation

```bash
npm install png-concat
```

## Current Status

The library currently implements:

- **PNG Parser**: Read and validate PNG files, parse chunks, extract headers
- **PNG Writer**: Create PNG chunks, build PNG files from chunks
- **Utilities**: CRC32 validation, byte manipulation, PNG signature verification

### What's Working

- PNG file format parsing with CRC validation
- PNG chunk reading and writing
- Header (IHDR) parsing and creation
- Complete unit test suite (36 tests passing)

### Next Steps

To complete the concatenation functionality, the library needs to implement:

1. **Image data decompression** (using built-in zlib/CompressionStream)
2. **PNG filter handling** (unfilter scanlines)
3. **Pixel rearrangement** (arrange images in desired layout)
4. **Image data recompression** (filter and compress output)

## API Overview

### PNG Parsing

```typescript
import { parsePngHeader, parsePngChunks } from 'png-concat';

// Read PNG header information
const pngData = /* Uint8Array of PNG file */;
const header = parsePngHeader(pngData);
console.log(header);
// {
//   width: 640,
//   height: 480,
//   bitDepth: 8,
//   colorType: 6, // RGBA
//   compressionMethod: 0,
//   filterMethod: 0,
//   interlaceMethod: 0
// }

// Read all chunks
const chunks = parsePngChunks(pngData);
chunks.forEach(chunk => {
  console.log(`${chunk.type}: ${chunk.length} bytes`);
});
```

### PNG Writing

```typescript
import { createIHDR, createIEND, buildPng } from 'png-concat';

// Create a new PNG header
const header = {
  width: 100,
  height: 100,
  bitDepth: 8,
  colorType: 6, // RGBA
  compressionMethod: 0,
  filterMethod: 0,
  interlaceMethod: 0
};

const ihdr = createIHDR(header);
const iend = createIEND();

// Build a minimal PNG (header only, no image data)
const png = buildPng([ihdr, iend]);
```

### PNG Concatenation (Planned)

```typescript
import { concatPngs } from 'png-concat';

// Concatenate images horizontally (2 columns)
const result = await concatPngs({
  inputs: [pngData1, pngData2, pngData3, pngData4],
  layout: {
    columns: 2
  }
});

// Concatenate images vertically (1 column)
const result = await concatPngs({
  inputs: [pngData1, pngData2, pngData3],
  layout: {
    rows: 3
  }
});

// Specify exact output dimensions
const result = await concatPngs({
  inputs: [pngData1, pngData2, pngData3, pngData4],
  layout: {
    width: 800,
    height: 600
  }
});
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

## Technical Details

### PNG File Format

The library implements the PNG specification including:

- **Signature verification**: Validates the 8-byte PNG signature
- **Chunk parsing**: Reads chunk structure (length, type, data, CRC)
- **CRC validation**: Verifies chunk integrity using CRC32
- **IHDR parsing**: Extracts image header information
- **Chunk serialization**: Creates valid PNG chunks with proper CRC

### Architecture

The library is organized into several modules:

- **types.ts**: TypeScript type definitions
- **utils.ts**: CRC32 calculation, byte manipulation, PNG signature
- **png-parser.ts**: PNG file parsing and chunk reading
- **png-writer.ts**: PNG chunk creation and file building
- **png-concat.ts**: Main concatenation logic (in progress)

### Testing

The library includes comprehensive unit tests covering:

- CRC32 calculation
- Byte manipulation (big-endian integers)
- String/byte conversion
- PNG signature validation
- Chunk reading and writing
- IHDR parsing and creation
- PNG file building
- Error handling and validation

All tests are written using Node.js built-in test runner.

## License

MIT

## Contributing

Contributions are welcome! Please ensure all tests pass and add new tests for any new functionality.

```bash
npm run build && npm test
```
