# Performance Analysis

## Issue: Slow Memory Tests (~2 minutes for 10000x10000)

### Root Causes Identified:

1. **Redundant PNG Parsing** (MAJOR BOTTLENECK)
   - For 10000x10000 made of 32x32 tiles: ~97,969 tile instances
   - Each tile instance creates a new `Uint8ArrayInputAdapter`
   - Each adapter calls `parsePngChunks()` every time `scanlines()` is called
   - Each adapter decompresses the SAME 32x32 PNG ~97,969 times!

   **Impact**: Parsing + decompressing same data 97,969 times instead of once

2. **Inefficient Buffer Concatenation** (MODERATE BOTTLENECK)
   - In `decodeScanlinesFromCompressedData` (lines 94-97)
   - Creates new `Uint8Array(buffer.length + value.length)` for every decompression chunk
   - Copies all existing data plus new chunk
   - For a 32x32 image with multiple chunks, this creates many temporary arrays

3. **No Caching of Repeated Images**
   - When same Uint8Array is used 1000s of times, no sharing of parsed/decompressed data
   - Each use creates full new adapter + decompression

### Performance Breakdown for 10000x10000 test:

```
Tiles: 313 x 313 = 97,969 instances of same 32x32 PNG
Operations per tile:
  - Parse PNG chunks: ~100 bytes parsed
  - Find IDAT chunks: iterate through chunks
  - Concatenate IDAT: allocate + copy
  - Decompress: WebStream decompression
  - Generate 32 scanlines

Total operations: 97,969 * (parse + decompress + scanline generation)
Time: ~113 seconds
Rate: ~866 tiles/second (should be 10,000+/sec)
```

### Optimizations Needed:

1. **Cache parsed/decompressed data for Uint8Array inputs**
   - Use WeakMap to cache by input reference
   - Share decompressed scanlines when same Uint8Array used multiple times

2. **Optimize buffer concatenation**
   - Use array of chunks instead of repeatedly concatenating
   - Only merge when needed for processing

3. **Increase pako batch size**
   - Currently 1MB batches
   - Could use larger batches (10MB+) for large images
