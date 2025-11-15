/**
 * Memory monitoring utilities for testing
 *
 * These utilities help measure and assert memory usage during tests,
 * ensuring the streaming implementation maintains low memory footprint.
 */

export interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  timestamp: number;
}

export interface MemoryMeasurement {
  before: MemorySnapshot;
  after: MemorySnapshot;
  peak: MemorySnapshot;
  delta: {
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
}

/**
 * Force garbage collection if available
 * Run tests with --expose-gc flag to enable
 */
export function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

/**
 * Check if GC is available
 */
export function isGCAvailable(): boolean {
  return typeof global.gc === 'function';
}

/**
 * Take a memory snapshot
 */
export function takeSnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
    timestamp: Date.now()
  };
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Monitor memory usage during an async operation
 *
 * @param operation - The async operation to monitor
 * @param sampleInterval - How often to check memory (ms), default 50ms
 * @returns Memory measurement with before/after/peak snapshots
 */
export async function monitorMemory<T>(
  operation: () => Promise<T>,
  sampleInterval = 50
): Promise<{ result: T; measurement: MemoryMeasurement }> {
  // Force GC before measurement if available
  forceGC();
  await new Promise(resolve => setTimeout(resolve, 100));
  forceGC();

  const before = takeSnapshot();
  let peak = before;
  let isComplete = false;

  // Start monitoring in background
  const monitoringTask = (async () => {
    while (!isComplete) {
      await new Promise(resolve => setTimeout(resolve, sampleInterval));
      const current = takeSnapshot();
      if (current.heapUsed > peak.heapUsed) {
        peak = current;
      }
    }
  })();

  // Run the operation
  const result = await operation();

  // Stop monitoring
  isComplete = true;
  await monitoringTask;

  // Force GC after operation
  forceGC();
  await new Promise(resolve => setTimeout(resolve, 100));

  const after = takeSnapshot();

  const measurement: MemoryMeasurement = {
    before,
    after,
    peak,
    delta: {
      heapUsed: peak.heapUsed - before.heapUsed,
      external: peak.external - before.external,
      arrayBuffers: peak.arrayBuffers - before.arrayBuffers
    }
  };

  return { result, measurement };
}

/**
 * Assert that memory usage stays below a threshold
 *
 * @param measurement - Memory measurement from monitorMemory
 * @param maxBytes - Maximum allowed memory increase in bytes
 * @param metric - Which metric to check ('heapUsed', 'external', or 'arrayBuffers')
 */
export function assertMemoryBelow(
  measurement: MemoryMeasurement,
  maxBytes: number,
  metric: keyof MemoryMeasurement['delta'] = 'heapUsed'
): void {
  const delta = measurement.delta[metric];
  if (delta > maxBytes) {
    throw new Error(
      `Memory usage exceeded threshold:\n` +
      `  Metric: ${metric}\n` +
      `  Expected: < ${formatBytes(maxBytes)}\n` +
      `  Actual: ${formatBytes(delta)}\n` +
      `  Before: ${formatBytes(measurement.before[metric])}\n` +
      `  Peak: ${formatBytes(measurement.peak[metric])}\n` +
      `  After: ${formatBytes(measurement.after[metric])}\n`
    );
  }
}

/**
 * Calculate expected memory usage for an image
 * Used to set reasonable thresholds
 */
export function calculateExpectedMemory(
  width: number,
  height: number,
  bytesPerPixel: number,
  compressionFactor = 0.1 // Assume ~10x compression
): {
  uncompressedSize: number;
  compressedSize: number;
  reasonableLimit: number;
} {
  const uncompressedSize = width * height * bytesPerPixel;
  const compressedSize = Math.ceil(uncompressedSize * compressionFactor);

  // Reasonable limit: Allow up to 10x the compressed size for intermediate buffers
  // This should be well below the uncompressed size for large images
  const reasonableLimit = Math.max(compressedSize * 10, 50 * 1024 * 1024); // At least 50MB

  return {
    uncompressedSize,
    compressedSize,
    reasonableLimit
  };
}

/**
 * Print detailed memory report
 */
export function printMemoryReport(measurement: MemoryMeasurement): void {
  console.log('\n=== Memory Report ===');
  console.log(`Before operation:`);
  console.log(`  Heap Used: ${formatBytes(measurement.before.heapUsed)}`);
  console.log(`  External: ${formatBytes(measurement.before.external)}`);
  console.log(`  Array Buffers: ${formatBytes(measurement.before.arrayBuffers)}`);

  console.log(`\nPeak during operation:`);
  console.log(`  Heap Used: ${formatBytes(measurement.peak.heapUsed)}`);
  console.log(`  External: ${formatBytes(measurement.peak.external)}`);
  console.log(`  Array Buffers: ${formatBytes(measurement.peak.arrayBuffers)}`);

  console.log(`\nAfter operation:`);
  console.log(`  Heap Used: ${formatBytes(measurement.after.heapUsed)}`);
  console.log(`  External: ${formatBytes(measurement.after.external)}`);
  console.log(`  Array Buffers: ${formatBytes(measurement.after.arrayBuffers)}`);

  console.log(`\nDelta (Peak - Before):`);
  console.log(`  Heap Used: ${formatBytes(measurement.delta.heapUsed)}`);
  console.log(`  External: ${formatBytes(measurement.delta.external)}`);
  console.log(`  Array Buffers: ${formatBytes(measurement.delta.arrayBuffers)}`);
  console.log('===================\n');
}

/**
 * Assert memory usage is proportional to output size, not input processing
 * This is the key test for streaming efficiency
 */
export function assertStreamingEfficiency(
  measurement: MemoryMeasurement,
  outputSizeBytes: number,
  maxMultiplier = 15 // Allow up to 15x the output size during processing
): void {
  const delta = measurement.delta.heapUsed;
  const threshold = outputSizeBytes * maxMultiplier;

  if (delta > threshold) {
    throw new Error(
      `Memory usage suggests non-streaming behavior:\n` +
      `  Output size: ${formatBytes(outputSizeBytes)}\n` +
      `  Expected max: ${formatBytes(threshold)} (${maxMultiplier}x output)\n` +
      `  Actual peak delta: ${formatBytes(delta)}\n` +
      `  Ratio: ${(delta / outputSizeBytes).toFixed(2)}x\n` +
      `\n` +
      `This suggests intermediate buffers are too large.\n` +
      `For true streaming, memory should be proportional to output size,\n` +
      `not intermediate uncompressed data size.`
    );
  }
}
