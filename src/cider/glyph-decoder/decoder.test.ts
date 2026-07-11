import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { blendGlyphWeights, buildGlyphAtlas, type RawGlyphSpec } from "./atlas";
import { CHARSET_SPACED_ALPHANUMERIC, CHARSET_TIMESTAMP, GLYPH_HEIGHT } from "./constants";
import { compileDecodeToken, decodeLine } from "./decoder";
import { RAW_GLYPHS } from "./generated/glyph_atlas_cleartype_rgb";
import { RAW_GLYPHS as RAW_GLYPHS_CLEARTYPE_BGR } from "./generated/glyph_atlas_cleartype_bgr";
import { decodeTimestamp } from "./pattern";
import { buildLineAnchors, type RgbaImage } from "./preprocess";
import { lineFromTintedAtlasText, textWidth } from "./test-utils";

const syntheticCharset = CHARSET_SPACED_ALPHANUMERIC + "[]:";
const atlas = buildGlyphAtlas(RAW_GLYPHS, { charset: syntheticCharset });
const timestampAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_TIMESTAMP });
const messageAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_SPACED_ALPHANUMERIC });
const cleartypeBgrTimestampAtlas = buildGlyphAtlas(RAW_GLYPHS_CLEARTYPE_BGR, { charset: CHARSET_TIMESTAMP });
const cleartypeBgrMessageAtlas = buildGlyphAtlas(RAW_GLYPHS_CLEARTYPE_BGR, { charset: CHARSET_SPACED_ALPHANUMERIC });

describe("decodeLine synthetic slices", () => {
  it("approximates measured overlapping glyph intensities", () => {
    const blendByte = (a: number, b: number) => Math.round(blendGlyphWeights(a / 255, b / 255) * 255);
    expect(blendByte(0x1b, 0)).toBe(0x1b);
    expect(blendByte(0x1b, 0x1b)).toBe(0x29);
    expect(blendByte(0x1b, 0x67)).toBe(0x75);
  });

  it("uses right-overhang evidence to resolve an otherwise identical beam", () => {
    const raw: RawGlyphSpec[] = [
      rawGlyph("B", 1, [255]),
      rawGlyph("A", 2, [255, 128]),
      rawGlyph("C", 1, [0, 255]),
    ];
    const renderAtlas = buildGlyphAtlas(raw, { charset: "ABC" });
    const decodeAtlas = buildGlyphAtlas(raw, { charset: "BAC" });
    const startX = 2;
    const line = lineFromTintedAtlasText("AC", { atlas: renderAtlas, startX });
    const result = decodeLine(decodeAtlas, line, { startX, endX: startX + 2 });
    const disabled = decodeLine(decodeAtlas, line, { startX, endX: startX + 2, useOverhangEvidence: false });

    expect(result.text).toBe("AC");
    expect(disabled.text).toBe("BC");
    expect(result.score).toBeGreaterThan(disabled.score);
  });

  it.each([
    { rendered: "A", expected: "A" },
    { rendered: "B", expected: "B" },
  ])("uses final overhang evidence to decode $rendered", ({ rendered, expected }) => {
    const raw: RawGlyphSpec[] = [
      rawGlyph("B", 1, [255]),
      rawGlyph("A", 2, [255, 128]),
    ];
    const renderAtlas = buildGlyphAtlas(raw, { charset: "AB" });
    const decodeAtlas = buildGlyphAtlas(raw, { charset: "BA" });
    const startX = 2;
    const line = lineFromTintedAtlasText(rendered, { atlas: renderAtlas, startX });
    const result = decodeLine(decodeAtlas, line, { startX, endX: startX + 1 });
    expect(result.text).toBe(expected);
  });

  it.each([
    "Shedinja420 used Onyx Apple",
    "qwertylL used Ssiws Cheese",
    "Peke used Gelt Chocolate",
    "[14:13:21]",
  ])("decodes cyan-tinted grayscale atlas text %j", (text) => {
    const startX = 3;
    const textWidthPx = textWidth(text);
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidthPx,
    });

    expect(result.text).toBe(text);
    expect(result.x).toBe(startX + textWidthPx);
  });

  it("accepts compiled tokens before single glyph candidates", () => {
    const startX = 3;
    const text = "Shedinja420 used Onyx Apple";
    const textWidthPx = textWidth(text);
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidthPx,
      tokenList: [
        compileDecodeToken(atlas, " used "),
        compileDecodeToken(atlas, "Onyx Apple"),
      ],
    });

    expect(result.text).toBe(text);
    expect(result.x).toBe(startX + textWidthPx);
    expect(result.decisions.some((decision) => decision.kind === "token")).toBe(true);
  });

  it("uses the first matching token by priority", () => {
    const startX = 3;
    const text = "Onyx";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      tokenList: [
        compileDecodeToken(atlas, "On", { text: "A" }),
        compileDecodeToken(atlas, "Onyx", { text: "B" }),
      ],
    });

    expect(result.text).toBe("Ayx");
    expect(result.decisions[0]).toMatchObject({
      kind: "token",
      selected: { priorityIndex: 0 },
    });
  });

  it("skips single glyph decoding when a token matches", () => {
    const startX = 3;
    const text = "Shed";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      tokenList: [compileDecodeToken(atlas, "S", { text: "Token" })],
    });

    expect(result.text).toBe("Tokenhed");
    expect(result.decisions[0]).toMatchObject({ kind: "token" });
  });

  it("accepts flagged tokens even when glyph-only decoding fits better", () => {
    const startX = 3;
    const text = "h";
    const line = lineFromTintedAtlasText(text, { startX });
    const fitChecked = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      tokenList: [compileDecodeToken(atlas, "n", { text: "Token" })],
    });
    const acceptOnAnchorMatch = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      tokenList: [compileDecodeToken(atlas, "n", { text: "Token", acceptOnAnchorMatch: true })],
    });

    expect(fitChecked.text).toBe("h");
    expect(fitChecked.decisions[0]).toMatchObject({ kind: "glyph" });
    expect(acceptOnAnchorMatch.text).toBe("Token");
    expect(acceptOnAnchorMatch.decisions[0]).toMatchObject({
      kind: "token",
      selected: { token: { acceptOnAnchorMatch: true } },
    });
  });

  it("returns immediately after accepting a terminate token", () => {
    const startX = 3;
    const prefix = "Alice";
    const tokenText = " used ";
    const text = `${prefix}${tokenText}Onyx Apple`;
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      tokenList: [compileDecodeToken(atlas, tokenText, { terminate: true })],
    });

    expect(result.text).toBe(`${prefix}${tokenText}`);
    expect(result.x).toBe(startX + textWidth(`${prefix}${tokenText}`));
    expect(result.decisions.at(-1)).toMatchObject({ kind: "token" });
  });

  it("filters denylisted glyphs before ranking exact-anchor candidates", () => {
    const startX = 3;
    const text = "h";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      denylist: "h",
    });

    expect(result.text).toBe("n");
    expect(result.x).toBe(startX + textWidth(text));
    expect(result.decisions[0]).toMatchObject({
      kind: "glyph",
      candidateCount: 1,
      selected: { glyph: { char: "n" } },
      topCandidates: [{ glyph: { char: "n" } }],
    });
  });

  it("does not continue a beam path when the only matching glyph is denylisted", () => {
    const startX = 3;
    const text = "S";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      denylist: text,
    });

    expect(result).toMatchObject({
      text: "",
      x: startX,
      score: 0,
      decisions: [],
    });
  });

  it("allows tokens even when token text contains a denylisted character", () => {
    const startX = 3;
    const text = "S";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeLine(atlas, line, {
      startX,
      endX: startX + textWidth(text),
      denylist: "S",
      tokenList: [compileDecodeToken(atlas, "S", { text: "S" })],
    });

    expect(result.text).toBe("S");
    expect(result.decisions[0]).toMatchObject({ kind: "token" });
  });
});

function rawGlyph(char: string, templateWidth: number, initialWeights: number[]): RawGlyphSpec {
  const weights = new Uint8Array(GLYPH_HEIGHT * templateWidth);
  weights.set(initialWeights);
  return {
    char,
    width: 1,
    anchorKey: String.fromCharCode(initialWeights[0] === 0 ? 2 : 1),
    weightsB64: btoa(String.fromCharCode(...weights)),
  };
}

describe("decodeLine ClearType BGR slices", () => {
  it("decodes a real BGR-rendered line when the BGR atlas is provided explicitly", async () => {
    const image = await readPngRgba("data/tests/cleartype-bgr/line-07.png");
    const line = buildLineAnchors(image);
    const timestamp = decodeTimestamp(cleartypeBgrTimestampAtlas, line);

    expect(timestamp).toMatchObject({
      text: "[01:06:16]",
    });

    const result = decodeLine(cleartypeBgrMessageAtlas, line, { startX: timestamp?.x ?? 0 });

    expect(result.text).toBe("FF12 used Onyx Apple");
  });
});

describe("decodeLine light slices", () => {
  it.each([
    {
      file: "light-1.png",
      timestamp: "[15:01:19]",
      body: "Beizhuanz used Onyx Apple",
    },
    {
      file: "light-2.png",
      timestamp: "[14:45:42]",
      body: "Socoli used Onyx Apple",
    },
    {
      file: "light-3.png",
      timestamp: "[14:28:04]",
      body: "PalyChi used Onyx Apple",
    },
    {
      file: "light-4.png",
      timestamp: "[14:04:41]",
      body: "Hali used Onyx Apple",
    },
    {
      file: "light-5.png",
      timestamp: "[14:37:47]",
      body: "Viona used Gelt Chocolate",
    },
    {
      file: "light-6.png",
      timestamp: "[14:46:43]",
      body: "qwertylL used Ssiws Cheese",
    },
    {
      file: "light-7.png",
      timestamp: "[14:04:45]",
      body: "Peke used Onyx Apple",
    },
    {
      file: "light-8.png",
      timestamp: "[14:04:41]",
      body: "Riro used Onyx Apple",
    },
    {
      file: "light-9.png",
      timestamp: "[14:35:22]",
      body: "Socoli used Onyx Apple",
    },
    {
      file: "light-10.png",
      timestamp: "[14:42:42]",
      body: "Riro used Onyx Apple",
    },
    {
      file: "light-11.png",
      timestamp: "[16:08:02]",
      body: "FF10 used Onyx Apple",
    },
    {
      file: "light-12.png",
      timestamp: "[16:06:17]",
      body: "Sexiest used Onyx Apple",
    },
    {
      file: "light-13.png",
      timestamp: "[16:20:33]",
      body: "Vooyager used Onyx Apple",
    },
    {
      file: "light-14.png",
      timestamp: "[00:44:12]",
      body: "Single used Onyx Apple",
    },
    {
      file: "light-15.png",
      timestamp: "[01:00:52]",
      body: "Narelion used Ssiws Cheese",
    },
    {
      file: "light-16.png",
      timestamp: "[01:09:44]",
      body: "Narelion used Ssiws Cheese",
    },
    {
      file: "light-17.png",
      timestamp: "[00:16:23]",
      body: "Goth used Onyx Apple",
    },
    {
      file: "light-18.png",
      timestamp: "[00:36:24]",
      body: "Goth used Onyx Apple",
    },
  ])("decodes real light-rendered line $file", async ({ file, timestamp, body }) => {
    const image = await readPngRgba(`data/tests/light/${file}`);
    const line = buildLineAnchors(image);
    const timestampResult = decodeTimestamp(timestampAtlas, line);

    expect(timestampResult).toMatchObject({
      text: timestamp,
    });

    const result = decodeLine(messageAtlas, line, { startX: timestampResult?.x ?? 0 });

    expect(result.text).toBe(body);
  });
});

async function readPngRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data,
  };
}
