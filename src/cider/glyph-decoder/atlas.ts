import { CHARSET_PRINTABLE_ASCII } from "./constants";

export type RawGlyphSpec = {
  char: string;
  width: number;
  /** One UTF-16 code unit per 12px anchor column. */
  anchorKey: string;
  /** Base64 encoded Uint8Array, row-major, length = 12 * width. */
  weightsB64: string;
};

export type Glyph = {
  char: string;
  width: number;
  anchorKey: string;
  weights: Uint8Array;
  orderIndex: number;
};

export type GlyphAtlas = {
  glyphs: Glyph[];
  widths: number[];
  byChar: Map<string, Glyph>;
  lookupByWidth: Map<number, Map<string, Glyph[]>>;
};

export type BuildGlyphAtlasOptions = {
  /** Allowed glyph characters, in tie-break order. Defaults to printable ASCII. */
  charset?: string;
};

/** Decode a base64 string into a Uint8Array.
 *
 * The generated atlas stores weighted templates in base64 to keep the generated
 * TypeScript file small. Node uses Buffer; browser-like environments can use
 * atob if the decoder is reused outside the CLI.
 */
export function decodeBase64Bytes(value: string): Uint8Array {
  const bufferCtor = (globalThis as unknown as { Buffer?: { from(input: string, encoding: "base64"): Uint8Array } }).Buffer;
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(value, "base64"));
  }

  const atobFn = (globalThis as unknown as { atob?: (input: string) => string }).atob;
  if (!atobFn) throw new Error("No base64 decoder is available in this environment");
  const binary = atobFn(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** Build runtime lookup maps from generated raw glyph specs.
 *
 * Exact-anchor candidate generation uses width-keyed string lookup:
 *
 *   lookupByWidth.get(width).get(inputAnchorString.substring(x, x + width))
 *
 * Each anchor string contains one 12-bit column mask per UTF-16 code unit.
 */
export function buildGlyphAtlas(
  rawGlyphs: readonly RawGlyphSpec[],
  options: BuildGlyphAtlasOptions = {},
): GlyphAtlas {
  const charset = options.charset ?? CHARSET_PRINTABLE_ASCII;
  const rawByChar = new Map<string, RawGlyphSpec>();
  for (const raw of rawGlyphs) rawByChar.set(raw.char, raw);

  const order = new Map<string, number>();
  const selectedRaw: RawGlyphSpec[] = [];
  for (let i = 0; i < charset.length; i++) {
    const ch = charset[i];
    if (order.has(ch)) continue;

    const raw = rawByChar.get(ch);
    if (!raw) throw new Error(`charset contains unavailable glyph: ${JSON.stringify(ch)}`);

    order.set(ch, selectedRaw.length);
    selectedRaw.push(raw);
  }

  const glyphs: Glyph[] = selectedRaw.map((raw, fallbackIndex) => ({
    char: raw.char,
    width: raw.width,
    anchorKey: raw.anchorKey,
    weights: decodeBase64Bytes(raw.weightsB64),
    orderIndex: order.get(raw.char) ?? fallbackIndex,
  }));

  return buildLookupAtlas(glyphs);
}

export function filterGlyphAtlas(atlas: GlyphAtlas, charset: string): GlyphAtlas {
  const order = new Map<string, number>();
  const selectedGlyphs: Glyph[] = [];

  for (let i = 0; i < charset.length; i++) {
    const ch = charset[i];
    if (order.has(ch)) continue;

    const glyph = atlas.byChar.get(ch);
    if (!glyph) throw new Error(`charset contains unavailable glyph: ${JSON.stringify(ch)}`);

    order.set(ch, selectedGlyphs.length);
    selectedGlyphs.push({
      ...glyph,
      orderIndex: selectedGlyphs.length,
    });
  }

  return buildLookupAtlas(selectedGlyphs);
}

function buildLookupAtlas(glyphs: Glyph[]): GlyphAtlas {
  glyphs.sort((a, b) => a.orderIndex - b.orderIndex);

  const byChar = new Map<string, Glyph>();
  const lookupByWidth = new Map<number, Map<string, Glyph[]>>();

  for (const glyph of glyphs) {
    byChar.set(glyph.char, glyph);

    let table = lookupByWidth.get(glyph.width);
    if (!table) {
      table = new Map<string, Glyph[]>();
      lookupByWidth.set(glyph.width, table);
    }

    const existing = table.get(glyph.anchorKey);
    if (existing) existing.push(glyph);
    else table.set(glyph.anchorKey, [glyph]);
  }

  for (const table of lookupByWidth.values()) {
    for (const list of table.values()) {
      list.sort((a, b) => a.orderIndex - b.orderIndex);
    }
  }

  const widths = [...lookupByWidth.keys()].sort((a, b) => a - b);
  return { glyphs, widths, byChar, lookupByWidth };
}
