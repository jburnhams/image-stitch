# True Streaming Architecture for PNG Concatenation

This document outlines a true streaming approach where we only read input images as needed during output generation, minimizing memory usage.

## Current vs. True Streaming

### Current Implementation
```
Memory Usage: O(total_input_size + output_size)

1. Load all input images into memory
2. Decompress all input images
3. Build complete output pixel buffer
4. Compress output
5. Stream compressed chunks
```

### True Streaming Implementation
```
Memory Usage: O(input_row_size * num_images + output_row_size + compression_buffer)

1. PASS 1: Read headers only (~33 bytes per image)
   - Validate dimensions and format
   - Calculate output dimensions
   - Store file handles/streams

2. PASS 2: Process scanline-by-scanline
   For each output row:
   - Read only the needed input scanlines
   - Combine into output scanline
   - Filter output scanline
   - Feed to streaming compressor
   - Yield compressed chunks as available
```

## Architecture Design

### Two-Pass Approach

#### Pass 1: Validation & Planning
```typescript
// Read only headers (< 100 bytes per image)
for each input image:
  - Open file/stream
  - Read PNG signature (8 bytes)
  - Read IHDR chunk (25 bytes)
  - Validate format compatibility
  - Store file position after IHDR

// Calculate output layout
- Determine grid dimensions
- Calculate total output size
- Prepare output header
```

#### Pass 2: Scanline Streaming
```typescript
// Initialize streaming compression
const deflateStream = createDeflate({ level: 9 });

// Process each output row
for y = 0 to outputHeight - 1:
  // Determine which input images contribute to this row
  inputRow = floor(y / inputImageHeight)
  localY = y % inputImageHeight

  // Read scanlines from all images in this row
  for x = 0 to imagesPerRow - 1:
    imageIndex = inputRow * imagesPerRow + x
    scanline = readScanline(imageIndex, localY)
    // Decompress and unfilter just this scanline

  // Combine scanlines into output row
  outputScanline = combine(scanlines)

  // Filter and compress
  filteredScanline = applyBestFilter(outputScanline, previousOutputScanline)
  deflateStream.write(filteredScanline)

  // Yield any compressed chunks ready
  while (chunk = deflateStream.read()):
    yield createIDATChunk(chunk)
```

## Key Components Needed

### 1. Streaming Input Reader
```typescript
class StreamingPngReader {
  private fileHandle: FileHandle;
  private idatBuffer: Buffer;
  private decompressStream: InflateStream;
  private currentScanline: number;

  // Initialize decompression stream positioned at IDAT chunks
  async init(): Promise<void>

  // Read a specific scanline (may need to decompress previous ones)
  async readScanline(lineNumber: number): Promise<Uint8Array>

  // Release resources
  async close(): Promise<void>
}
```

### 2. Streaming Compressor
```typescript
class StreamingPngCompressor {
  private deflateStream: zlib.Deflate;
  private previousScanline: Uint8Array | null;

  // Add a scanline to compress
  writeScanline(scanline: Uint8Array): void {
    const filtered = filterScanline(scanline, previousScanline);
    this.deflateStream.write(filtered);
  }

  // Get compressed chunks as they're ready
  *readChunks(): Generator<Uint8Array>

  // Finalize compression
  async end(): Promise<void>
}
```

### 3. Scanline Combiner
```typescript
class ScanlineCombiner {
  // Combine multiple input scanlines into one output scanline
  combine(
    inputScanlines: Uint8Array[],
    layout: { columns: number }
  ): Uint8Array {
    // Horizontally concatenate the scanlines
    const output = new Uint8Array(totalWidth * bytesPerPixel);

    for (let i = 0; i < inputScanlines.length; i++) {
      const col = i % layout.columns;
      const offset = col * inputWidth * bytesPerPixel;
      output.set(inputScanlines[i], offset);
    }

    return output;
  }
}
```

## Memory Analysis

### Current Implementation
```
For 4x 1000x1000 RGBA images → 2000x2000 output:

Input images:  4 * 1000 * 1000 * 4 = 16 MB
Output buffer: 2000 * 2000 * 4     = 16 MB
Total:                              = 32 MB
```

### True Streaming Implementation
```
For same 4x 1000x1000 RGBA images:

Active input scanlines: 2 * 1000 * 4  = 8 KB  (2 images per row)
Output scanline:       2000 * 4       = 8 KB
Compression buffer:    ~32 KB
Decompression buffers: 4 * 32 KB     = 128 KB
Total:                                ≈ 176 KB (182x reduction!)
```

## Challenges & Solutions

### Challenge 1: Random Access to Scanlines
**Problem**: PNG compression is sequential - can't easily read scanline N without reading 0 to N-1

**Solutions**:
A. **Sequential processing** (Best for streaming)
   - Process images row-by-row naturally
   - Each input reader maintains position
   - No seeking needed

B. **Buffered approach**
   - Keep recent scanlines in memory per input
   - Small LRU cache of scanlines
   - Memory: O(buffer_size * num_images)

### Challenge 2: Input Image Decompression
**Problem**: Each input image needs its own decompression stream

**Solution**:
```typescript
class InputImageStream {
  private inflateStream: zlib.Inflate;
  private scanlinesRead: number = 0;

  async *scanlines(): AsyncGenerator<Uint8Array> {
    // Stream IDAT chunks to inflate
    for await (const idatChunk of this.readIDATChunks()) {
      this.inflateStream.write(idatChunk);
    }

    // Yield scanlines as they're decompressed
    while (scanlineData = this.inflateStream.read(scanlineLength + 1)) {
      const filterType = scanlineData[0];
      const scanline = scanlineData.slice(1);
      yield unfilterScanline(filterType, scanline, this.previousScanline);
      this.scanlinesRead++;
    }
  }
}
```

### Challenge 3: Coordinating Multiple Input Streams
**Problem**: Need to read from 2+ input images simultaneously for each output row

**Solution**:
```typescript
async function* streamOutputScanlines(
  inputStreams: InputImageStream[],
  layout: { columns: number, rows: number }
) {
  // Create async iterators for each input
  const iterators = inputStreams.map(s => s.scanlines());

  const imageHeight = inputStreams[0].height;

  // For each output row
  for (let outputY = 0; outputY < layout.rows * imageHeight; outputY++) {
    const inputRow = Math.floor(outputY / imageHeight);
    const localY = outputY % imageHeight;

    // Read scanline from each image in this row
    const scanlines: Uint8Array[] = [];
    for (let col = 0; col < layout.columns; col++) {
      const imageIndex = inputRow * layout.columns + col;
      if (imageIndex < inputStreams.length) {
        const { value } = await iterators[imageIndex].next();
        scanlines.push(value);
      }
    }

    // Combine and yield
    yield combineScanlines(scanlines);
  }
}
```

## Implementation Roadmap

### Phase 1: Streaming Input Readers
- [ ] Implement StreamingPngReader class
- [ ] Handle IDAT chunk streaming
- [ ] Incremental decompression
- [ ] Scanline unflitering on-the-fly

### Phase 2: Streaming Output Writer
- [ ] Implement StreamingPngCompressor
- [ ] Integrate zlib.createDeflate() for streaming compression
- [ ] Dynamic filter selection per scanline
- [ ] IDAT chunk generation (can split into multiple chunks)

### Phase 3: Orchestration
- [ ] Two-pass coordinator
- [ ] Multiple input stream coordination
- [ ] Scanline combination logic
- [ ] Memory-efficient buffering

### Phase 4: Optimization
- [ ] Worker threads for parallel decompression
- [ ] Adaptive buffering based on memory constraints
- [ ] Progress callbacks
- [ ] Cancellation support

## Example Usage (Future API)

```typescript
import { concatPngsTrueStreaming } from 'png-concat';

// Memory usage stays constant regardless of output size!
const stream = await concatPngsTrueStreaming({
  inputs: [
    'huge-image-1.png', // 10000x10000
    'huge-image-2.png',
    'huge-image-3.png',
    'huge-image-4.png'
  ],
  layout: { columns: 2 },
  streaming: {
    scanlineBufferSize: 10, // Keep 10 scanlines buffered per input
    maxMemoryMB: 100        // Limit total memory usage
  }
});

// Stream to HTTP response
stream.pipe(res);

// Progress tracking
stream.on('progress', ({ scanlinesProcessed, totalScanlines }) => {
  console.log(`${(scanlinesProcessed / totalScanlines * 100).toFixed(1)}%`);
});
```

## Performance Characteristics

### Current Implementation
```
Time:   O(total_pixels)
Memory: O(total_input_size + output_size)
Disk:   All inputs read upfront
```

### True Streaming Implementation
```
Time:   O(total_pixels) + overhead for stream coordination
Memory: O(rows_in_flight * row_size)
Disk:   Inputs read on-demand, sequential I/O
```

## Benefits Summary

1. **Constant Memory Usage**: Handle arbitrarily large outputs
2. **Lower Peak Memory**: ~100-200x reduction for large images
3. **Streaming Inputs**: Can process inputs from network streams
4. **Better I/O**: Sequential file access vs. random
5. **Progressive Output**: Start writing before all inputs read
6. **Scalability**: Can concatenate 100+ images efficiently

## Limitations

1. **Sequential Only**: Can't easily seek to arbitrary output rows
2. **Complexity**: More code to maintain multiple stream states
3. **Latency**: Slight overhead from stream coordination
4. **Error Handling**: Need to handle stream errors gracefully

## Conclusion

True streaming would provide massive memory benefits for large-scale concatenation. The two-pass approach with scanline-by-scanline processing is the ideal architecture, requiring careful coordination of multiple input streams and streaming compression.

The implementation would be more complex but enable use cases like:
- Concatenating high-resolution images (4K, 8K)
- Server-side image processing with memory limits
- Processing images from network sources
- Creating large sprite sheets or texture atlases
