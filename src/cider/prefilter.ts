import { appleOcrTimestampBracketScore } from "./ocr";

const TIMESTAMP_BRACKET_MATCH_THRESHOLD = 2;

export type PrefilterResult =
  | { ok: true }
  | { ok: false; reason: number };

export function appleTimestampBracketPrefilterScore(pixels: Uint8ClampedArray, width: number, height: number): number {
  try {
    return appleOcrTimestampBracketScore({ width, height, data: pixels });
  } catch {
    return 0;
  }
}

export function appleTimestampBracketPrefilter(pixels: Uint8ClampedArray, width: number, height: number): PrefilterResult {
  const score = appleTimestampBracketPrefilterScore(pixels, width, height);
  return score >= TIMESTAMP_BRACKET_MATCH_THRESHOLD ? { ok: true } : { ok: false, reason: score };
}
