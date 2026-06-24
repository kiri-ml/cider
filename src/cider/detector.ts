import {
  ANCHOR_COLOR_TOLERANCE,
  ANCHOR_SIZE,
  BOTTOM_MARGIN,
  CHAT_CROP_HEIGHT,
  CHAT_WIDTH,
  EXPECTED_ANCHOR_HEX,
  FAST_ANCHOR_RECT,
  LINE_HEIGHT,
  MAX_EXTRA_MARGIN,
  MAX_MISSING_EDGE,
  MIN_FULL_ANCHOR_MATCH_RATIO,
  MIN_FULL_ANCHOR_PIXELS,
  SUPPORTED_CLIENT_SIZES,
} from "./constants";
import type { ClientFrame, IndexedRect, Rect, Size } from "./types";

type Rgb = readonly [number, number, number];
type AnchorPixel = Readonly<{ x: number; y: number; rgb: Rgb }>;

const EXPECTED_ANCHOR_RGB = parseAnchor(EXPECTED_ANCHOR_HEX);
const FAST_ANCHOR_PIXELS = anchorPixelsInRect(FAST_ANCHOR_RECT);

export type AnchorDetectionMode = "fast" | "full";

export interface DetectClientFrameOptions {
  mode?: AnchorDetectionMode;
  supportedSizes?: Size[];
}

export function detectMapleClientFrame(
  imagePixels: Uint8ClampedArray,
  rawWidth: number,
  rawHeight: number,
  options: DetectClientFrameOptions = {},
): ClientFrame | null {
  const mode = options.mode ?? "fast";
  const supportedSizes = options.supportedSizes ?? SUPPORTED_CLIENT_SIZES;
  let bestFrame: ClientFrame | null = null;

  for (const size of supportedSizes) {
    const exactFrame = createClientFrame(size, rawWidth, rawHeight, 0, 0);
    if (exactFrame && anchorCandidateMatches(imagePixels, exactFrame, rawWidth, rawHeight, mode)) {
      return exactFrame;
    }

    for (let leftMargin = -MAX_MISSING_EDGE; leftMargin <= MAX_EXTRA_MARGIN; leftMargin += 1) {
      for (let bottomMargin = -MAX_MISSING_EDGE; bottomMargin <= MAX_EXTRA_MARGIN; bottomMargin += 1) {
        if (leftMargin === 0 && bottomMargin === 0) continue;
        const frame = createClientFrame(size, rawWidth, rawHeight, leftMargin, bottomMargin);
        if (!frame) continue;
        if (!anchorCandidateMatches(imagePixels, frame, rawWidth, rawHeight, mode)) continue;

        if (!bestFrame || compareClientFrames(frame, bestFrame) < 0) {
          bestFrame = frame;
        }
      }
    }
  }

  return bestFrame;
}

export function chatLineRects(clientFrame: ClientFrame, lineCount: number): IndexedRect[] {
  const safeLineCount = Math.max(0, Math.floor(lineCount));
  const chatTop = clientFrame.bottom - BOTTOM_MARGIN - safeLineCount * LINE_HEIGHT;

  return Array.from({ length: safeLineCount }, (_, index) => ({
    index,
    left: clientFrame.left,
    top: chatTop + index * LINE_HEIGHT,
    width: CHAT_WIDTH,
    height: CHAT_CROP_HEIGHT,
  }));
}

function createClientFrame(
  size: Size,
  rawWidth: number,
  rawHeight: number,
  leftMargin: number,
  bottomMargin: number,
): ClientFrame | null {
  const left = leftMargin;
  const bottom = rawHeight - bottomMargin;
  const top = bottom - size.height;
  const right = left + size.width;
  const topMargin = top;
  const rightMargin = rawWidth - right;

  if (!isAllowedEdgeOffset(topMargin) || !isAllowedEdgeOffset(rightMargin)) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: size.width,
    height: size.height,
    adjustment: Math.abs(leftMargin) + Math.abs(bottomMargin) + Math.abs(topMargin) + Math.abs(rightMargin),
    clientSize: `${size.width}x${size.height}`,
  };
}

function isAllowedEdgeOffset(offset: number): boolean {
  return offset >= -MAX_MISSING_EDGE && offset <= MAX_EXTRA_MARGIN;
}

function anchorCandidateMatches(
  imagePixels: Uint8ClampedArray,
  frame: ClientFrame,
  rawWidth: number,
  rawHeight: number,
  mode: AnchorDetectionMode,
): boolean {
  if (mode === "full") {
    const score = scoreFullAnchor(imagePixels, frame, rawWidth, rawHeight);
    if (score.comparablePixels < MIN_FULL_ANCHOR_PIXELS) return false;
    return score.matchRatio >= MIN_FULL_ANCHOR_MATCH_RATIO;
  }

  return fastAnchorMatches(imagePixels, frame, rawWidth, rawHeight);
}

function fastAnchorMatches(
  imagePixels: Uint8ClampedArray,
  frame: ClientFrame,
  rawWidth: number,
  rawHeight: number,
): boolean {
  for (const pixel of FAST_ANCHOR_PIXELS) {
    const rawX = frame.left + pixel.x;
    const rawY = frame.bottom - ANCHOR_SIZE + pixel.y;
    if (!isInBounds(rawX, rawY, rawWidth, rawHeight)) {
      return false;
    }

    if (!rgbExactMatchAt(imagePixels, rawWidth, rawX, rawY, pixel.rgb)) {
      return false;
    }
  }

  return true;
}

function scoreFullAnchor(
  imagePixels: Uint8ClampedArray,
  frame: ClientFrame,
  rawWidth: number,
  rawHeight: number,
): { comparablePixels: number; matchingPixels: number; matchRatio: number } {
  let comparablePixels = 0;
  let matchingPixels = 0;

  for (let y = 0; y < ANCHOR_SIZE; y += 1) {
    for (let x = 0; x < ANCHOR_SIZE; x += 1) {
      const rawX = frame.left + x;
      const rawY = frame.bottom - ANCHOR_SIZE + y;
      if (!isInBounds(rawX, rawY, rawWidth, rawHeight)) continue;

      comparablePixels += 1;
      const expected = EXPECTED_ANCHOR_RGB[y * ANCHOR_SIZE + x];
      if (expected && rgbWithinToleranceAt(imagePixels, rawWidth, rawX, rawY, expected, ANCHOR_COLOR_TOLERANCE)) {
        matchingPixels += 1;
      }
    }
  }

  return {
    comparablePixels,
    matchingPixels,
    matchRatio: comparablePixels === 0 ? 0 : matchingPixels / comparablePixels,
  };
}

function compareClientFrames(leftFrame: ClientFrame, rightFrame: ClientFrame): number {
  return leftFrame.adjustment - rightFrame.adjustment;
}

function parseAnchor(hexGrid: string): Rgb[] {
  return hexGrid
    .trim()
    .split(/\s+/)
    .map((value) => [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ] as const);
}

function anchorPixelsInRect(rect: Rect): AnchorPixel[] {
  const pixels: AnchorPixel[] = [];
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const rgb = EXPECTED_ANCHOR_RGB[y * ANCHOR_SIZE + x];
      if (!rgb) continue;
      pixels.push({ x, y, rgb });
    }
  }
  return pixels;
}

function isInBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function rgbExactMatchAt(imagePixels: Uint8ClampedArray, imageWidth: number, x: number, y: number, expected: Rgb): boolean {
  const dataIndex = pixelDataIndex(imageWidth, x, y);
  return (
    imagePixels[dataIndex] === expected[0] &&
    imagePixels[dataIndex + 1] === expected[1] &&
    imagePixels[dataIndex + 2] === expected[2]
  );
}

function rgbWithinToleranceAt(
  imagePixels: Uint8ClampedArray,
  imageWidth: number,
  x: number,
  y: number,
  expected: Rgb,
  tolerance: number,
): boolean {
  const dataIndex = pixelDataIndex(imageWidth, x, y);
  const red = imagePixels[dataIndex];
  const green = imagePixels[dataIndex + 1];
  const blue = imagePixels[dataIndex + 2];
  if (red === undefined || green === undefined || blue === undefined) return false;

  return (
    Math.abs(red - expected[0]) <= tolerance &&
    Math.abs(green - expected[1]) <= tolerance &&
    Math.abs(blue - expected[2]) <= tolerance
  );
}

function pixelDataIndex(imageWidth: number, x: number, y: number): number {
  return (y * imageWidth + x) * 4;
}
