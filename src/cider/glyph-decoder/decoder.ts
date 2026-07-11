import { blendGlyphWeights, type Glyph, type GlyphAtlas } from "./atlas";
import { evidenceAt, type LineAnchors } from "./preprocess";
import { rerankCandidates, type RankedCandidate } from "./rerank";

export type DecodeToken = {
  /** Exact anchor sequence to match, one UTF-16 code unit per column. */
  anchorKey: string;
  /** Glyph templates used to verify the token against soft pixel evidence. */
  glyphs: Glyph[];
  /** Text appended to the decoded output when this token matches. */
  text: string;
  /** Accept this token on exact anchor match without comparing glyph-only fits. */
  acceptOnAnchorMatch?: boolean;
  /** Stop decoding immediately after accepting this token. */
  terminate?: boolean;
};

export type CompileDecodeTokenOptions = {
  text?: string;
  acceptOnAnchorMatch?: boolean;
  terminate?: boolean;
};

export type RankedTokenCandidate = {
  token: DecodeToken;
  pairwiseScore: number;
  wins: number;
  priorityIndex: number;
};

export type DecodeGlyphDecision = {
  kind: "glyph";
  step: number;
  x: number;
  selected: RankedCandidate;
  second?: RankedCandidate;
  candidateCount: number;
  topCandidates: RankedCandidate[];
  margin: number;
};

export type DecodeTokenDecision = {
  kind: "token";
  step: number;
  x: number;
  selected: RankedTokenCandidate;
  candidateCount: number;
  topCandidates: RankedTokenCandidate[];
  margin: number;
};

export type DecodeDecision = DecodeGlyphDecision | DecodeTokenDecision;

export type DecodeResult = {
  text: string;
  score: number;
  x: number;
  decisions: DecodeDecision[];
};

type BeamState = DecodeResult & { lastGlyph?: Glyph };

export type DecodeOptions = {
  startX: number;
  endX?: number;
  beamSize?: number;
  branchLimit?: number;
  confidenceFloor?: number;
  tokenList?: readonly DecodeToken[];
  denylist?: string;
  /** Use stored right-overhang pixels as sequence evidence. Defaults to true. */
  useOverhangEvidence?: boolean;
};

const TOKEN_SCORE = 1;
const TOKEN_FIT_TOLERANCE = 0.001;

export function compileDecodeToken(
  atlas: GlyphAtlas,
  anchorText: string,
  options: CompileDecodeTokenOptions = {},
): DecodeToken {
  let anchorKey = "";
  const glyphs: Glyph[] = [];
  for (const ch of anchorText) {
    const glyph = atlas.byChar.get(ch);
    if (!glyph) throw new Error(`token contains unavailable glyph: ${JSON.stringify(ch)}`);
    anchorKey += glyph.anchorKey;
    glyphs.push(glyph);
  }

  return {
    anchorKey,
    glyphs,
    text: options.text ?? anchorText,
    acceptOnAnchorMatch: options.acceptOnAnchorMatch,
    terminate: options.terminate,
  };
}

/** Return exact-anchor-compatible glyphs at a position.
 *
 * Each input column is encoded as one UTF-16 code unit. Matching a glyph is just
 * a substring lookup in a width-keyed map. This is exact equality: extra exact
 * anchor pixels inside the glyph window are not allowed.
 */
export function anchorCandidatesAtX(
  atlas: GlyphAtlas,
  inputAnchorString: string,
  x: number,
  endX?: number,
): Glyph[] {
  const out: Glyph[] = [];

  for (const width of atlas.widths) {
    if (endX !== undefined && x + width > endX) continue;
    if (x + width > inputAnchorString.length) continue;
    const key = inputAnchorString.substring(x, x + width);
    const found = atlas.lookupByWidth.get(width)?.get(key);
    if (found) out.push(...found);
  }

  return out;
}

/** Exact-anchor candidate generation followed by midpoint diff reranking. */
export function rankedAtX(
  atlas: GlyphAtlas,
  line: LineAnchors,
  x: number,
  endX?: number,
  confidenceFloor = 0.25,
): RankedCandidate[] {
  const candidates = anchorCandidatesAtX(atlas, line.anchorString, x, endX);
  return rerankCandidates(line, x, candidates, confidenceFloor);
}

/** Decode a line body left-to-right with a small beam search.
 *
 * Only the starting x coordinate is required. The end x coordinate defaults to
 * the rightmost exact-cyan anchor column plus a small pad computed during input
 * preprocessing. At each boundary, exact anchor matching generates candidates;
 * midpoint pairwise scoring ranks them; the beam keeps the best partial paths.
 */
export function decodeLine(atlas: GlyphAtlas, line: LineAnchors, options: DecodeOptions): DecodeResult {
  const startX = options.startX;
  const endX = options.endX ?? line.estimatedEndX;
  const beamSize = options.beamSize ?? 32;
  const branchLimit = options.branchLimit ?? 8;
  const confidenceFloor = options.confidenceFloor ?? 0.25;
  const tokenList = options.tokenList ?? [];
  const denylist = new Set(options.denylist ?? "");
  const useOverhangEvidence = options.useOverhangEvidence ?? true;

  let beams: BeamState[] = [{ text: "", x: startX, score: 0, decisions: [] }];
  let bestFinished: BeamState | undefined;
  const rankCache = new Map<number, RankedCandidate[]>();

  const getRanked = (x: number): RankedCandidate[] => {
    let ranked = rankCache.get(x);
    if (!ranked) {
      const candidates = anchorCandidatesAtX(atlas, line.anchorString, x, endX)
        .filter((glyph) => !denylist.has(glyph.char));
      ranked = rerankCandidates(line, x, candidates, confidenceFloor);
      rankCache.set(x, ranked);
    }
    return ranked;
  };

  for (let step = 0; step < 256; step++) {
    if (beams.length === 0) break;
    const next: BeamState[] = [];

    for (const beam of beams) {
      if (beam.x === endX) {
        const finished = {
          ...beam,
          score: beam.score + (useOverhangEvidence ? overhangFitImprovement(line, beam.x, beam.lastGlyph) : 0),
        };
        if (!bestFinished || finished.score > bestFinished.score) bestFinished = finished;
        continue;
      }
      if (beam.x > endX) continue;

      const tokenDecision = firstTokenDecision(tokenList, atlas, line, beam, endX, denylist, useOverhangEvidence);
      if (tokenDecision) {
        const nextBeam: BeamState = {
          text: beam.text + tokenDecision.selected.token.text,
          x: beam.x + tokenDecision.selected.token.anchorKey.length,
          score: beam.score + tokenDecision.selected.pairwiseScore,
          decisions: [...beam.decisions, tokenDecision],
          lastGlyph: tokenDecision.selected.token.glyphs.at(-1) ?? beam.lastGlyph,
        };

        if (tokenDecision.selected.token.terminate) {
          if (useOverhangEvidence && nextBeam.x === endX) {
            nextBeam.score += overhangFitImprovement(line, nextBeam.x, nextBeam.lastGlyph);
          }
          return publicDecodeResult(nextBeam);
        }
        if (nextBeam.x <= endX) next.push(nextBeam);
        continue;
      }

      const ranked = getRanked(beam.x);
      if (ranked.length === 0) continue;

      for (const cand of ranked.slice(0, branchLimit)) {
        const second = ranked.length > 1 ? ranked[1] : undefined;
        const margin = second ? cand.pairwiseScore - second.pairwiseScore : 0;
        const decision: DecodeDecision = {
          kind: "glyph",
          step: beam.decisions.length,
          x: beam.x,
          selected: cand,
          second,
          candidateCount: ranked.length,
          topCandidates: ranked.slice(0, Math.min(8, ranked.length)),
          margin,
        };

        next.push({
          text: beam.text + cand.glyph.char,
          x: beam.x + cand.glyph.width,
          score: beam.score + cand.pairwiseScore
            + (useOverhangEvidence ? overhangFitImprovement(line, beam.x, beam.lastGlyph, cand.glyph) : 0),
          decisions: [...beam.decisions, decision],
          lastGlyph: cand.glyph,
        });
      }
    }

    if (next.length === 0) break;
    next.sort((a, b) => {
      const aValid = a.x <= endX ? 1 : 0;
      const bValid = b.x <= endX ? 1 : 0;
      if (bValid !== aValid) return bValid - aValid;
      return b.score - a.score;
    });
    beams = next.slice(0, beamSize);
  }

  if (bestFinished) return publicDecodeResult(bestFinished);
  if (beams.length > 0) {
    const best = beams.reduce((previous, current) => (
      current.x > previous.x || (current.x === previous.x && current.score > previous.score) ? current : previous
    ));
    return publicDecodeResult(best);
  }
  return { text: "", x: startX, score: Number.NEGATIVE_INFINITY, decisions: [] };
}

function firstTokenDecision(
  tokenList: readonly DecodeToken[],
  atlas: GlyphAtlas,
  line: LineAnchors,
  beam: BeamState,
  endX: number,
  denylist: ReadonlySet<string>,
  useOverhangEvidence: boolean,
): DecodeTokenDecision | undefined {
  for (let priorityIndex = 0; priorityIndex < tokenList.length; priorityIndex++) {
    const token = tokenList[priorityIndex];
    if (!line.anchorString.startsWith(token.anchorKey, beam.x)) continue;
    if (!token.terminate && beam.x + token.anchorKey.length > endX) continue;

    const tokenScore = glyphSequenceFitScore(line, beam.x, token.glyphs);
    const overhangScore = useOverhangEvidence
      ? glyphSequenceOverhangScore(line, beam.x, beam.lastGlyph, token.glyphs)
      : 0;
    const glyphScore = token.acceptOnAnchorMatch
      ? undefined
      : bestGlyphOnlyFitScore(atlas, line, beam.x, beam.x + token.anchorKey.length, denylist);
    if (!token.acceptOnAnchorMatch && glyphScore !== undefined && tokenScore + TOKEN_FIT_TOLERANCE < glyphScore) continue;

    const selected: RankedTokenCandidate = {
      token,
      pairwiseScore: TOKEN_SCORE + tokenScore + overhangScore,
      wins: tokenList.length - priorityIndex,
      priorityIndex,
    };

    return {
      kind: "token",
      step: beam.decisions.length,
      x: beam.x,
      selected,
      candidateCount: 1,
      topCandidates: [selected],
      margin: glyphScore === undefined ? tokenScore : tokenScore - glyphScore,
    };
  }
  return undefined;
}

function publicDecodeResult(beam: BeamState): DecodeResult {
  const { lastGlyph: _lastGlyph, ...result } = beam;
  return result;
}

function glyphSequenceOverhangScore(
  line: LineAnchors,
  x: number,
  previous: Glyph | undefined,
  glyphs: readonly Glyph[],
): number {
  let score = 0;
  for (const glyph of glyphs) {
    score += overhangFitImprovement(line, x, previous, glyph);
    previous = glyph;
    x += glyph.width;
  }
  return score;
}

/** Incremental fit gained by compositing a previous glyph's right overhang
 * with the next glyph, or with blank space at the end of a line. */
function overhangFitImprovement(
  line: LineAnchors,
  x: number,
  previous: Glyph | undefined,
  current?: Glyph,
): number {
  if (!previous || previous.visualWidth === previous.width) return 0;
  const overhangWidth = previous.visualWidth - previous.width;
  let improvement = 0;
  let pixels = 0;

  for (let y = 0; y < line.height; y++) {
    for (let dx = 0; dx < overhangWidth; dx++) {
      const overhang = previous.weights[y * previous.visualWidth + previous.width + dx] / 255;
      if (overhang === 0) continue;
      const baseline = current && dx < current.width
        ? current.weights[y * current.visualWidth + dx] / 255
        : 0;
      const composite = blendGlyphWeights(overhang, baseline);
      const actual = evidenceAt(line, x + dx, y);
      const baselineDiff = actual - baseline;
      const compositeDiff = actual - composite;
      improvement += baselineDiff * baselineDiff - compositeDiff * compositeDiff;
      pixels += 1;
    }
  }

  return pixels === 0 ? 0 : improvement / pixels;
}

function glyphSequenceFitScore(line: LineAnchors, x: number, glyphs: readonly Glyph[]): number {
  let error = 0;
  let pixels = 0;

  for (const glyph of glyphs) {
    const fit = glyphFitError(line, x, glyph);
    error += fit.error;
    pixels += fit.pixels;
    x += glyph.width;
  }

  return pixels === 0 ? Number.NEGATIVE_INFINITY : 1 - error / pixels;
}

function bestGlyphOnlyFitScore(
  atlas: GlyphAtlas,
  line: LineAnchors,
  startX: number,
  targetX: number,
  denylist: ReadonlySet<string>,
): number | undefined {
  const states = new Map<number, number>([[startX, 0]]);

  for (let x = startX; x < targetX; x++) {
    const baseError = states.get(x);
    if (baseError === undefined) continue;

    const candidates = anchorCandidatesAtX(atlas, line.anchorString, x, targetX)
      .filter((glyph) => !denylist.has(glyph.char));

    for (const glyph of candidates) {
      const nextX = x + glyph.width;
      if (nextX > targetX) continue;

      const fit = glyphFitError(line, x, glyph);
      const nextError = baseError + fit.error;
      const bestError = states.get(nextX);
      if (bestError === undefined || nextError < bestError) states.set(nextX, nextError);
    }
  }

  const bestError = states.get(targetX);
  if (bestError === undefined) return undefined;
  return 1 - bestError / ((targetX - startX) * line.height);
}

function glyphFitError(line: LineAnchors, x: number, glyph: Glyph): { error: number; pixels: number } {
  let error = 0;
  let pixels = 0;

  for (let y = 0; y < line.height; y++) {
    for (let dx = 0; dx < glyph.width; dx++) {
      const expected = glyph.weights[y * glyph.visualWidth + dx] / 255;
      const actual = evidenceAt(line, x + dx, y);
      const diff = actual - expected;
      error += diff * diff;
      pixels += 1;
    }
  }

  return { error, pixels };
}

/** Build expected character positions for benchmark output. */
export function expectedLayout(
  atlas: GlyphAtlas,
  text: string,
  startX: number,
): Map<number, { index: number; char: string; width: number }> {
  const out = new Map<number, { index: number; char: string; width: number }>();
  let x = startX;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    const glyph = atlas.byChar.get(ch);
    if (!glyph) throw new Error(`unsupported benchmark char: ${JSON.stringify(ch)}`);
    out.set(x, { index, char: ch, width: glyph.width });
    x += glyph.width;
  }
  return out;
}
