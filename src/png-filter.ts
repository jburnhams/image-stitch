/**
 * PNG Filter Types
 * Each scanline in a PNG is preceded by a filter type byte
 */
export enum FilterType {
  None = 0,
  Sub = 1,
  Up = 2,
  Average = 3,
  Paeth = 4
}

/**
 * Paeth predictor function used in PNG filtering
 */
function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Unfilter a PNG scanline
 * @param filterType The filter type byte
 * @param scanline The filtered scanline (without filter type byte)
 * @param previousLine The previous unfiltered scanline (or null for first line)
 * @param bytesPerPixel Number of bytes per pixel
 */
export function unfilterScanline(
  filterType: FilterType,
  scanline: Uint8Array,
  previousLine: Uint8Array | null,
  bytesPerPixel: number
): Uint8Array {
  const result = new Uint8Array(scanline.length);

  switch (filterType) {
    case FilterType.None:
      result.set(scanline);
      break;

    case FilterType.Sub:
      for (let i = 0; i < scanline.length; i++) {
        const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
        result[i] = (scanline[i] + left) & 0xff;
      }
      break;

    case FilterType.Up:
      for (let i = 0; i < scanline.length; i++) {
        const up = previousLine ? previousLine[i] : 0;
        result[i] = (scanline[i] + up) & 0xff;
      }
      break;

    case FilterType.Average:
      for (let i = 0; i < scanline.length; i++) {
        const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
        const up = previousLine ? previousLine[i] : 0;
        result[i] = (scanline[i] + Math.floor((left + up) / 2)) & 0xff;
      }
      break;

    case FilterType.Paeth:
      for (let i = 0; i < scanline.length; i++) {
        const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
        const up = previousLine ? previousLine[i] : 0;
        const upLeft = previousLine && i >= bytesPerPixel ? previousLine[i - bytesPerPixel] : 0;
        result[i] = (scanline[i] + paethPredictor(left, up, upLeft)) & 0xff;
      }
      break;

    default:
      throw new Error(`Unknown filter type: ${filterType}`);
  }

  return result;
}

/**
 * Apply Sub filter to a scanline
 */
function filterSub(scanline: Uint8Array, bytesPerPixel: number): Uint8Array {
  const result = new Uint8Array(scanline.length);
  for (let i = 0; i < scanline.length; i++) {
    const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
    result[i] = (scanline[i] - left) & 0xff;
  }
  return result;
}

/**
 * Apply Up filter to a scanline
 */
function filterUp(scanline: Uint8Array, previousLine: Uint8Array | null): Uint8Array {
  const result = new Uint8Array(scanline.length);
  for (let i = 0; i < scanline.length; i++) {
    const up = previousLine ? previousLine[i] : 0;
    result[i] = (scanline[i] - up) & 0xff;
  }
  return result;
}

/**
 * Apply Average filter to a scanline
 */
function filterAverage(
  scanline: Uint8Array,
  previousLine: Uint8Array | null,
  bytesPerPixel: number
): Uint8Array {
  const result = new Uint8Array(scanline.length);
  for (let i = 0; i < scanline.length; i++) {
    const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
    const up = previousLine ? previousLine[i] : 0;
    result[i] = (scanline[i] - Math.floor((left + up) / 2)) & 0xff;
  }
  return result;
}

/**
 * Apply Paeth filter to a scanline
 */
function filterPaeth(
  scanline: Uint8Array,
  previousLine: Uint8Array | null,
  bytesPerPixel: number
): Uint8Array {
  const result = new Uint8Array(scanline.length);
  for (let i = 0; i < scanline.length; i++) {
    const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
    const up = previousLine ? previousLine[i] : 0;
    const upLeft = previousLine && i >= bytesPerPixel ? previousLine[i - bytesPerPixel] : 0;
    result[i] = (scanline[i] - paethPredictor(left, up, upLeft)) & 0xff;
  }
  return result;
}

/**
 * Choose the best filter for a scanline and apply it
 * Uses a simple heuristic: choose the filter that produces the smallest sum of absolute values
 */
export function filterScanline(
  scanline: Uint8Array,
  previousLine: Uint8Array | null,
  bytesPerPixel: number
): { filterType: FilterType; filtered: Uint8Array } {
  // Try different filters and choose the best one
  const candidates = [
    { type: FilterType.None, data: scanline },
    { type: FilterType.Sub, data: filterSub(scanline, bytesPerPixel) },
    { type: FilterType.Up, data: filterUp(scanline, previousLine) },
    { type: FilterType.Average, data: filterAverage(scanline, previousLine, bytesPerPixel) },
    { type: FilterType.Paeth, data: filterPaeth(scanline, previousLine, bytesPerPixel) }
  ];

  // Calculate sum of absolute values for each filter
  let bestFilter = candidates[0];
  let bestSum = Infinity;

  for (const candidate of candidates) {
    let sum = 0;
    for (let i = 0; i < candidate.data.length; i++) {
      // Treat bytes as signed for better filter selection
      const signed = candidate.data[i] > 127 ? candidate.data[i] - 256 : candidate.data[i];
      sum += Math.abs(signed);
    }

    if (sum < bestSum) {
      bestSum = sum;
      bestFilter = candidate;
    }
  }

  return { filterType: bestFilter.type, filtered: bestFilter.data };
}

/**
 * Calculate bytes per pixel from PNG header information
 */
export function getBytesPerPixel(bitDepth: number, colorType: number): number {
  // ColorType: 0=grayscale, 2=RGB, 3=palette, 4=grayscale+alpha, 6=RGBA
  let samplesPerPixel = 1;

  switch (colorType) {
    case 0: // Grayscale
      samplesPerPixel = 1;
      break;
    case 2: // RGB
      samplesPerPixel = 3;
      break;
    case 3: // Palette
      samplesPerPixel = 1;
      break;
    case 4: // Grayscale + Alpha
      samplesPerPixel = 2;
      break;
    case 6: // RGBA
      samplesPerPixel = 4;
      break;
    default:
      throw new Error(`Unknown color type: ${colorType}`);
  }

  return Math.ceil((samplesPerPixel * bitDepth) / 8);
}
