import { GLYPH_HEIGHT } from "./constants";
import type { Glyph } from "./atlas";
import { evidenceAt, type LineAnchors } from "./preprocess";

export type RankedCandidate = {
  glyph: Glyph;
  pairwiseScore: number;
  wins: number;
};

/** Midpoint pairwise margin of candidate A over candidate B.
 *
 * The two glyph templates are compared only through their weighted template
 * values. The decision boundary for each pixel is the midpoint between the two
 * candidates. If A expects more ink than B, evidence above the midpoint favors
 * A; if A expects less ink than B, evidence below the midpoint favors A.
 *
 * Positive margin means the evidence crop looks more like A. Negative margin
 * means it looks more like B. Identical templates produce margin 0 and should
 * be resolved by context.
 */
export function midpointPairwiseMargin(
  line: LineAnchors,
  x: number,
  glyphA: Glyph,
  glyphB: Glyph,
  confidenceFloor = 0.25,
): number {
  let numerator = 0;
  let denominator = 0;

  for (let y = 0; y < GLYPH_HEIGHT; y++) {
    const compareWidth = Math.min(glyphA.width, glyphB.width);
    for (let col = 0; col < compareWidth; col++) {
      const wa = glyphA.weights[y * glyphA.visualWidth + col] / 255;
      const wb = glyphB.weights[y * glyphB.visualWidth + col] / 255;
      const signed = wa - wb;
      const diff = Math.abs(signed);
      if (diff === 0) continue;

      const ix = x + col;
      const evidence = evidenceAt(line, ix, y);
      const confidence = Math.max(wa, wb);
      const pixelWeight = diff * (confidenceFloor + (1 - confidenceFloor) * confidence);
      const midpoint = 0.5 * (wa + wb);

      numerator += pixelWeight * signed * (evidence - midpoint);
      denominator += pixelWeight * diff;
    }
  }

  return denominator <= 1e-12 ? 0 : numerator / denominator;
}

/** Rerank exact-anchor candidates by all-pairs midpoint comparison.
 *
 * This function intentionally assumes candidates have already passed exact
 * anchor matching. It only answers: among these visually possible glyphs, which
 * one is best supported by the soft cyan evidence in the pixels where the
 * candidates differ?
 */
export function rerankCandidates(
  line: LineAnchors,
  x: number,
  candidates: readonly Glyph[],
  confidenceFloor = 0.25,
): RankedCandidate[] {
  if (candidates.length === 0) return [];
  const ranked: RankedCandidate[] = [];

  for (const a of candidates) {
    let scoreSum = 0;
    let comparisons = 0;
    let wins = 0;

    for (const b of candidates) {
      if (a === b) continue;
      const margin = midpointPairwiseMargin(line, x, a, b, confidenceFloor);
      scoreSum += margin;
      comparisons += 1;
      if (margin > 0) wins += 1;
    }

    ranked.push({
      glyph: a,
      pairwiseScore: comparisons === 0 ? 0 : scoreSum / comparisons,
      wins,
    });
  }

  ranked.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pairwiseScore !== a.pairwiseScore) return b.pairwiseScore - a.pairwiseScore;
    return a.glyph.orderIndex - b.glyph.orderIndex;
  });

  return ranked;
}

export function formatTopCandidates(candidates: readonly RankedCandidate[], limit = 6): string {
  return candidates
    .slice(0, limit)
    .map((c) => {
      const label = c.glyph.char === " " ? "space" : c.glyph.char;
      return `${label}/${c.glyph.width}:${c.pairwiseScore >= 0 ? "+" : ""}${c.pairwiseScore.toFixed(4)},w${c.wins}`;
    })
    .join(" ");
}
