import { describe, expect, it } from "vitest";
import { buildGlyphAtlas, type GlyphAtlas } from "./atlas";
import { CHARSET_TIMESTAMP } from "./constants";
import { RAW_GLYPHS } from "./generated/glyph_atlas_cleartype_rgb";
import { decodeKnownPattern, decodeTimestamp } from "./pattern";
import { lineFromTintedAtlasText, textWidth } from "./test-utils";

const atlas = buildGlyphAtlas(RAW_GLYPHS);
const timestampAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_TIMESTAMP });

describe("decodeTimestamp synthetic slices", () => {
  it("decodes the default timestamp pattern from cyan-tinted atlas text", () => {
    const text = "[14:13:21]";
    const result = decodeTimestamp(timestampAtlas, lineFromText(timestampAtlas, text));

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      text,
      x: 3 + textWidth(text, timestampAtlas),
    });
    expect(result?.decisions).toHaveLength(text.length);
  });

  it("returns null when a literal token does not match", () => {
    const result = decodeTimestamp(timestampAtlas, lineFromText(timestampAtlas, "]14:13:21]"));

    expect(result).toBeNull();
  });
});

describe("decodeKnownPattern synthetic slices", () => {
  it("decodes custom placeholder slots from cyan-tinted atlas text", () => {
    const text = "AZ:09";
    const result = decodeKnownPattern(atlas, lineFromText(atlas, text), {
      format: "XX:XX",
      charset: "AZ09",
      placeholder: "X",
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      text,
      x: 3 + textWidth(text),
    });
    expect(result?.decisions).toHaveLength(text.length);
  });
});

function lineFromText(atlas: GlyphAtlas, text: string) {
  return lineFromTintedAtlasText(text, { atlas });
}
