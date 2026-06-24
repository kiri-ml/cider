import { describe, expect, it } from "vitest";
import { ANCHOR_SIZE, EXPECTED_ANCHOR_HEX, FAST_ANCHOR_RECT } from "./constants";
import { detectMapleClientFrame } from "./detector";
import type { Size } from "./types";

const TEST_SIZE: Size = { width: 800, height: 600 };

describe("detectMapleClientFrame", () => {
  it("detects an exact edge-aligned client frame", () => {
    const pixels = imageWithFastAnchor(TEST_SIZE.width, TEST_SIZE.height, 0, 0);

    expect(detectMapleClientFrame(pixels, TEST_SIZE.width, TEST_SIZE.height, { supportedSizes: [TEST_SIZE] })).toMatchObject({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      adjustment: 0,
      clientSize: "800x600",
    });
  });

  it("falls back to offset candidates", () => {
    const rawWidth = TEST_SIZE.width + 12;
    const rawHeight = TEST_SIZE.height + 8;
    const pixels = imageWithFastAnchor(rawWidth, rawHeight, 7, 3);

    expect(detectMapleClientFrame(pixels, rawWidth, rawHeight, { supportedSizes: [TEST_SIZE] })).toMatchObject({
      left: 7,
      top: 5,
      right: 807,
      bottom: 605,
      adjustment: 20,
      clientSize: "800x600",
    });
  });
});

function imageWithFastAnchor(rawWidth: number, rawHeight: number, leftMargin: number, bottomMargin: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(rawWidth * rawHeight * 4);
  const anchor = parseAnchor();
  const frameBottom = rawHeight - bottomMargin;

  for (let y = FAST_ANCHOR_RECT.top; y < FAST_ANCHOR_RECT.top + FAST_ANCHOR_RECT.height; y += 1) {
    for (let x = FAST_ANCHOR_RECT.left; x < FAST_ANCHOR_RECT.left + FAST_ANCHOR_RECT.width; x += 1) {
      const rgb = anchor[y * ANCHOR_SIZE + x];
      const pixelIndex = ((frameBottom - ANCHOR_SIZE + y) * rawWidth + leftMargin + x) * 4;
      pixels[pixelIndex] = rgb[0];
      pixels[pixelIndex + 1] = rgb[1];
      pixels[pixelIndex + 2] = rgb[2];
      pixels[pixelIndex + 3] = 255;
    }
  }

  return pixels;
}

function parseAnchor(): Array<readonly [number, number, number]> {
  return EXPECTED_ANCHOR_HEX
    .trim()
    .split(/\s+/)
    .map((value) => [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ] as const);
}
