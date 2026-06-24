import type { Glyph, GlyphAtlas } from "./atlas";
import { CHARSET_NUMERIC } from "./constants";
import type { DecodeDecision } from "./decoder";
import type { LineAnchors } from "./preprocess";
import { rerankCandidates, type RankedCandidate } from "./rerank";

export type KnownPatternDecodeResult = {
  text: string;
  /** Exclusive end x after the matched pattern. */
  x: number;
  decisions: DecodeDecision[];
};

export type DecodeKnownPatternOptions = {
  format?: string;
  startX?: number;
  /** Candidate characters for placeholder slots only. */
  charset?: string;
  placeholder?: string;
  branchLimit?: number;
  confidenceFloor?: number;
};

type PatternToken =
  | { kind: "literal"; char: string; glyph: Glyph }
  | { kind: "placeholder"; choices: Glyph[] };

type PatternState = KnownPatternDecodeResult & {
  score: number;
};

const DEFAULT_PATTERN_FORMAT = "[NN:NN:NN]";
const DEFAULT_PATTERN_START_X = 3;
const DEFAULT_PATTERN_PLACEHOLDER = "N";

function uniqueChars(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of value) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

function requireGlyph(atlas: GlyphAtlas, ch: string, source: string): Glyph {
  const glyph = atlas.byChar.get(ch);
  if (!glyph) throw new Error(`${source} contains unavailable glyph: ${JSON.stringify(ch)}`);
  return glyph;
}

function compilePattern(atlas: GlyphAtlas, format: string, charset: string, placeholder: string): PatternToken[] {
  if (placeholder.length !== 1) throw new Error(`placeholder must be one character: ${JSON.stringify(placeholder)}`);

  const placeholderChoices = uniqueChars(charset).map((ch) => requireGlyph(atlas, ch, "charset"));
  const tokens: PatternToken[] = [];

  for (const ch of format) {
    if (ch === placeholder) tokens.push({ kind: "placeholder", choices: placeholderChoices });
    else tokens.push({ kind: "literal", char: ch, glyph: requireGlyph(atlas, ch, "format") });
  }

  return tokens;
}

function anchorMatches(line: LineAnchors, x: number, glyph: Glyph): boolean {
  if (x + glyph.width > line.anchorString.length) return false;
  return line.anchorString.substring(x, x + glyph.width) === glyph.anchorKey;
}

function literalCandidate(glyph: Glyph): RankedCandidate {
  return { glyph, pairwiseScore: 0, wins: 0 };
}

function matchingCandidates(
  token: PatternToken,
  line: LineAnchors,
  x: number,
  confidenceFloor: number,
): RankedCandidate[] {
  if (token.kind === "literal") {
    return anchorMatches(line, x, token.glyph) ? [literalCandidate(token.glyph)] : [];
  }

  const matches = token.choices.filter((glyph) => anchorMatches(line, x, glyph));
  return rerankCandidates(line, x, matches, confidenceFloor);
}

export function decodeKnownPattern(
  atlas: GlyphAtlas,
  line: LineAnchors,
  options: DecodeKnownPatternOptions = {},
): KnownPatternDecodeResult | null {
  const format = options.format ?? DEFAULT_PATTERN_FORMAT;
  const startX = options.startX ?? DEFAULT_PATTERN_START_X;
  const charset = options.charset ?? CHARSET_NUMERIC;
  const placeholder = options.placeholder ?? DEFAULT_PATTERN_PLACEHOLDER;
  const branchLimit = options.branchLimit ?? 8;
  const confidenceFloor = options.confidenceFloor ?? 0.25;
  const tokens = compilePattern(atlas, format, charset, placeholder);

  let states: PatternState[] = [{ text: "", x: startX, decisions: [], score: 0 }];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    const next: PatternState[] = [];

    for (const state of states) {
      const ranked = matchingCandidates(token, line, state.x, confidenceFloor);
      for (const cand of ranked.slice(0, branchLimit)) {
        const second = ranked.length > 1 ? ranked[1] : undefined;
        const margin = second ? cand.pairwiseScore - second.pairwiseScore : 0;
        const decision: DecodeDecision = {
          kind: "glyph",
          step: tokenIndex,
          x: state.x,
          selected: cand,
          second,
          candidateCount: ranked.length,
          topCandidates: ranked.slice(0, Math.min(8, ranked.length)),
          margin,
        };

        next.push({
          text: state.text + cand.glyph.char,
          x: state.x + cand.glyph.width,
          decisions: [...state.decisions, decision],
          score: state.score + cand.pairwiseScore,
        });
      }
    }

    if (next.length === 0) return null;
    next.sort((a, b) => b.score - a.score);
    states = next.slice(0, branchLimit);
  }

  const best = states[0];
  return {
    text: best.text,
    x: best.x,
    decisions: best.decisions,
  };
}

export function decodeTimestamp(
  atlas: GlyphAtlas,
  line: LineAnchors,
  options: DecodeKnownPatternOptions = {},
): KnownPatternDecodeResult | null {
  return decodeKnownPattern(atlas, line, {
    format: DEFAULT_PATTERN_FORMAT,
    startX: DEFAULT_PATTERN_START_X,
    charset: CHARSET_NUMERIC,
    placeholder: DEFAULT_PATTERN_PLACEHOLDER,
    ...options,
  });
}
