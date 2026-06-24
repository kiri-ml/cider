#!/usr/bin/env tsx
import { buildGlyphAtlas } from "../src/cider/glyph-decoder/atlas.ts";
import {
  CHARSET_ALPHANUMERIC,
  CHARSET_PRINTABLE_ASCII,
  CHARSET_SPACED_ALPHANUMERIC,
  CHARSET_TIMESTAMP,
} from "../src/cider/glyph-decoder/constants.ts";
import { decodeLine } from "../src/cider/glyph-decoder/decoder.ts";
import { RAW_GLYPHS } from "../src/cider/glyph-decoder/generated/glyph_atlas_cleartype_rgb.ts";
import type { SoftEvidenceMode } from "../src/cider/glyph-decoder/preprocess.ts";
import { lineFromTintedAtlasText, textWidth } from "../src/cider/glyph-decoder/test-utils.ts";

type FuzzOptions = {
  iterations: number;
  seed: number;
  minLength: number;
  maxLength: number;
  mode: FuzzMode;
  charset: FuzzCharset;
  beamSize: number;
  branchLimit: number;
  confidenceFloor: number;
  evidenceMode: SoftEvidenceMode;
};

type FuzzMode = "full" | "text" | "timestamp" | "apple";
type FuzzCharset = "full" | "text" | "timestamp";

const DEFAULT_ITERATIONS = 1000;
const DEFAULT_MIN_LENGTH = 1;
const DEFAULT_MAX_LENGTH = 80;
const DEFAULT_BEAM_SIZE = 12;
const DEFAULT_BRANCH_LIMIT = 8;
const DEFAULT_CONFIDENCE_FLOOR = 0.25;
const DEFAULT_EVIDENCE_MODE: SoftEvidenceMode = "bg-alpha-fast";
const START_X = 3;
const PROGRESS_LINE_WIDTH = 80;
const APPLE_ITEMS = [
  "Onyx Apple",
  "Unripe Onyx Apple",
  "Gelt Chocolate",
  "Ssiws Cheese",
  "Heartstopper",
  "Banana Graham Pie",
] as const;

function parseNumber(value: string | undefined, label: string): number {
  if (value === undefined) throw new Error(`missing value for ${label}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`invalid number for ${label}: ${value}`);
  return n;
}

function parseInteger(value: string | undefined, label: string): number {
  const n = parseNumber(value, label);
  if (!Number.isInteger(n)) throw new Error(`expected integer for ${label}: ${value}`);
  return n;
}

function parseMode(value: string | undefined): FuzzMode {
  if (value === "full" || value === "text" || value === "timestamp" || value === "apple") return value;
  throw new Error(`invalid mode: ${value ?? ""}`);
}

function parseCharset(value: string | undefined): FuzzCharset {
  if (value === "full" || value === "text" || value === "timestamp") return value;
  throw new Error(`invalid charset: ${value ?? ""}`);
}

function parseEvidenceMode(value: string | undefined): SoftEvidenceMode {
  if (value === "hsv" || value === "bg-alpha-fast" || value === "bg-alpha-accurate") return value;
  throw new Error(`invalid evidence mode: ${value ?? ""}`);
}

function charsetForDecode(preset: FuzzCharset): string {
  if (preset === "text") return CHARSET_SPACED_ALPHANUMERIC;
  if (preset === "timestamp") return CHARSET_TIMESTAMP;
  return CHARSET_PRINTABLE_ASCII;
}

function parseArgs(args: string[]): FuzzOptions {
  const opts: FuzzOptions = {
    iterations: DEFAULT_ITERATIONS,
    seed: Date.now() >>> 0,
    minLength: DEFAULT_MIN_LENGTH,
    maxLength: DEFAULT_MAX_LENGTH,
    mode: "full",
    charset: "full",
    beamSize: DEFAULT_BEAM_SIZE,
    branchLimit: DEFAULT_BRANCH_LIMIT,
    confidenceFloor: DEFAULT_CONFIDENCE_FLOOR,
    evidenceMode: DEFAULT_EVIDENCE_MODE,
  };

  let positionalIterationsSeen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith("-")) {
      if (positionalIterationsSeen) throw new Error(`unexpected positional argument: ${arg}`);
      opts.iterations = parseInteger(arg, "iterations");
      positionalIterationsSeen = true;
      continue;
    }

    if (arg === "--iterations") opts.iterations = parseInteger(args[++i], "--iterations");
    else if (arg.startsWith("--iterations=")) opts.iterations = parseInteger(arg.slice("--iterations=".length), "--iterations");
    else if (arg === "--mode") opts.mode = parseMode(args[++i]);
    else if (arg.startsWith("--mode=")) opts.mode = parseMode(arg.slice("--mode=".length));
    else if (arg === "--charset") opts.charset = parseCharset(args[++i]);
    else if (arg.startsWith("--charset=")) opts.charset = parseCharset(arg.slice("--charset=".length));
    else if (arg === "--seed") opts.seed = parseInteger(args[++i], "--seed");
    else if (arg.startsWith("--seed=")) opts.seed = parseInteger(arg.slice("--seed=".length), "--seed");
    else if (arg === "--min-length") opts.minLength = parseInteger(args[++i], "--min-length");
    else if (arg.startsWith("--min-length=")) opts.minLength = parseInteger(arg.slice("--min-length=".length), "--min-length");
    else if (arg === "--max-length") opts.maxLength = parseInteger(args[++i], "--max-length");
    else if (arg.startsWith("--max-length=")) opts.maxLength = parseInteger(arg.slice("--max-length=".length), "--max-length");
    else if (arg === "--beam-size") opts.beamSize = parseInteger(args[++i], "--beam-size");
    else if (arg.startsWith("--beam-size=")) opts.beamSize = parseInteger(arg.slice("--beam-size=".length), "--beam-size");
    else if (arg === "--branch-limit") opts.branchLimit = parseInteger(args[++i], "--branch-limit");
    else if (arg.startsWith("--branch-limit=")) opts.branchLimit = parseInteger(arg.slice("--branch-limit=".length), "--branch-limit");
    else if (arg === "--confidence-floor") opts.confidenceFloor = parseNumber(args[++i], "--confidence-floor");
    else if (arg.startsWith("--confidence-floor=")) {
      opts.confidenceFloor = parseNumber(arg.slice("--confidence-floor=".length), "--confidence-floor");
    } else if (arg === "--evidence") {
      opts.evidenceMode = parseEvidenceMode(args[++i]);
    } else if (arg.startsWith("--evidence=")) {
      opts.evidenceMode = parseEvidenceMode(arg.slice("--evidence=".length));
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (opts.iterations < 0) throw new Error("--iterations must be >= 0");
  if (opts.minLength < 0) throw new Error("--min-length must be >= 0");
  if (opts.maxLength < opts.minLength) throw new Error("--max-length must be >= --min-length");
  if (opts.beamSize <= 0) throw new Error("--beam-size must be > 0");
  if (opts.branchLimit <= 0) throw new Error("--branch-limit must be > 0");
  if (opts.confidenceFloor < 0 || opts.confidenceFloor > 1) throw new Error("--confidence-floor must be between 0 and 1");

  opts.seed >>>= 0;
  return opts;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function randomText(random: () => number, minLength: number, maxLength: number): string {
  return randomString(random, CHARSET_PRINTABLE_ASCII, minLength, maxLength);
}

function randomString(random: () => number, charset: string, minLength: number, maxLength: number): string {
  const length = randomInt(random, minLength, maxLength);
  let text = "";
  for (let i = 0; i < length; i++) {
    text += charset[randomInt(random, 0, charset.length - 1)];
  }
  return text;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function randomTimestamp(random: () => number): string {
  return `[${pad2(randomInt(random, 0, 23))}:${pad2(randomInt(random, 0, 59))}:${pad2(randomInt(random, 0, 59))}]`;
}

function randomAppleText(random: () => number): string {
  const name = randomString(random, CHARSET_ALPHANUMERIC, 1, 16);
  const item = APPLE_ITEMS[randomInt(random, 0, APPLE_ITEMS.length - 1)];
  return `${randomTimestamp(random)}${name} used ${item}.`;
}

function randomFuzzText(random: () => number, opts: FuzzOptions): string {
  if (opts.mode === "text") return randomString(random, CHARSET_SPACED_ALPHANUMERIC, opts.minLength, opts.maxLength);
  if (opts.mode === "timestamp") return randomTimestamp(random);
  if (opts.mode === "apple") return randomAppleText(random);
  return randomText(random, opts.minLength, opts.maxLength);
}

function equivalentDecodedText(actual: string, expected: string): boolean {
  return normalizeEquivalentGlyphs(actual) === normalizeEquivalentGlyphs(expected);
}

function normalizeEquivalentGlyphs(value: string): string {
  return value
    .replaceAll("''", "\"")
    .replaceAll("l", "I");
}

function formatMismatch(expected: string, actual: string): string {
  return `expected: ${JSON.stringify(expected)}\n     got: ${JSON.stringify(actual)}\n`;
}

function renderProgress(done: number, total: number, mismatches: number): void {
  const barWidth = 20;
  const ratio = total === 0 ? 1 : done / total;
  const filled = Math.max(0, Math.min(barWidth, Math.floor(ratio * barWidth)));
  const bar = "#".repeat(filled) + "-".repeat(barWidth - filled);
  process.stderr.write(`\rglyph fuzz [${bar}] ${done}/${total} mismatches=${mismatches}`);
}

function clearProgress(): void {
  process.stderr.write(`\r${" ".repeat(PROGRESS_LINE_WIDTH)}\r\n`);
}

function finishProgress(): void {
  process.stderr.write("\n");
}

function progressInterval(iterations: number): number {
  if (iterations <= 100) return 1;
  return Math.max(1, Math.floor(iterations / 200));
}

async function main(): Promise<number> {
  let opts: FuzzOptions | undefined;

  try {
    opts = parseArgs(process.argv.slice(2));
    const random = mulberry32(opts.seed);
    const renderAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_PRINTABLE_ASCII });
    const decodeAtlas = buildGlyphAtlas(RAW_GLYPHS, { charset: charsetForDecode(opts.charset) });
    const progressEvery = progressInterval(opts.iterations);
    let mismatches = 0;

    renderProgress(0, opts.iterations, mismatches);

    for (let i = 0; i < opts.iterations; i++) {
      const text = randomFuzzText(random, opts);
      const line = lineFromTintedAtlasText(text, {
        atlas: renderAtlas,
        startX: START_X,
        evidenceMode: opts.evidenceMode,
      });
      const endX = START_X + textWidth(text, renderAtlas);
      const decoded = decodeLine(decodeAtlas, line, {
        startX: START_X,
        endX,
        beamSize: opts.beamSize,
        branchLimit: opts.branchLimit,
        confidenceFloor: opts.confidenceFloor,
      });

      if (!equivalentDecodedText(decoded.text, text)) {
        mismatches += 1;
        clearProgress();
        process.stdout.write(formatMismatch(text, decoded.text));
      }

      const done = i + 1;
      if (done === opts.iterations || done % progressEvery === 0) {
        renderProgress(done, opts.iterations, mismatches);
      }
    }

    finishProgress();
    if (mismatches > 0) process.stderr.write(`glyph fuzz seed=${opts.seed}\n`);
    return mismatches === 0 ? 0 : 1;
  } catch (err) {
    finishProgress();
    if (opts) process.stderr.write(`glyph fuzz seed=${opts.seed}\n`);
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

process.exit(await main());
