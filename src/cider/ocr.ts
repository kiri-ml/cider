import { buildGlyphAtlas, filterGlyphAtlas, type Glyph, type GlyphAtlas } from "./glyph-decoder/atlas";
import {
  CHARSET_ALPHANUMERIC,
  CHARSET_SPACED_ALPHANUMERIC,
  CHARSET_TIMESTAMP,
} from "./glyph-decoder/constants";
import { decodeBuffMsg } from "./glyph-decoder/buff";
import { RAW_GLYPHS } from "./glyph-decoder/generated/glyph_atlas_cleartype_rgb";
import { RAW_GLYPHS as RAW_GLYPHS_CLEARTYPE_BGR } from "./glyph-decoder/generated/glyph_atlas_cleartype_bgr";
import { decodeTimestamp, type KnownPatternDecodeResult } from "./glyph-decoder/pattern";
import { buildLineAnchors, type LineAnchors, type RgbaImage } from "./glyph-decoder/preprocess";
import type {
  AppleOcrDebug,
  AppleOcrOptions,
  AppleOcrRejectReason,
  AppleOcrResponse,
  AppleOcrResult,
  AppleOcrSliceInput,
} from "./types";

type OcrAtlasProfile = {
  id: "cleartype-rgb" | "cleartype-bgr";
  timestampAtlas: GlyphAtlas;
  messageAtlas: GlyphAtlas;
  playerNameAtlas: GlyphAtlas;
  finalTimestampBracketX: number;
};

const TIMESTAMP_START_X = 3;
const TIMESTAMP_PREFIX_BEFORE_FINAL_BRACKET = "[NN:NN:NN";
const MESSAGE_CHARSET = `${CHARSET_SPACED_ALPHANUMERIC}'`;

const OCR_ATLAS_PROFILES: OcrAtlasProfile[] = [
  buildOcrAtlasProfile("cleartype-rgb", RAW_GLYPHS),
  buildOcrAtlasProfile("cleartype-bgr", RAW_GLYPHS_CLEARTYPE_BGR),
];

const DEFAULT_OCR_ATLAS_PROFILE = OCR_ATLAS_PROFILES[0];

type AppleBodyParseResult =
  | { ok: true; player: string; item: string }
  | { ok: false; reason: "not_apple_log" | "bad_player_name" | "bad_item_name" };

export function recognizeAppleOcr(
  slices: readonly AppleOcrSliceInput[],
  options: AppleOcrOptions = {},
): AppleOcrResponse {
  const results = slices.map((slice) => recognizeAppleOcrSlice(slice, options));
  return {
    v: 1,
    results,
    summary: appleOcrSummary(results),
  };
}

export function recognizeAppleOcrSlice(
  input: AppleOcrSliceInput,
  options: AppleOcrOptions = {},
): AppleOcrResult {
  return decodeAppleOcrImage(input.id, input.image, options);
}

export function appleOcrTimestampBracketScore(image: RgbaImage): number {
  const line = buildLineAnchors(image);
  return bestTimestampBracketScore(line);
}

export function decodeAppleOcrImage(
  id: string,
  image: RgbaImage,
  options: AppleOcrOptions = {},
): AppleOcrResult {
  try {
    const line = buildLineAnchors(image, { evidenceMode: options.evidenceMode });
    const profile = selectOcrAtlasProfile(line);
    const timestamp = decodeTimestamp(profile.timestampAtlas, line);
    const time = validTimestampValue(timestamp?.text);

    if (!timestamp || !time) {
      return rejected(id, "bad_timestamp", timestamp?.text, debugPayload(options.debug, timestamp ?? undefined, undefined));
    }

    const body = decodeBuffMsg(profile.messageAtlas, profile.playerNameAtlas, line, { startX: timestamp.x });
    const parsed = parseAppleBody(body.text);
    const text = `${timestamp.text}${body.text}`;
    const score = Math.max(0, Math.min(1, body.score / Math.max(1, body.decisions.length)));
    const debug = debugPayload(options.debug, timestamp, body);

    if (!parsed.ok) {
      return {
        id,
        ok: false,
        reason: parsed.reason,
        time,
        text,
        score,
        debug,
      };
    }

    return {
      id,
      ok: true,
      time,
      player: parsed.player,
      item: parsed.item,
      text,
      score,
      debug,
    };
  } catch {
    return rejected(id, "ocr_error");
  }
}

function buildOcrAtlasProfile(
  id: OcrAtlasProfile["id"],
  rawGlyphs: Parameters<typeof buildGlyphAtlas>[0],
): OcrAtlasProfile {
  const fullAtlas = buildGlyphAtlas(rawGlyphs);
  const timestampAtlas = filterGlyphAtlas(fullAtlas, CHARSET_TIMESTAMP);
  const messageAtlas = filterGlyphAtlas(fullAtlas, MESSAGE_CHARSET);
  return {
    id,
    timestampAtlas,
    messageAtlas,
    playerNameAtlas: filterGlyphAtlas(messageAtlas, CHARSET_ALPHANUMERIC),
    finalTimestampBracketX: timestampPatternWidthBeforeFinalBracket(timestampAtlas),
  };
}

function timestampPatternWidthBeforeFinalBracket(atlas: GlyphAtlas): number {
  let x = TIMESTAMP_START_X;
  for (const ch of TIMESTAMP_PREFIX_BEFORE_FINAL_BRACKET) {
    const glyph = glyphForTimestampPatternChar(atlas, ch);
    x += glyph.width;
  }
  return x;
}

function glyphForTimestampPatternChar(atlas: GlyphAtlas, ch: string): Glyph {
  const resolved = ch === "N" ? "0" : ch;
  const glyph = atlas.byChar.get(resolved);
  if (!glyph) throw new Error(`timestamp atlas is missing glyph ${JSON.stringify(resolved)}`);
  return glyph;
}

function selectOcrAtlasProfile(line: LineAnchors): OcrAtlasProfile {
  let best = DEFAULT_OCR_ATLAS_PROFILE;
  let bestScore = 0;
  let tied = false;

  for (const profile of OCR_ATLAS_PROFILES) {
    const score = scoreTimestampBrackets(profile, line);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }

  return tied || bestScore === 0 ? DEFAULT_OCR_ATLAS_PROFILE : best;
}

function bestTimestampBracketScore(line: LineAnchors): number {
  let bestScore = 0;
  for (const profile of OCR_ATLAS_PROFILES) {
    bestScore = Math.max(bestScore, scoreTimestampBrackets(profile, line));
  }
  return bestScore;
}

function scoreTimestampBrackets(profile: OcrAtlasProfile, line: LineAnchors): number {
  let score = 0;
  if (anchorMatches(line, TIMESTAMP_START_X, requiredGlyph(profile.timestampAtlas, "["))) score += 1;
  if (anchorMatches(line, profile.finalTimestampBracketX, requiredGlyph(profile.timestampAtlas, "]"))) score += 1;
  return score;
}

function requiredGlyph(atlas: GlyphAtlas, ch: string): Glyph {
  const glyph = atlas.byChar.get(ch);
  if (!glyph) throw new Error(`atlas is missing glyph ${JSON.stringify(ch)}`);
  return glyph;
}

function anchorMatches(line: LineAnchors, x: number, glyph: Glyph): boolean {
  if (x + glyph.width > line.anchorString.length) return false;
  return line.anchorString.substring(x, x + glyph.width) === glyph.anchorKey;
}

function parseAppleBody(text: string): AppleBodyParseResult {
  const trimmed = text.trim();
  const used = trimmed.match(/(?:^|\s)used(?:\s+|$)/);
  if (!used || used.index === undefined) return { ok: false, reason: "not_apple_log" };

  const player = trimmed.slice(0, used.index).trim();
  if (!player || !/^\S+$/.test(player)) return { ok: false, reason: "bad_player_name" };

  const item = trimmed.slice(used.index + used[0].length).trim();
  if (!item) return { ok: false, reason: "bad_item_name" };
  return { ok: true, player, item };
}

function validTimestampValue(value: string | undefined): string | null {
  const match = value?.match(/^\[(\d{2}):(\d{2}):(\d{2})\]$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${match[1]}:${match[2]}:${match[3]}`;
}

function rejected(
  id: string,
  reason: AppleOcrRejectReason,
  text?: string,
  debug?: AppleOcrDebug,
): AppleOcrResult {
  return { id, ok: false, reason, text, debug };
}

function debugPayload(
  enabled: boolean | undefined,
  timestamp: KnownPatternDecodeResult | undefined,
  body: { text: string; score: number; decisions: readonly unknown[] } | undefined,
): AppleOcrDebug | undefined {
  if (!enabled) return undefined;
  return {
    ts: timestamp?.text,
    msg: body?.text,
    tsScore: timestamp ? 1 : 0,
    msgScore: body ? Math.max(0, Math.min(1, body.score / Math.max(1, body.decisions.length))) : undefined,
    structScore: timestamp && body ? 1 : 0,
  };
}

function appleOcrSummary(results: readonly AppleOcrResult[]): AppleOcrResponse["summary"] {
  let ok = 0;
  let errors = 0;
  for (const result of results) {
    if (result.ok) ok += 1;
    if (result.reason === "ocr_error") errors += 1;
  }

  return {
    total: results.length,
    ok,
    rejected: results.length - ok - errors,
    errors,
  };
}
