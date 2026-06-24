#!/usr/bin/env tsx
/** Build-time glyph atlas generator.
 *
 * Reads the glyph PNG fixtures from data/glyphs, infers glyph widths, packs exact
 * anchor columns as UTF-16 strings, packs weighted templates as base64, and
 * writes generated glyph atlas modules.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { GLYPH_HEIGHT, GLYPH_ORIGIN_X } from "../src/cider/glyph-decoder/constants.ts";
import type { RawGlyphSpec } from "../src/cider/glyph-decoder/atlas.ts";

const ANCHOR_R = 255;
const ANCHOR_G = 255;
const ANCHOR_B = 255;
const ASCII_FIRST = 32;
const ASCII_LAST = 126;
const ZERO_ASCII = 48;

type Args = {
  targets: Target[];
};

type Target = {
  glyphDir: string;
  output: string;
  originX: number;
};

type GlyphSetKind = "all" | "cleartype-rgb" | "cleartype-bgr";

type AnchorSet = Set<number>;

type PngImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LEVEL_TO_WEIGHT_U8 = new Map<number, number>([
  [0, 0],
  [27, 5],
  [74, 36],
  [118, 66],
  [159, 92],
  [206, 107],
  [255, 255],
]);

function cleartypeRgbTarget(): Target {
  return {
    glyphDir: path.join(rootDir, "data/glyphs/cleartype-rgb/slices"),
    output: path.join(rootDir, "src/cider/glyph-decoder/generated/glyph_atlas_cleartype_rgb.ts"),
    originX: GLYPH_ORIGIN_X,
  };
}

function cleartypeBgrTarget(): Target {
  return {
    glyphDir: path.join(rootDir, "data/glyphs/cleartype-bgr/slices"),
    output: path.join(rootDir, "src/cider/glyph-decoder/generated/glyph_atlas_cleartype_bgr.ts"),
    originX: GLYPH_ORIGIN_X,
  };
}

function parseGlyphSetKind(value: string): GlyphSetKind {
  if (value === "all") return "all";
  if (value === "rgb" || value === "cleartype-rgb") return "cleartype-rgb";
  if (value === "bgr" || value === "cleartype-bgr") return "cleartype-bgr";
  throw new Error(`unknown glyph set: ${value}`);
}

function parseArgs(argv: string[]): Args {
  let kind: GlyphSetKind = "all";
  let glyphDir: string | undefined;
  let output: string | undefined;
  let originX = GLYPH_ORIGIN_X;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--glyph-dir") glyphDir = path.resolve(argv[++i]);
    else if (arg === "--output") output = path.resolve(argv[++i]);
    else if (arg === "--origin-x") originX = Number(argv[++i]);
    else if (arg === "--set") kind = parseGlyphSetKind(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (kind === "all") {
    if (glyphDir || output) throw new Error("--glyph-dir and --output require --set rgb or --set bgr");
    return {
      targets: [
        { ...cleartypeRgbTarget(), originX },
        { ...cleartypeBgrTarget(), originX },
      ],
    };
  }

  const target = kind === "cleartype-rgb" ? cleartypeRgbTarget() : cleartypeBgrTarget();
  if (glyphDir) target.glyphDir = glyphDir;
  if (output) target.output = output;
  target.originX = originX;
  return { targets: [target] };
}

async function readGlyphPng(glyphDir: string, name: string): Promise<PngImage> {
  const pngPath = path.join(glyphDir, name);
  const buffer = fs.readFileSync(pngPath);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data,
  };
}

function pixelOffset(png: PngImage, x: number, y: number): number {
  return (y * png.width + x) * 4;
}

function isAnchorPixel(png: PngImage, x: number, y: number): boolean {
  const i = pixelOffset(png, x, y);
  return png.data[i] === ANCHOR_R && png.data[i + 1] === ANCHOR_G && png.data[i + 2] === ANCHOR_B;
}

function anchorSetFromPng(png: PngImage, originX: number): AnchorSet {
  const out: AnchorSet = new Set();
  const h = Math.min(GLYPH_HEIGHT, png.height);
  for (let y = 0; y < h; y++) {
    for (let x = originX; x < png.width; x++) {
      if (isAnchorPixel(png, x, y)) out.add((x - originX) * GLYPH_HEIGHT + y);
    }
  }
  return out;
}

/** Return a anchor key for a block inside a anchor set.
 *
 * Each output UTF-16 code unit is one 12-bit column mask. This is the same key
 * format used by the runtime substring matcher.
 */
function blockAnchorKey(mask: AnchorSet, x0: number, width: number): string {
  const cols = new Array<number>(width).fill(0);
  for (let col = 0; col < width; col++) {
    let bits = 0;
    const absoluteCol = x0 + col;
    for (let y = 0; y < GLYPH_HEIGHT; y++) {
      if (mask.has(absoluteCol * GLYPH_HEIGHT + y)) bits |= 1 << y;
    }
    cols[col] = bits;
  }
  return String.fromCharCode(...cols);
}

function findZeroOffsets(mask: AnchorSet, zeroKey: string, maxX: number): number[] {
  const out: number[] = [];
  const width = zeroKey.length;
  for (let x0 = 0; x0 <= maxX - width; x0++) {
    if (blockAnchorKey(mask, x0, width) === zeroKey) out.push(x0);
  }
  return out;
}

function anchorColumnsFromPng(png: PngImage, originX: number): number[] {
  const width = png.width - originX;
  const cols = new Array<number>(width).fill(0);
  const h = Math.min(GLYPH_HEIGHT, png.height);
  for (let col = 0; col < width; col++) {
    const x = originX + col;
    let bits = 0;
    for (let y = 0; y < h; y++) {
      if (isAnchorPixel(png, x, y)) bits |= 1 << y;
    }
    cols[col] = bits;
  }
  return cols;
}

function inferTripleZeroKey(png: PngImage, originX: number): string {
  const cols = anchorColumnsFromPng(png, originX);
  const lastInk = cols.findLastIndex((bits) => bits !== 0);
  if (lastInk < 0) throw new Error("could not infer zero anchor from empty 000 sample");

  for (let advance = 1; advance <= Math.floor(cols.length / 3); advance++) {
    const zeroCols = cols.slice(0, advance);
    if (!zeroCols.some((bits) => bits !== 0)) continue;
    const second = cols.slice(advance, advance * 2);
    const third = cols.slice(advance * 2, advance * 3);
    if (zeroCols.length !== second.length || zeroCols.length !== third.length) continue;
    if (zeroCols.some((bits, index) => bits !== second[index] || bits !== third[index])) continue;
    if (lastInk >= advance * 3) continue;
    return String.fromCharCode(...zeroCols);
  }

  throw new Error("could not infer repeated zero advance from 000 sample");
}

function grayscaleAt(png: PngImage, x: number, y: number): number {
  const i = pixelOffset(png, x, y);
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  if (r === g && g === b) return r;
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function weightFromGray(gray: number): number {
  const exact = LEVEL_TO_WEIGHT_U8.get(gray);
  if (exact !== undefined) return exact;
  const normalized = gray / 255;
  return Math.max(0, Math.min(255, Math.round(normalized * normalized * 255)));
}

function cropAnchorKey(png: PngImage, originX: number, width: number): string {
  const cols = new Array<number>(width).fill(0);
  for (let col = 0; col < width; col++) {
    let bits = 0;
    const x = originX + col;
    for (let y = 0; y < GLYPH_HEIGHT; y++) {
      if (x < png.width && y < png.height && isAnchorPixel(png, x, y)) bits |= 1 << y;
    }
    cols[col] = bits;
  }
  return String.fromCharCode(...cols);
}

function cropWeightsB64(png: PngImage, originX: number, width: number): string {
  const weights = new Uint8Array(GLYPH_HEIGHT * width);
  for (let y = 0; y < GLYPH_HEIGHT; y++) {
    for (let col = 0; col < width; col++) {
      const x = originX + col;
      const gray = x < png.width && y < png.height ? grayscaleAt(png, x, y) : 0;
      weights[y * width + col] = weightFromGray(gray);
    }
  }
  return Buffer.from(weights).toString("base64");
}

async function buildRawGlyphs(glyphDir: string, originX: number): Promise<RawGlyphSpec[]> {
  const zeroPng = await readGlyphPng(glyphDir, `glyph_${ZERO_ASCII}.png`);
  const zeroKey = inferTripleZeroKey(zeroPng, originX);
  const zeroWidth = zeroKey.length;

  const raw: RawGlyphSpec[] = [];
  for (let code = ASCII_FIRST; code <= ASCII_LAST; code++) {
    const char = String.fromCharCode(code);
    const name = `glyph_${code}.png`;
    const png = await readGlyphPng(glyphDir, name);
    const mask = anchorSetFromPng(png, originX);
    const offsets = findZeroOffsets(mask, zeroKey, png.width - originX);
    const trailingOffsets = offsets.filter((offset) => offset > zeroWidth);

    if (trailingOffsets.length !== 1) {
      throw new Error(`could not infer glyph width for ${JSON.stringify(char)} from ${name}: offsets=${JSON.stringify(offsets)}`);
    }

    const width = trailingOffsets[0] - zeroWidth;
    const cropOriginX = originX + zeroWidth;
    raw.push({
      char,
      width,
      anchorKey: cropAnchorKey(png, cropOriginX, width),
      weightsB64: cropWeightsB64(png, cropOriginX, width),
    });
  }

  return raw;
}

function renderGeneratedModule(raw: RawGlyphSpec[], sourceDir: string): string {
  const sourceLabel = path.relative(rootDir, sourceDir);
  const lines: string[] = [
    "/* eslint-disable */",
    "// This file is generated by scripts/generate_glyph_atlas.ts.",
    `// Source: ${sourceLabel}`,
    "",
    'import type { RawGlyphSpec } from "../atlas";',
    "",
    "export const RAW_GLYPHS: RawGlyphSpec[] = [",
  ];

  for (const glyph of raw) {
    lines.push("  {");
    lines.push(`    char: ${JSON.stringify(glyph.char)},`);
    lines.push(`    width: ${glyph.width},`);
    lines.push(`    anchorKey: ${JSON.stringify(glyph.anchorKey)},`);
    lines.push(`    weightsB64: ${JSON.stringify(glyph.weightsB64)},`);
    lines.push("  },");
  }

  lines.push("];", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const target of args.targets) {
    const raw = await buildRawGlyphs(target.glyphDir, target.originX);
    fs.mkdirSync(path.dirname(target.output), { recursive: true });
    fs.writeFileSync(target.output, renderGeneratedModule(raw, target.glyphDir), "utf8");
    console.log(`wrote ${target.output} (${raw.length} glyphs)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
