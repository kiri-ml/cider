#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildGlyphAtlas } from "../src/cider/glyph-decoder/atlas.ts";
import { buildLineAnchors, type RgbaImage } from "../src/cider/glyph-decoder/preprocess.ts";
import { decodeLine, expectedLayout } from "../src/cider/glyph-decoder/decoder.ts";
import { formatTopCandidates } from "../src/cider/glyph-decoder/rerank.ts";
import {
  CHARSET_PRINTABLE_ASCII,
  CHARSET_SPACED_ALPHANUMERIC,
  CHARSET_TIMESTAMP,
} from "../src/cider/glyph-decoder/constants.ts";
import { RAW_GLYPHS } from "../src/cider/glyph-decoder/generated/glyph_atlas_cleartype_rgb.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(rootDir, "data/tests/examples");
const DEFAULT_EXPECTED_PATH = path.join(rootDir, "data/tests/glyph_decoder_expected.json");
const DEFAULT_SLICES_DIR = path.join(rootDir, "data/tests/slices");

type CaseSpec = {
  name: string;
  file: string;
  startX: number;
  expected: string;
};

const CASES: CaseSpec[] = [
  { name: "apple", file: "apple.png", startX: 57, expected: "Shedinja used Onyx Apple" },
  { name: "choco", file: "choco.png", startX: 57, expected: "Peke used Gelt Chocolate" },
  { name: "cheese", file: "cheese.png", startX: 57, expected: "qwertylL used Ssiws Cheese" },
  { name: "job", file: "job.png", startX: 52, expected: "Congratulations to Mechuda on becoming a Bowman" },
  { name: "apple_noisy", file: "apple_noisy.png", startX: 57, expected: "JoJoni used Onyx Apple" },
  { name: "apple_digit", file: "apple_digit.png", startX: 57, expected: "Legoshi420 used Onyx Apple" },
];

type CommonOptions = {
  dataDir: string;
  bboxPad: number;
  endPad: number;
  beamSize: number;
  branchLimit: number;
  confidenceFloor: number;
};

type TestOptions = CommonOptions & {
  expected: string;
  slicesDir: string;
  startX: number;
  endX?: number;
  limitDiffs: number;
};

type ExpectedEntry = {
  id: string;
  text: string;
  start_x?: number;
  end_x?: number;
};

type DecodeCharsetPreset = "default" | "timestamp" | "all";

function decodeCharset(preset: DecodeCharsetPreset): string {
  if (preset === "default") return CHARSET_SPACED_ALPHANUMERIC;
  if (preset === "timestamp") return CHARSET_TIMESTAMP;
  return CHARSET_PRINTABLE_ASCII;
}

function parseDecodeCharset(value: string | undefined): DecodeCharsetPreset {
  if (value === "default" || value === "timestamp" || value === "all") return value;
  throw new Error(`invalid decode charset: ${value ?? ""}`);
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`invalid number: ${value}`);
  return n;
}

async function readPngRgba(imagePath: string): Promise<RgbaImage> {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data,
  };
}

function applyCommonOption(opts: CommonOptions, args: string[], index: number): number {
  const arg = args[index];
  if (arg === "--data-dir") {
    opts.dataDir = path.resolve(args[index + 1]);
    return index + 1;
  }
  if (arg === "--bbox-pad") {
    opts.bboxPad = parseNumber(args[index + 1], opts.bboxPad);
    return index + 1;
  }
  if (arg === "--end-pad") {
    opts.endPad = parseNumber(args[index + 1], opts.endPad);
    return index + 1;
  }
  if (arg === "--beam-size") {
    opts.beamSize = parseNumber(args[index + 1], opts.beamSize);
    return index + 1;
  }
  if (arg === "--branch-limit") {
    opts.branchLimit = parseNumber(args[index + 1], opts.branchLimit);
    return index + 1;
  }
  if (arg === "--confidence-floor") {
    opts.confidenceFloor = parseNumber(args[index + 1], opts.confidenceFloor);
    return index + 1;
  }
  return -1;
}

function parseCommon(args: string[]): CommonOptions {
  const opts: CommonOptions = {
    dataDir: DEFAULT_DATA_DIR,
    bboxPad: 8,
    endPad: 3,
    beamSize: 12,
    branchLimit: 8,
    confidenceFloor: 0.25,
  };

  for (let i = 0; i < args.length; i++) {
    const next = applyCommonOption(opts, args, i);
    if (next < 0) throw new Error(`unknown option: ${args[i]}`);
    i = next;
  }

  return opts;
}

function parseTestOptions(args: string[]): TestOptions {
  const opts: TestOptions = {
    dataDir: DEFAULT_DATA_DIR,
    bboxPad: 8,
    endPad: 3,
    beamSize: 12,
    branchLimit: 8,
    confidenceFloor: 0.25,
    expected: DEFAULT_EXPECTED_PATH,
    slicesDir: DEFAULT_SLICES_DIR,
    startX: 57,
    limitDiffs: 50,
  };

  for (let i = 0; i < args.length; i++) {
    const commonNext = applyCommonOption(opts, args, i);
    if (commonNext >= 0) {
      i = commonNext;
      continue;
    }

    const arg = args[i];
    if (arg === "--expected") opts.expected = path.resolve(args[++i]);
    else if (arg === "--slices-dir") opts.slicesDir = path.resolve(args[++i]);
    else if (arg === "--start-x") opts.startX = parseNumber(args[++i], opts.startX);
    else if (arg === "--end-x") opts.endX = parseNumber(args[++i], 0);
    else if (arg === "--limit-diffs") opts.limitDiffs = parseNumber(args[++i], opts.limitDiffs);
    else throw new Error(`unknown option: ${arg}`);
  }

  return opts;
}

function buildAtlasAndPrintSummary() {
  const atlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_SPACED_ALPHANUMERIC });
  console.log(`glyphs=${atlas.glyphs.length} distinct_widths=(${atlas.widths.join(", ")})`);
  for (const width of atlas.widths) {
    const chars = atlas.glyphs.filter((g) => g.width === width).map((g) => g.char).join("");
    console.log(`  width ${String(width).padStart(2)}: ${JSON.stringify(chars)}`);
  }
  return atlas;
}

async function prepareCase(file: string, opts: CommonOptions) {
  const image = await readPngRgba(path.join(opts.dataDir, file));
  return buildLineAnchors(image, { bboxPad: opts.bboxPad, endPad: opts.endPad });
}

async function selfTest(argv: string[]): Promise<number> {
  const opts = parseCommon(argv);
  const atlas = buildAtlasAndPrintSummary();

  for (const item of CASES) {
    const line = await prepareCase(item.file, opts);
    const decoded = decodeLine(atlas, line, {
      startX: item.startX,
      beamSize: opts.beamSize,
      branchLimit: opts.branchLimit,
      confidenceFloor: opts.confidenceFloor,
    });
    const ok = decoded.text === item.expected ? "OK" : "DIFF";
    console.log(`${item.name}: parsed=${JSON.stringify(decoded.text)} expected=${JSON.stringify(item.expected)} ${ok}`);
  }

  return 0;
}

async function trace(argv: string[]): Promise<number> {
  const opts = parseCommon(argv);
  const atlas = buildAtlasAndPrintSummary();
  console.log("mode=string-key exact-anchor candidates + midpoint-diff reranking");

  let total = 0;
  let correct = 0;

  for (const item of CASES) {
    const line = await prepareCase(item.file, opts);
    const decoded = decodeLine(atlas, line, {
      startX: item.startX,
      beamSize: opts.beamSize,
      branchLimit: opts.branchLimit,
      confidenceFloor: opts.confidenceFloor,
    });
    const layout = expectedLayout(atlas, item.expected, item.startX);

    console.log(`\n[${item.name}] image=${item.file} start=${item.startX} end=${line.estimatedEndX}`);
    console.log(`parsed  : ${JSON.stringify(decoded.text)}`);
    console.log(`expected: ${JSON.stringify(item.expected)}`);
    console.log("idx x   exp sel width cands wins score    margin   top");
    console.log("--- --- --- --- ----- ----- ---- -------- -------- --------------------------------");

    for (const decision of decoded.decisions) {
      if (decision.kind === "token") {
        console.log(
          `${String("-").padStart(3)} ${String(decision.x).padStart(3)} ${"_".padStart(3)} ${decision.selected.token.text.padStart(3)} ` +
            `${String(decision.selected.token.anchorKey.length).padStart(5)} ${String(decision.candidateCount).padStart(5)} ` +
            `${String(decision.selected.wins).padStart(4)} ${decision.selected.pairwiseScore >= 0 ? "+" : ""}${decision.selected.pairwiseScore.toFixed(5)} ` +
            `${decision.margin >= 0 ? "+" : ""}${decision.margin.toFixed(5)} token#${decision.selected.priorityIndex}`,
        );
        continue;
      }

      const exp = layout.get(decision.x);
      const expIndex = exp?.index ?? -1;
      const expChar = exp?.char ?? "?";
      const selectedChar = decision.selected.glyph.char;
      const ok = selectedChar === expChar;
      total += 1;
      if (ok) correct += 1;

      const expLabel = expChar === " " ? "_" : expChar;
      const selLabel = selectedChar === " " ? "_" : selectedChar;
      const mark = ok ? "" : "  <--";
      console.log(
        `${String(expIndex).padStart(3)} ${String(decision.x).padStart(3)} ${expLabel.padStart(3)} ${selLabel.padStart(3)} ` +
          `${String(decision.selected.glyph.width).padStart(5)} ${String(decision.candidateCount).padStart(5)} ` +
          `${String(decision.selected.wins).padStart(4)} ${decision.selected.pairwiseScore >= 0 ? "+" : ""}${decision.selected.pairwiseScore.toFixed(5)} ` +
          `${decision.margin >= 0 ? "+" : ""}${decision.margin.toFixed(5)} ${formatTopCandidates(decision.topCandidates)}${mark}`,
      );
    }
  }

  console.log(`\naccuracy=${correct}/${total}`);
  return correct === total ? 0 : 1;
}

async function decode(argv: string[]): Promise<number> {
  if (argv.length < 1) {
    console.error("usage: npm run glyph:decode -- IMAGE [--start-x 57] [--end-x N]");
    return 1;
  }

  const imagePath = path.resolve(argv[0]);
  let startX = 57;
  let endX: number | undefined;
  let charset: DecodeCharsetPreset = "default";
  const commonArgs: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--start-x") startX = parseNumber(argv[++i], startX);
    else if (arg === "--end-x") endX = parseNumber(argv[++i], 0);
    else if (arg === "--charset") charset = parseDecodeCharset(argv[++i]);
    else commonArgs.push(arg);
  }

  const opts = parseCommon(commonArgs);
  const atlas = buildGlyphAtlas(RAW_GLYPHS, { charset: decodeCharset(charset) });
  const image = await readPngRgba(imagePath);
  const line = buildLineAnchors(image, { bboxPad: opts.bboxPad, endPad: opts.endPad });
  const decoded = decodeLine(atlas, line, {
    startX,
    endX,
    beamSize: opts.beamSize,
    branchLimit: opts.branchLimit,
    confidenceFloor: opts.confidenceFloor,
  });
  console.log(decoded.text);
  return 0;
}

function loadExpectedEntries(expectedPath: string): ExpectedEntry[] {
  const payload = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as unknown;
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error(`${expectedPath} does not contain a results array`);
  }

  const out: ExpectedEntry[] = [];
  for (const entry of (payload as { results: unknown[] }).results) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    const text = (entry as { text?: unknown }).text;
    if (typeof id === "string" && typeof text === "string") {
      const startX = (entry as { start_x?: unknown }).start_x;
      const endX = (entry as { end_x?: unknown }).end_x;
      out.push({
        id,
        text,
        start_x: typeof startX === "number" ? startX : undefined,
        end_x: typeof endX === "number" ? endX : undefined,
      });
    }
  }
  return out;
}

async function benchmark(argv: string[]): Promise<number> {
  const opts = parseTestOptions(argv);
  const expectedEntries = loadExpectedEntries(opts.expected);
  const atlas = buildGlyphAtlas(RAW_GLYPHS, { charset: CHARSET_SPACED_ALPHANUMERIC });

  let total = 0;
  let matches = 0;
  const diffs: Array<{ id: string; expected: string; actual: string }> = [];
  const errors: Array<{ id: string; error: string }> = [];
  let decodeSeconds = 0;

  for (const entry of expectedEntries) {
    const imagePath = path.join(opts.slicesDir, `${entry.id}.png`);
    try {
      const startTime = performance.now();
      const image = await readPngRgba(imagePath);
      const line = buildLineAnchors(image, { bboxPad: opts.bboxPad, endPad: opts.endPad });
      const decoded = decodeLine(atlas, line, {
        startX: opts.startX,
        endX: opts.endX,
        beamSize: opts.beamSize,
        branchLimit: opts.branchLimit,
        confidenceFloor: opts.confidenceFloor,
      });
      decodeSeconds += (performance.now() - startTime) / 1000.0;

      total += 1;
      if (decoded.text === entry.text) {
        matches += 1;
      } else {
        diffs.push({ id: entry.id, expected: entry.text, actual: decoded.text });
      }
    } catch (err) {
      errors.push({ id: entry.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`expected_entries=${expectedEntries.length}`);
  console.log(`decoded=${total}`);
  console.log(`matches=${matches}`);
  console.log(`diffs=${diffs.length}`);
  console.log(`errors=${errors.length}`);
  console.log(`decode_seconds=${decodeSeconds.toFixed(6)}`);
  if (total > 0) {
    console.log(`decode_ms_per_image=${((decodeSeconds / total) * 1000.0).toFixed(3)}`);
    console.log(`decode_images_per_second=${(total / decodeSeconds).toFixed(2)}`);
  }

  if (diffs.length > 0) {
    console.log("");
    console.log(`diff examples (limit ${opts.limitDiffs}):`);
    for (const diff of diffs.slice(0, opts.limitDiffs)) {
      console.log(diff.id);
      console.log(`  expected: ${JSON.stringify(diff.expected)}`);
      console.log(`  parsed  : ${JSON.stringify(diff.actual)}`);
    }
  }

  if (errors.length > 0) {
    console.log("");
    console.log(`errors (limit ${opts.limitDiffs}):`);
    for (const error of errors.slice(0, opts.limitDiffs)) {
      console.log(`${error.id}: ${error.error}`);
    }
  }

  return diffs.length === 0 && errors.length === 0 ? 0 : 1;
}

function usage(): void {
  console.log(`Usage:
  tsx scripts/glyph_decoder.ts self-test [options]
  tsx scripts/glyph_decoder.ts trace [options]
  tsx scripts/glyph_decoder.ts decode IMAGE [--start-x 57] [--end-x N] [--charset default|timestamp|all] [options]
  tsx scripts/glyph_decoder.ts benchmark [--expected PATH] [--slices-dir DIR] [options]

Options:
  --data-dir DIR           sample data directory for self-test/trace
  --expected PATH          generated expected JSON for test
  --slices-dir DIR         slice PNG directory for test
  --start-x N              body text start x for test/decode
  --end-x N                exclusive end x for test/decode
  --charset NAME           decode charset preset: default, timestamp, all
  --limit-diffs N          maximum diff/error examples for test
  --bbox-pad N             soft evidence bbox pad around exact-cyan anchors
  --end-pad N              pixels after rightmost exact-cyan anchor
  --beam-size N            beam size for left-to-right decode
  --branch-limit N         ranked candidates expanded per beam
  --confidence-floor F     midpoint diff confidence floor
`);
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "self-test") return await selfTest(rest);
    if (command === "trace") return await trace(rest);
    if (command === "decode") return await decode(rest);
    if (command === "benchmark") return await benchmark(rest);
    usage();
    return command ? 1 : 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

process.exit(await main());
