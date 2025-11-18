import { PngHeader } from './types.js';
import { getBytesPerPixel } from './png-filter.js';
import { getSamplesPerPixel } from './utils.js';

/**
 * Parse a background color specification into RGBA values (0-255)
 */
export function parseBackgroundColor(
  color: string | [number, number, number] | [number, number, number, number] | undefined
): [number, number, number, number] {
  // Default: transparent black
  if (color === undefined || color === 'transparent') {
    return [0, 0, 0, 0];
  }

  // Array format
  if (Array.isArray(color)) {
    if (color.length === 3) {
      const [r, g, b] = color;
      if (!Number.isInteger(r) || !Number.isInteger(g) || !Number.isInteger(b) ||
          r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
        throw new Error('RGB color values must be integers between 0 and 255');
      }
      return [r, g, b, 255]; // Opaque
    } else if (color.length === 4) {
      const [r, g, b, a] = color;
      if (!Number.isInteger(r) || !Number.isInteger(g) || !Number.isInteger(b) || !Number.isInteger(a) ||
          r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255 || a < 0 || a > 255) {
        throw new Error('RGBA color values must be integers between 0 and 255');
      }
      return [r, g, b, a];
    } else {
      throw new Error('Color array must have 3 (RGB) or 4 (RGBA) values');
    }
  }

  // Named colors
  const namedColors: Record<string, [number, number, number, number]> = {
    'black': [0, 0, 0, 255],
    'white': [255, 255, 255, 255],
    'red': [255, 0, 0, 255],
    'green': [0, 255, 0, 255],
    'blue': [0, 0, 255, 255],
    'yellow': [255, 255, 0, 255],
    'cyan': [0, 255, 255, 255],
    'magenta': [255, 0, 255, 255],
    'gray': [128, 128, 128, 255],
    'grey': [128, 128, 128, 255]
  };

  const lowerColor = color.toLowerCase();
  if (lowerColor in namedColors) {
    return namedColors[lowerColor];
  }

  // Hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    let r: number, g: number, b: number, a = 255;

    if (hex.length === 3 || hex.length === 4) {
      // Short format: #RGB or #RGBA
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      if (hex.length === 4) {
        a = parseInt(hex[3] + hex[3], 16);
      }
    } else if (hex.length === 6 || hex.length === 8) {
      // Long format: #RRGGBB or #RRGGBBAA
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) {
        a = parseInt(hex.slice(6, 8), 16);
      }
    } else {
      throw new Error(`Invalid hex color format: ${color}. Expected #RGB, #RGBA, #RRGGBB, or #RRGGBBAA`);
    }

    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
      throw new Error(`Invalid hex color: ${color}`);
    }

    return [r, g, b, a];
  }

  throw new Error(`Unsupported color format: ${color}. Use hex (#RRGGBB), RGB array [r,g,b], or named color`);
}

/**
 * Convert RGBA color to format-specific color value
 */
function rgbaToColorType(
  rgba: [number, number, number, number],
  colorType: number,
  bitDepth: number
): Uint8Array {
  const [r, g, b, a] = rgba;

  // Helper to scale 8-bit value to target bit depth
  const scale = (value: number): number => {
    if (bitDepth === 16) {
      // Scale 8-bit to 16-bit
      return Math.round((value * 0xFFFF) / 0xFF);
    } else if (bitDepth === 8) {
      return value;
    } else {
      // For bit depths < 8, scale to max value
      const maxVal = (1 << bitDepth) - 1;
      return Math.round((value * maxVal) / 0xFF);
    }
  };

  // Helper to write 16-bit value
  const write16 = (value: number): [number, number] => {
    return [(value >> 8) & 0xFF, value & 0xFF];
  };

  switch (colorType) {
    case 0: // Grayscale
      {
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b); // Luminance
        const scaledGray = scale(gray);
        if (bitDepth === 16) {
          return new Uint8Array(write16(scaledGray));
        } else if (bitDepth === 8) {
          return new Uint8Array([scaledGray]);
        } else {
          // Sub-byte formats not supported for custom colors
          return new Uint8Array([scaledGray]);
        }
      }
    case 2: // RGB
      if (bitDepth === 16) {
        const r16 = scale(r);
        const g16 = scale(g);
        const b16 = scale(b);
        return new Uint8Array([...write16(r16), ...write16(g16), ...write16(b16)]);
      } else {
        return new Uint8Array([scale(r), scale(g), scale(b)]);
      }
    case 4: // Grayscale + Alpha
      {
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const scaledGray = scale(gray);
        const scaledAlpha = scale(a);
        if (bitDepth === 16) {
          return new Uint8Array([...write16(scaledGray), ...write16(scaledAlpha)]);
        } else {
          return new Uint8Array([scaledGray, scaledAlpha]);
        }
      }
    case 6: // RGBA
      if (bitDepth === 16) {
        const r16 = scale(r);
        const g16 = scale(g);
        const b16 = scale(b);
        const a16 = scale(a);
        return new Uint8Array([...write16(r16), ...write16(g16), ...write16(b16), ...write16(a16)]);
      } else {
        return new Uint8Array([scale(r), scale(g), scale(b), scale(a)]);
      }
    default:
      throw new Error(`Unsupported color type: ${colorType}`);
  }
}

/**
 * Copy a rectangular region from one image to another
 */
export function copyPixelRegion(
  src: Uint8Array,
  srcHeader: PngHeader,
  dst: Uint8Array,
  dstHeader: PngHeader,
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  width: number,
  height: number
): void {
  const bytesPerPixel = getBytesPerPixel(srcHeader.bitDepth, srcHeader.colorType);
  const srcRowBytes = Math.ceil((srcHeader.width * srcHeader.bitDepth * getSamplesPerPixel(srcHeader.colorType)) / 8);
  const dstRowBytes = Math.ceil((dstHeader.width * dstHeader.bitDepth * getSamplesPerPixel(dstHeader.colorType)) / 8);
  const copyBytes = width * bytesPerPixel;

  for (let y = 0; y < height; y++) {
    const srcOffset = (srcY + y) * srcRowBytes + srcX * bytesPerPixel;
    const dstOffset = (dstY + y) * dstRowBytes + dstX * bytesPerPixel;

    dst.set(src.slice(srcOffset, srcOffset + copyBytes), dstOffset);
  }
}

/**
 * Fill a rectangular region with a solid color
 */
export function fillPixelRegion(
  dst: Uint8Array,
  dstHeader: PngHeader,
  dstX: number,
  dstY: number,
  width: number,
  height: number,
  color: Uint8Array
): void {
  const bytesPerPixel = getBytesPerPixel(dstHeader.bitDepth, dstHeader.colorType);
  const dstRowBytes = Math.ceil((dstHeader.width * dstHeader.bitDepth * getSamplesPerPixel(dstHeader.colorType)) / 8);

  if (color.length !== bytesPerPixel) {
    throw new Error(`Color must have ${bytesPerPixel} bytes`);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dstOffset = (dstY + y) * dstRowBytes + (dstX + x) * bytesPerPixel;
      dst.set(color, dstOffset);
    }
  }
}

/**
 * Create a blank image with all pixels set to a color
 */
export function createBlankImage(
  header: PngHeader,
  backgroundColor: Uint8Array = new Uint8Array([0, 0, 0, 0])
): Uint8Array {
  const bytesPerPixel = getBytesPerPixel(header.bitDepth, header.colorType);
  const rowBytes = Math.ceil((header.width * header.bitDepth * getSamplesPerPixel(header.colorType)) / 8);
  const totalBytes = header.height * rowBytes;
  const data = new Uint8Array(totalBytes);

  // Fill with background color
  if (backgroundColor.length !== bytesPerPixel) {
    // Adjust background color to match format
    backgroundColor = backgroundColor.slice(0, bytesPerPixel);
  }

  for (let i = 0; i < totalBytes; i += bytesPerPixel) {
    data.set(backgroundColor, i);
  }

  return data;
}

/**
 * Get background/transparent color for a given color type and bit depth
 * @param colorType - PNG color type (0=grayscale, 2=RGB, 4=grayscale+alpha, 6=RGBA)
 * @param bitDepth - Bit depth (8 or 16)
 * @param backgroundColor - Optional custom background color (default: transparent black)
 */
export function getTransparentColor(
  colorType: number,
  bitDepth: number,
  backgroundColor?: string | [number, number, number] | [number, number, number, number]
): Uint8Array {
  // If custom background color is specified, use it
  if (backgroundColor !== undefined) {
    const rgba = parseBackgroundColor(backgroundColor);
    return rgbaToColorType(rgba, colorType, bitDepth);
  }

  // Default: transparent black (legacy behavior)
  const bytesPerSample = bitDepth === 16 ? 2 : 1;

  switch (colorType) {
    case 0: // Grayscale - black
      return new Uint8Array(bytesPerSample).fill(0);
    case 2: // RGB - black
      return new Uint8Array(3 * bytesPerSample).fill(0);
    case 4: // Grayscale + Alpha - transparent black
      if (bitDepth === 16) {
        return new Uint8Array([0, 0, 0, 0]); // 16-bit: gray=0, alpha=0
      }
      return new Uint8Array([0, 0]); // 8-bit: gray=0, alpha=0
    case 6: // RGBA - transparent black
      if (bitDepth === 16) {
        return new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]); // R=0, G=0, B=0, A=0
      }
      return new Uint8Array([0, 0, 0, 0]); // R=0, G=0, B=0, A=0
    default:
      throw new Error(`Unsupported color type: ${colorType}`);
  }
}

/**
 * Determine the best common format for a set of PNG headers
 * Returns the bit depth and color type that can represent all images
 */
export function determineCommonFormat(headers: PngHeader[]): { bitDepth: number; colorType: number } {
  // Find the maximum bit depth
  let maxBitDepth = 8;

  for (const header of headers) {
    // Track bit depth (anything > 8 means we need 16-bit)
    if (header.bitDepth === 16) {
      maxBitDepth = 16;
    }
  }

  // Always use RGBA as target format for maximum compatibility
  // This simplifies the conversion logic
  return { bitDepth: maxBitDepth, colorType: 6 };
}

/**
 * Scale a sample value from one bit depth to another
 */
function scaleSample(value: number, fromBits: number, toBits: number): number {
  if (fromBits === toBits) return value;

  // Scale up: multiply by the ratio of max values
  if (fromBits < toBits) {
    const fromMax = (1 << fromBits) - 1;
    const toMax = (1 << toBits) - 1;
    return Math.round((value * toMax) / fromMax);
  }

  // Scale down: divide by the ratio
  const fromMax = (1 << fromBits) - 1;
  const toMax = (1 << toBits) - 1;
  return Math.round((value * toMax) / fromMax);
}

/**
 * Convert pixel data from one format to another
 * Converts any PNG format to RGBA (8-bit or 16-bit)
 */
export function convertPixelFormat(
  srcData: Uint8Array,
  srcHeader: PngHeader,
  targetBitDepth: number,
  targetColorType: number
): { data: Uint8Array; header: PngHeader } {
  // If already in target format, return as-is
  if (srcHeader.bitDepth === targetBitDepth && srcHeader.colorType === targetColorType) {
    return { data: srcData, header: srcHeader };
  }

  // Only support converting to RGBA
  if (targetColorType !== 6) {
    throw new Error('Only conversion to RGBA (color type 6) is supported');
  }

  const width = srcHeader.width;
  const height = srcHeader.height;
  const srcBitDepth = srcHeader.bitDepth;
  const srcColorType = srcHeader.colorType;

  // Calculate output size
  const targetBytesPerPixel = targetBitDepth === 16 ? 8 : 4; // RGBA
  const targetRowBytes = width * targetBytesPerPixel;
  const targetData = new Uint8Array(height * targetRowBytes);

  // Process each pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 255; // Default to opaque

      // Read source pixel based on format
      if (srcColorType === 0) {
        // Grayscale
        const srcRowBytes = Math.ceil((width * srcBitDepth) / 8);

        if (srcBitDepth === 16) {
          const offset = y * srcRowBytes + x * 2;
          const gray = (srcData[offset] << 8) | srcData[offset + 1];
          r = g = b = scaleSample(gray, 16, targetBitDepth);
        } else if (srcBitDepth === 8) {
          const offset = y * srcRowBytes + x;
          const gray = srcData[offset];
          r = g = b = scaleSample(gray, 8, targetBitDepth);
        } else {
          // Sub-byte bit depths (1, 2, 4)
          const srcRowBytes = Math.ceil((width * srcBitDepth) / 8);
          const byteOffset = y * srcRowBytes + Math.floor((x * srcBitDepth) / 8);
          const bitOffset = (x * srcBitDepth) % 8;
          const mask = (1 << srcBitDepth) - 1;
          const gray = (srcData[byteOffset] >> (8 - bitOffset - srcBitDepth)) & mask;
          r = g = b = scaleSample(gray, srcBitDepth, targetBitDepth);
        }
        a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
      } else if (srcColorType === 2) {
        // RGB
        const srcBytesPerPixel = (srcBitDepth === 16) ? 6 : 3;
        const srcRowBytes = width * srcBytesPerPixel;
        const offset = y * srcRowBytes + x * srcBytesPerPixel;

        if (srcBitDepth === 16) {
          r = ((srcData[offset] << 8) | srcData[offset + 1]);
          g = ((srcData[offset + 2] << 8) | srcData[offset + 3]);
          b = ((srcData[offset + 4] << 8) | srcData[offset + 5]);
          if (targetBitDepth === 8) {
            r = scaleSample(r, 16, 8);
            g = scaleSample(g, 16, 8);
            b = scaleSample(b, 16, 8);
          }
        } else {
          r = srcData[offset];
          g = srcData[offset + 1];
          b = srcData[offset + 2];
          if (targetBitDepth === 16) {
            r = scaleSample(r, 8, 16);
            g = scaleSample(g, 8, 16);
            b = scaleSample(b, 8, 16);
          }
        }
        a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
      } else if (srcColorType === 4) {
        // Grayscale + Alpha
        const srcBytesPerPixel = (srcBitDepth === 16) ? 4 : 2;
        const srcRowBytes = width * srcBytesPerPixel;
        const offset = y * srcRowBytes + x * srcBytesPerPixel;

        if (srcBitDepth === 16) {
          const gray = (srcData[offset] << 8) | srcData[offset + 1];
          r = g = b = (targetBitDepth === 16) ? gray : scaleSample(gray, 16, 8);
          a = (srcData[offset + 2] << 8) | srcData[offset + 3];
          if (targetBitDepth === 8) {
            a = scaleSample(a, 16, 8);
          }
        } else {
          r = g = b = (targetBitDepth === 16) ? scaleSample(srcData[offset], 8, 16) : srcData[offset];
          a = (targetBitDepth === 16) ? scaleSample(srcData[offset + 1], 8, 16) : srcData[offset + 1];
        }
      } else if (srcColorType === 6) {
        // RGBA
        const srcBytesPerPixel = (srcBitDepth === 16) ? 8 : 4;
        const srcRowBytes = width * srcBytesPerPixel;
        const offset = y * srcRowBytes + x * srcBytesPerPixel;

        if (srcBitDepth === 16) {
          r = (srcData[offset] << 8) | srcData[offset + 1];
          g = (srcData[offset + 2] << 8) | srcData[offset + 3];
          b = (srcData[offset + 4] << 8) | srcData[offset + 5];
          a = (srcData[offset + 6] << 8) | srcData[offset + 7];
          if (targetBitDepth === 8) {
            r = scaleSample(r, 16, 8);
            g = scaleSample(g, 16, 8);
            b = scaleSample(b, 16, 8);
            a = scaleSample(a, 16, 8);
          }
        } else {
          r = srcData[offset];
          g = srcData[offset + 1];
          b = srcData[offset + 2];
          a = srcData[offset + 3];
          if (targetBitDepth === 16) {
            r = scaleSample(r, 8, 16);
            g = scaleSample(g, 8, 16);
            b = scaleSample(b, 8, 16);
            a = scaleSample(a, 8, 16);
          }
        }
      } else {
        throw new Error(`Unsupported source color type: ${srcColorType}`);
      }

      // Write target pixel (RGBA)
      const targetOffset = y * targetRowBytes + x * targetBytesPerPixel;
      if (targetBitDepth === 16) {
        targetData[targetOffset] = (r >> 8) & 0xFF;
        targetData[targetOffset + 1] = r & 0xFF;
        targetData[targetOffset + 2] = (g >> 8) & 0xFF;
        targetData[targetOffset + 3] = g & 0xFF;
        targetData[targetOffset + 4] = (b >> 8) & 0xFF;
        targetData[targetOffset + 5] = b & 0xFF;
        targetData[targetOffset + 6] = (a >> 8) & 0xFF;
        targetData[targetOffset + 7] = a & 0xFF;
      } else {
        targetData[targetOffset] = r;
        targetData[targetOffset + 1] = g;
        targetData[targetOffset + 2] = b;
        targetData[targetOffset + 3] = a;
      }
    }
  }

  // Create new header with target format
  const targetHeader: PngHeader = {
    ...srcHeader,
    bitDepth: targetBitDepth,
    colorType: targetColorType
  };

  return { data: targetData, header: targetHeader };
}

/**
 * Convert a single scanline from one format to another
 * This is optimized for streaming - converts one row at a time
 */
export function convertScanline(
  srcScanline: Uint8Array,
  width: number,
  srcBitDepth: number,
  srcColorType: number,
  targetBitDepth: number,
  targetColorType: number
): Uint8Array {
  // If already in target format, return as-is
  if (srcBitDepth === targetBitDepth && srcColorType === targetColorType) {
    return srcScanline;
  }

  // Only support converting to RGBA
  if (targetColorType !== 6) {
    throw new Error('Only conversion to RGBA (color type 6) is supported');
  }

  const targetBytesPerPixel = targetBitDepth === 16 ? 8 : 4; // RGBA
  const targetScanline = new Uint8Array(width * targetBytesPerPixel);

  // Process each pixel in the scanline
  for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, a = 255; // Default to opaque

    // Read source pixel based on format
    if (srcColorType === 0) {
      // Grayscale
      if (srcBitDepth === 16) {
        const offset = x * 2;
        const gray = (srcScanline[offset] << 8) | srcScanline[offset + 1];
        r = g = b = scaleSample(gray, 16, targetBitDepth);
      } else if (srcBitDepth === 8) {
        const gray = srcScanline[x];
        r = g = b = scaleSample(gray, 8, targetBitDepth);
      } else {
        // Sub-byte bit depths (1, 2, 4)
        const byteOffset = Math.floor((x * srcBitDepth) / 8);
        const bitOffset = (x * srcBitDepth) % 8;
        const mask = (1 << srcBitDepth) - 1;
        const gray = (srcScanline[byteOffset] >> (8 - bitOffset - srcBitDepth)) & mask;
        r = g = b = scaleSample(gray, srcBitDepth, targetBitDepth);
      }
      a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
    } else if (srcColorType === 2) {
      // RGB
      const srcBytesPerPixel = (srcBitDepth === 16) ? 6 : 3;
      const offset = x * srcBytesPerPixel;

      if (srcBitDepth === 16) {
        r = ((srcScanline[offset] << 8) | srcScanline[offset + 1]);
        g = ((srcScanline[offset + 2] << 8) | srcScanline[offset + 3]);
        b = ((srcScanline[offset + 4] << 8) | srcScanline[offset + 5]);
        if (targetBitDepth === 8) {
          r = scaleSample(r, 16, 8);
          g = scaleSample(g, 16, 8);
          b = scaleSample(b, 16, 8);
        }
      } else {
        r = srcScanline[offset];
        g = srcScanline[offset + 1];
        b = srcScanline[offset + 2];
        if (targetBitDepth === 16) {
          r = scaleSample(r, 8, 16);
          g = scaleSample(g, 8, 16);
          b = scaleSample(b, 8, 16);
        }
      }
      a = (targetBitDepth === 16) ? 0xFFFF : 0xFF; // Fully opaque
    } else if (srcColorType === 4) {
      // Grayscale + Alpha
      const srcBytesPerPixel = (srcBitDepth === 16) ? 4 : 2;
      const offset = x * srcBytesPerPixel;

      if (srcBitDepth === 16) {
        const gray = (srcScanline[offset] << 8) | srcScanline[offset + 1];
        r = g = b = (targetBitDepth === 16) ? gray : scaleSample(gray, 16, 8);
        a = (srcScanline[offset + 2] << 8) | srcScanline[offset + 3];
        if (targetBitDepth === 8) {
          a = scaleSample(a, 16, 8);
        }
      } else {
        r = g = b = (targetBitDepth === 16) ? scaleSample(srcScanline[offset], 8, 16) : srcScanline[offset];
        a = (targetBitDepth === 16) ? scaleSample(srcScanline[offset + 1], 8, 16) : srcScanline[offset + 1];
      }
    } else if (srcColorType === 6) {
      // RGBA
      const srcBytesPerPixel = (srcBitDepth === 16) ? 8 : 4;
      const offset = x * srcBytesPerPixel;

      if (srcBitDepth === 16) {
        r = (srcScanline[offset] << 8) | srcScanline[offset + 1];
        g = (srcScanline[offset + 2] << 8) | srcScanline[offset + 3];
        b = (srcScanline[offset + 4] << 8) | srcScanline[offset + 5];
        a = (srcScanline[offset + 6] << 8) | srcScanline[offset + 7];
        if (targetBitDepth === 8) {
          r = scaleSample(r, 16, 8);
          g = scaleSample(g, 16, 8);
          b = scaleSample(b, 16, 8);
          a = scaleSample(a, 16, 8);
        }
      } else {
        r = srcScanline[offset];
        g = srcScanline[offset + 1];
        b = srcScanline[offset + 2];
        a = srcScanline[offset + 3];
        if (targetBitDepth === 16) {
          r = scaleSample(r, 8, 16);
          g = scaleSample(g, 8, 16);
          b = scaleSample(b, 8, 16);
          a = scaleSample(a, 8, 16);
        }
      }
    } else {
      throw new Error(`Unsupported source color type: ${srcColorType}`);
    }

    // Write target pixel (RGBA)
    const targetOffset = x * targetBytesPerPixel;
    if (targetBitDepth === 16) {
      targetScanline[targetOffset] = (r >> 8) & 0xFF;
      targetScanline[targetOffset + 1] = r & 0xFF;
      targetScanline[targetOffset + 2] = (g >> 8) & 0xFF;
      targetScanline[targetOffset + 3] = g & 0xFF;
      targetScanline[targetOffset + 4] = (b >> 8) & 0xFF;
      targetScanline[targetOffset + 5] = b & 0xFF;
      targetScanline[targetOffset + 6] = (a >> 8) & 0xFF;
      targetScanline[targetOffset + 7] = a & 0xFF;
    } else {
      targetScanline[targetOffset] = r;
      targetScanline[targetOffset + 1] = g;
      targetScanline[targetOffset + 2] = b;
      targetScanline[targetOffset + 3] = a;
    }
  }

  return targetScanline;
}
