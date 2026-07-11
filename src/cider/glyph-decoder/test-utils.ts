import { blendGlyphWeights, buildGlyphAtlas, type GlyphAtlas } from "./atlas";
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
  const weights = new Float32Array(width * GLYPH_HEIGHT);
  let x = startX;

  for (const ch of text) {
    const glyph = atlas.byChar.get(ch);
    if (!glyph) throw new Error(`missing glyph for ${JSON.stringify(ch)}`);

    for (let dx = 0; dx < glyph.visualWidth; dx++) {
      for (let y = 0; y < GLYPH_HEIGHT; y++) {
        const weight = glyph.weights[y * glyph.visualWidth + dx];
        if (weight === 0) continue;
        const i = y * width + x + dx;
        if (x + dx < width) weights[i] = blendGlyphWeights(weights[i], weight / 255);
      }
    }

    x += glyph.width;
  }

  for (let i = 0; i < weights.length; i++) {
    const weight = weights[i];
    if (weight === 0) continue;
    const rgba = i * 4;
    data[rgba] = Math.round(CYAN_R * weight);
    data[rgba + 1] = Math.round(CYAN_G * weight);
    data[rgba + 2] = Math.round(CYAN_B * weight);
    data[rgba + 3] = 255;
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
