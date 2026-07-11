# Glyph Overhang

## Background

Some rendered glyphs produce weak anti-alias pixels beyond their logical advance. The next glyph still begins at the logical advance, so these pixels overlap the next glyph or the background instead of increasing text width.

The atlas source slices contain text in the form `0x0`, where `x` is the glyph being measured. The surrounding zeros provide aligned reference pixels:

- A stronger pixel in the first zero identifies left overhang from `x`.
- A stronger pixel in the last zero identifies right overhang from `x`.
- Subtracting the aligned zero weights isolates the middle glyph's contribution instead of storing pixels belonging to the zero itself.

The current RGB and BGR fixtures contain no left overhang. They contain 22 right-overhang atlas entries: 2 in the RGB atlas and 20 in the BGR atlas. Generation fails if left overhang appears, because the current compact representation supports only right overhang.

## Atlas representation

`Glyph.width` remains the logical cursor advance. A glyph's decoded `weights` may contain trailing right-overhang columns, and `Glyph.visualWidth` is the row stride derived from the weight-array length.

Consequently, a logical template pixel is indexed with:

```ts
glyph.weights[y * glyph.visualWidth + x]
```

even when matching only `x < glyph.width`. The stored columns in `[width, visualWidth)` are the optional right overhang.

## Pixel composition

Overhang is already visible at full measured strength when the following glyph is blank. It must not be treated as half of its stored value. Measurements over a black background include:

```text
0x1b over blank -> 0x1b
0x1b over 0x1b -> 0x29
0x1b over 0x67 -> 0x76
```

The decoder uses this compact approximation in normalized weight space:

```text
blend(a, b) = min(1, max(a, b) + 0.5 * min(a, b))
```

It preserves either contribution over blank, predicts `0x29` for two `0x1b` contributions, and predicts `0x75` for `0x1b` over `0x67`. The one-value difference is accepted because real backgrounds also affect the observed pixel.

Synthetic atlas rendering uses the same approximation so decoder tests exercise overlapping templates.

## Current decoder behavior

The local reranker remains context-free and examines only the logical columns of the candidate at the current position. It does not directly use a candidate's trailing overhang.

Beam decoding carries the last glyph as sequence state. When the following glyph becomes known, the decoder:

1. Builds a baseline from the following glyph's leading logical pixels.
2. Blends the previous glyph's overhang into those pixels.
3. Measures the squared-error improvement of the composite over the baseline.
4. Adds the normalized improvement to the beam score.

The same boundary adjustment is applied between glyphs inside compiled tokens and between the preceding beam and the first token glyph. At a true line end, the final glyph's overhang is scored against blank trailing text. A terminating token is given this final adjustment only when it also ends at the configured line boundary.

Overhang evidence is enabled by default. Callers can restore the previous scoring behavior with:

```ts
decodeLine(atlas, line, {
  startX,
  useOverhangEvidence: false,
});
```

The CLI equivalent is:

```bash
npm run glyph:benchmark -- --no-overhang-evidence
```

On the current 192-slice benchmark, both modes decode 192/192 entries. Enabling overhang changes the mean beam score from `1.784628` to `1.784899`, a mean increase of `0.000271`; it does not yet change corpus accuracy.

## Limitation

The evidence belongs to the previous glyph, but it becomes observable only after the next boundary is known. The current decoder initially ranks and expands the previous glyph using logical pixels alone. `branchLimit` or beam pruning can therefore discard the correct previous candidate before its overhang receives a score.

The current implementation can improve the cumulative score of a surviving path, but it does not revise the previous decision's displayed local margin. The context-free next-glyph reranker also does not explain inherited overhang while comparing its candidates.

## Future work

- Introduce one-glyph delayed pruning or pairwise lookahead. Enumerate `(previous, next)` candidate transitions, score their composite boundary, and prune only after the previous glyph's overhang has been evaluated.
- Finalize the previous decision and its margin from the transition score so diagnostics show where overhang changed the result.
- Condition next-glyph reranking on the surviving previous glyph, comparing candidates against `blend(previous overhang, current logical pixels)` rather than the current template alone.
- Re-run the real-slice benchmark and targeted ambiguity corpus to determine whether the added lookahead improves accuracy enough to justify its runtime cost.
- If future source fixtures exhibit left overhang, extend the atlas representation and decoder state instead of silently cropping it.
