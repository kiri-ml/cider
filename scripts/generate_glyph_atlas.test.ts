import { describe, expect, it } from "vitest";
import { GLYPH_HEIGHT } from "../src/cider/glyph-decoder/constants";
import { buildGlyphAtlas } from "../src/cider/glyph-decoder/atlas";
import { RAW_GLYPHS } from "../src/cider/glyph-decoder/generated/glyph_atlas_cleartype_rgb";
import { RAW_GLYPHS as RAW_GLYPHS_BGR } from "../src/cider/glyph-decoder/generated/glyph_atlas_cleartype_bgr";
import { appendRightOverhang, detectOverhang } from "./generate_glyph_atlas";

function zeros(width: number): Uint8Array {
  return new Uint8Array(GLYPH_HEIGHT * width);
}

describe("glyph atlas overhang detection", () => {
  it("reports logical bounds when the surrounding zeros match", () => {
    const result = detectOverhang(zeros(4), zeros(4), 4);
    expect({ left: result.left, right: result.right }).toEqual({ left: 0, right: 0 });
  });

  it("detects weak left and right overhang at their outermost columns", () => {
    const first = zeros(5);
    const last = zeros(5);
    first[1 * 5 + 3] = 5;
    first[2 * 5 + 4] = 2;
    last[3 * 5 + 0] = 3;
    last[4 * 5 + 2] = 1;

    const result = detectOverhang(first, last, 5);
    expect({ left: result.left, right: result.right }).toEqual({ left: 2, right: 3 });
    expect(result.rightWeights[3 * 5]).toBe(3);
  });

  it("subtracts the shared zero pixels before recording right overhang", () => {
    const first = zeros(3);
    const last = zeros(3);
    first[0] = 7;
    last[0] = 12;
    const result = detectOverhang(first, last, 3);
    expect(result.right).toBe(1);
    expect(result.rightWeights[0]).toBe(5);
  });

  it("rejects differences whose inferred sides overlap", () => {
    const first = zeros(4);
    const last = zeros(4);
    first[0] = 1;
    last[3] = 1;
    expect(() => detectOverhang(first, last, 4)).toThrow("ambiguous zero comparison");
  });

  it("appends right overhang after each logical row", () => {
    const logical = new Uint8Array(GLYPH_HEIGHT * 2);
    logical[0] = 7;
    logical[1] = 8;
    const rightWeights = zeros(3);
    rightWeights[0] = 4;
    const out = appendRightOverhang(logical, 2, { left: 0, right: 1, rightWeights }, 3);
    expect([...out.subarray(0, 3)]).toEqual([7, 8, 4]);
  });

  it("rejects left overhang in the simplified representation", () => {
    expect(() => appendRightOverhang(zeros(2), 2, {
      left: 1,
      right: 0,
      rightWeights: zeros(3),
    }, 3)).toThrow("left overhang is unsupported");
  });
});

describe("generated visual templates", () => {
  it("decodes logical and visual templates to their declared dimensions", () => {
    const atlas = buildGlyphAtlas(RAW_GLYPHS);
    for (const glyph of atlas.glyphs) {
      expect(glyph.weights).toHaveLength(GLYPH_HEIGHT * glyph.visualWidth);
      expect(glyph.visualWidth).toBeGreaterThanOrEqual(glyph.width);
    }
  });

  it("rejects malformed template dimensions", () => {
    const raw = { char: "x", width: 2, anchorKey: "\0\0", weightsB64: Buffer.alloc(GLYPH_HEIGHT).toString("base64") };
    expect(() => buildGlyphAtlas([raw], { charset: "x" })).toThrow("less than logical width");

    raw.weightsB64 = Buffer.alloc(GLYPH_HEIGHT + 1).toString("base64");
    expect(() => buildGlyphAtlas([raw], { charset: "x" })).toThrow("invalid weight length");
  });

  it("preserves the currently detected right-overhang templates", () => {
    const glyphs = [...buildGlyphAtlas(RAW_GLYPHS).glyphs, ...buildGlyphAtlas(RAW_GLYPHS_BGR).glyphs];
    expect(glyphs.filter((glyph) => glyph.visualWidth > glyph.width)).toHaveLength(22);
  });
});
