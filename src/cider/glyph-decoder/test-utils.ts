import { buildGlyphAtlas, type GlyphAtlas } from "./atlas";
import { CYAN_B, CYAN_G, CYAN_R, GLYPH_HEIGHT } from "./constants";
import { RAW_GLYPHS } from "./generated/glyph_atlas_cleartype_rgb";
import { buildLineAnchors, type LineAnchors, type RgbaImage, type SoftEvidenceMode } from "./preprocess";

export const TEST_GLYPH_ATLAS = buildGlyphAtlas(RAW_GLYPHS);

export type TintedAtlasTextOptions = {
  atlas?: GlyphAtlas;
  startX?: number;
  rightPad?: number;
  evidenceMode?: SoftEvidenceMode;
};

export function imageFromTintedAtlasText(
  text: string,
  options: TintedAtlasTextOptions = {},
): RgbaImage {
  const atlas = options.atlas ?? TEST_GLYPH_ATLAS;
  const startX = options.startX ?? 3;
  const rightPad = options.rightPad ?? 3;
  const width = startX + textWidth(text, atlas) + rightPad;
  const data = new Uint8ClampedArray(width * GLYPH_HEIGHT * 4);
  let x = startX;

  for (const ch of text) {
    const glyph = atlas.byChar.get(ch);
    if (!glyph) throw new Error(`missing glyph for ${JSON.stringify(ch)}`);

    for (let dx = 0; dx < glyph.width; dx++) {
      for (let y = 0; y < GLYPH_HEIGHT; y++) {
        const weight = glyph.weights[y * glyph.visualWidth + dx];
        if (weight === 0) continue;

        const i = (y * width + x + dx) * 4;
        data[i] = Math.round((CYAN_R * weight) / 255);
        data[i + 1] = Math.round((CYAN_G * weight) / 255);
        data[i + 2] = Math.round((CYAN_B * weight) / 255);
        data[i + 3] = 255;
      }
    }

    x += glyph.width;
  }

  return { width, height: GLYPH_HEIGHT, data };
}

export function lineFromTintedAtlasText(
  text: string,
  options: TintedAtlasTextOptions = {},
): LineAnchors {
  return buildLineAnchors(imageFromTintedAtlasText(text, options), { evidenceMode: options.evidenceMode });
}

export function textWidth(text: string, atlas: GlyphAtlas = TEST_GLYPH_ATLAS): number {
  let width = 0;
  for (const ch of text) {
    const glyph = atlas.byChar.get(ch);
    if (!glyph) throw new Error(`missing glyph for ${JSON.stringify(ch)}`);
    width += glyph.width;
  }
  return width;
}
