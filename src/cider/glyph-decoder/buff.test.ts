import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { BUFF_ITEM_NAMES } from "../buff-items";
import { buildGlyphAtlas } from "./atlas";
import { decodeBuffMsg } from "./buff";
import { CHARSET_ALPHANUMERIC, CHARSET_SPACED_ALPHANUMERIC, CHARSET_TIMESTAMP } from "./constants";
import { compileDecodeToken, decodeLine } from "./decoder";
import { RAW_GLYPHS } from "./generated/glyph_atlas_cleartype_rgb";
import { decodeTimestamp } from "./pattern";
import { buildLineAnchors, type RgbaImage } from "./preprocess";
import { lineFromTintedAtlasText, textWidth } from "./test-utils";

const atlas = buildGlyphAtlas(RAW_GLYPHS, { charset: `${CHARSET_SPACED_ALPHANUMERIC}'` });
const playerNameAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_ALPHANUMERIC });
const timestampAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_TIMESTAMP });

describe("decodeBuffMsg", () => {
  it("decodes a synthetic buff body in two stages", () => {
    const startX = 3;
    const text = "Shedinja420 used Onyx Apple";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeBuffMsg(atlas, playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text),
    });

    expect(result.text).toBe(text);
    expect(result.x).toBe(startX + textWidth(text));
    expect(result.decisions.some((decision) => decision.kind === "token" && decision.selected.token.text === " used ")).toBe(true);
    expect(result.decisions.find((decision) => decision.kind === "token" && decision.selected.token.text === " used "))
      .toMatchObject({
        kind: "token",
        selected: { token: { acceptOnAnchorMatch: undefined } },
      });
    expect(result.decisions.find((decision) => decision.kind === "token" && decision.selected.token.text === "Onyx Apple"))
      .toMatchObject({
        kind: "token",
        selected: { token: { acceptOnAnchorMatch: true } },
      });
  });

  it("uses the terminate token instead of decoding spaces during player extraction", () => {
    const startX = 3;
    const text = "Shedinja used Onyx Apple";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeBuffMsg(atlas, playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text),
    });
    const usedDecision = result.decisions.find((decision) => (
      decision.kind === "token" && decision.selected.token.text === " used "
    ));

    expect(usedDecision).toBeDefined();
    expect(usedDecision?.x).toBe(startX + textWidth("Shedinja"));
  });

  it("does not terminate on used embedded in the player name", () => {
    const startX = 3;
    const text = "hiusedi used Onyx Apple";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeBuffMsg(atlas, playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text),
    });
    const usedDecision = result.decisions.find((decision) => (
      decision.kind === "token" && decision.selected.token.text === " used "
    ));
    const itemDecision = result.decisions.find((decision) => (
      decision.kind === "token" && decision.selected.token.text === "Onyx Apple"
    ));

    expect(result.text).toBe(text);
    expect(result.x).toBe(startX + textWidth(text));
    expect(usedDecision?.x).toBe(startX + textWidth("hiusedi"));
    expect(itemDecision).toMatchObject({
      kind: "token",
      selected: { token: { text: "Onyx Apple" } },
    });
  });

  it("keeps default item token order free of anchor prefix conflicts", () => {
    const tokens = BUFF_ITEM_NAMES.map((item) => compileDecodeToken(atlas, item));

    for (const token of tokens) {
      const longerPrefixMatches = tokens.filter((other) => (
        other !== token &&
        other.anchorKey.length > token.anchorKey.length &&
        other.anchorKey.startsWith(token.anchorKey)
      ));

      expect(longerPrefixMatches.map((match) => match.text), `${token.text} has longer anchor prefix matches`).toEqual([]);
    }
  });

  it("sorts custom item tokens longest to shortest before stage 2 decoding", () => {
    const startX = 3;
    const text = "Alice used Onyx Apple";
    const line = lineFromTintedAtlasText(text, { startX });
    const result = decodeBuffMsg(atlas, playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text),
      itemNames: ["Onyx", "Onyx Apple"],
    });
    const itemDecision = result.decisions.find((decision) => (
      decision.kind === "token" && decision.selected.token.text !== " used "
    ));

    expect(result.text).toBe(text);
    expect(itemDecision).toMatchObject({
      kind: "token",
      selected: { token: { text: "Onyx Apple", acceptOnAnchorMatch: true } },
    });
  });

  it("returns the stage 1 partial result when the used token is absent", () => {
    const startX = 3;
    const text = "Alice Bob";
    const line = lineFromTintedAtlasText(text, { startX });
    const stage1 = decodeLine(playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text),
      tokenList: [compileDecodeToken(atlas, " used ", { terminate: true })],
    });
    const result = decodeBuffMsg(atlas, playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text),
      itemNames: ["Bob"],
    });

    expect(result).toEqual(stage1);
    expect(result.decisions.every((decision) => decision.kind === "glyph")).toBe(true);
  });

  it("keeps apostrophes available for stage 2 item tokens", () => {
    const startX = 3;
    const text = "Alice used Bob's Apple";
    const line = lineFromTintedAtlasText(text, { atlas, startX });
    const result = decodeBuffMsg(atlas, playerNameAtlas, line, {
      startX,
      endX: startX + textWidth(text, atlas),
      itemNames: ["Bob's Apple"],
    });
    const itemDecision = result.decisions.find((decision) => (
      decision.kind === "token" && decision.selected.token.text === "Bob's Apple"
    ));

    expect(result.text).toBe(text);
    expect(itemDecision).toMatchObject({
      kind: "token",
      selected: { token: { text: "Bob's Apple" } },
    });
  });

  it.each([
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
  ])("decodes real light-rendered buff line $file with item tokens", async ({ file, timestamp, body }) => {
    const line = buildLineAnchors(await readPngRgba(`data/tests/light/${file}`));
    const timestampResult = decodeTimestamp(timestampAtlas, line);

    expect(timestampResult).toMatchObject({
      text: timestamp,
    });

    const result = decodeBuffMsg(atlas, playerNameAtlas, line, { startX: timestampResult?.x ?? 0 });
    const expectedItem = body.split(" used ")[1];

    expect(result.text).toBe(body);
    expect(result.decisions.some((decision) => decision.kind === "token" && decision.selected.token.text === expectedItem)).toBe(true);
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
