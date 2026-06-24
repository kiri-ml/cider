import { CYAN_B, CYAN_G, CYAN_R, GLYPH_HEIGHT } from "./constants";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

export type CyanEvidenceParams = {
  hTol: number;
  sMin: number;
  vMin: number;
  sGamma: number;
  vGamma: number;
};

export const DEFAULT_CYAN_EVIDENCE_PARAMS: CyanEvidenceParams = {
  hTol: 0.07,
  sMin: 0.03,
  vMin: 0.18,
  sGamma: 0.7,
  vGamma: 0.5,
};

/**
 * Cyan detector used only to reject text-like pixels from bg-alpha background
 * sampling. Keep this separate from DEFAULT_CYAN_EVIDENCE_PARAMS, which is tuned
 * for HSV reranking evidence. Background rejection should be more conservative:
 * it should skip strong text pixels, but not remove too many weak background
 * pixels from the local background estimate.
 */
export const BG_ALPHA_TEXT_REJECT_CYAN_PARAMS: CyanEvidenceParams = {
  hTol: 0.07,
  sMin: 0.30,
  vMin: 0.18,
  sGamma: 0.7,
  vGamma: 0.5,
};

/** Soft evidence model used by the reranker.
 *
 * - "hsv": precompute the old HSV cyan-likeness map in buildLineAnchors.
 * - "bg-alpha-fast": lazily estimate cyan alpha over the local background, using
 *   local mean background and a cheap linear residual penalty.
 * - "bg-alpha-accurate": lazily estimate cyan alpha over the local background,
 *   using local median background and a Gaussian residual penalty.
 */
export type SoftEvidenceMode = "hsv" | "bg-alpha-fast" | "bg-alpha-accurate";

/** Change this one constant to switch the production/default reranker evidence. */
export const DEFAULT_SOFT_EVIDENCE_MODE: SoftEvidenceMode = "bg-alpha-fast";

export type BackgroundAlphaEvidenceParams = {
  /** Horizontal local-background sampling radius, in pixels. */
  radiusX: number;
  /** Vertical local-background sampling radius, in pixels. */
  radiusY: number;
  /** Skip the center neighborhood so the queried text pixel does not pollute bg. */
  innerSkipX: number;
  innerSkipY: number;
  /** Minimum usable background samples before falling back to a wider search. */
  minSamples: number;
  /** Extra radius added when the first local window has too few samples. */
  fallbackExtraX: number;
  fallbackExtraY: number;
  /** Exclude neighboring pixels that look this text-like by cheap HSV evidence. */
  textRejectEvidence: number;
  /** Background estimator: mean is cheaper, median is more robust. */
  backgroundStat: "mean" | "median";
  /** Residual penalty: linear is cheaper, gaussian is smoother. */
  residualPenalty: "linear" | "gaussian";
  /** Linear residual cutoff, in RGB distance units. */
  residualMax: number;
  /** Gaussian residual sigma, in RGB distance units. */
  residualSigma: number;
  /** Final evidence gamma. Keep 1.0 unless you intentionally want to lift weak pixels. */
  gamma: number;
  /** Optional hue gate after bg-alpha projection. Usually false; residual already gates. */
  hueGate: boolean;
  hueGateTol: number;
};

export const BG_ALPHA_FAST_EVIDENCE_PARAMS: BackgroundAlphaEvidenceParams = {
  radiusX: 4,
  radiusY: 3,
  innerSkipX: 1,
  innerSkipY: 1,
  minSamples: 4,
  fallbackExtraX: 4,
  fallbackExtraY: 2,
  textRejectEvidence: 0.30,
  backgroundStat: "mean",
  residualPenalty: "linear",
  residualMax: 48,
  residualSigma: 45,
  gamma: 1.0,
  hueGate: true,
  // Loose hue gate for bg-alpha evidence. 0.10 rejects some real weak
  // antialias pixels; 0.20+ lets gray/green background fake h ascenders.
  hueGateTol: 0.15,
};

export const BG_ALPHA_ACCURATE_EVIDENCE_PARAMS: BackgroundAlphaEvidenceParams = {
  ...BG_ALPHA_FAST_EVIDENCE_PARAMS,
  backgroundStat: "median",
  residualPenalty: "gaussian",
  residualSigma: 45,
};

export type LineAnchors = {
  width: number;
  height: number;
  /** Exact #66ccff anchor columns as 12-bit integers. */
  columns: number[];
  /** One UTF-16 code unit per anchor column. */
  anchorString: string;
  /**
   * Precomputed evidence for HSV mode.
   *
   * Background-aware modes compute evidence lazily in evidenceAt(), so this array
   * is not the source of truth for those modes.
   */
  evidence: Float32Array;
  /** Inclusive/exclusive horizontal bbox around exact-cyan anchors, after pad. */
  evidenceX0: number;
  evidenceX1: number;
  /** Rightmost exact anchor column plus end pad. */
  estimatedEndX: number;
  /** Raw RGBA line image, used by lazy background-aware evidence. */
  imageData?: Uint8Array | Uint8ClampedArray;
  evidenceMode?: SoftEvidenceMode;
  bgAlphaParams?: BackgroundAlphaEvidenceParams;
  /** Lazy evidence cache for background-aware modes; -1 means not computed. */
  evidenceCache?: Float32Array;
};

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/** Convert RGB to HSV, all channels returned in [0,1]. */
export function rgbToHsv01(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }

  return {
    h,
    s: max === 0 ? 0 : d / max,
    v: max,
  };
}

function circularHueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 0.5) % 1.0) - 0.5);
}

const CYAN_HUE = rgbToHsv01(CYAN_R, CYAN_G, CYAN_B).h;

/** Compute soft cyan-likeness for one RGB pixel.
 *
 * Exact #66ccff pixels are hard anchors and receive evidence 1.0. Other pixels
 * receive graded evidence based on hue closeness, saturation, and value. The
 * output is only used to rerank exact-anchor-compatible candidates; it never
 * creates candidates by itself.
 */
export function cyanEvidencePixel(
  r: number,
  g: number,
  b: number,
  params: CyanEvidenceParams = DEFAULT_CYAN_EVIDENCE_PARAMS,
): number {
  if (r === CYAN_R && g === CYAN_G && b === CYAN_B) return 1.0;

  const hsv = rgbToHsv01(r, g, b);
  const dh = circularHueDistance(hsv.h, CYAN_HUE);
  const hScore = clamp01(1.0 - dh / params.hTol);
  const sScore = Math.pow(clamp01((hsv.s - params.sMin) / (1.0 - params.sMin)), params.sGamma);
  const vScore = Math.pow(clamp01((hsv.v - params.vMin) / (1.0 - params.vMin)), params.vGamma);
  return hScore * sScore * vScore;
}

function mergeBgAlphaParams(
  mode: SoftEvidenceMode,
  overrides: Partial<BackgroundAlphaEvidenceParams> | undefined,
): BackgroundAlphaEvidenceParams | undefined {
  if (mode === "hsv") return undefined;
  const base = mode === "bg-alpha-accurate" ? BG_ALPHA_ACCURATE_EVIDENCE_PARAMS : BG_ALPHA_FAST_EVIDENCE_PARAMS;
  return { ...base, ...overrides };
}

/** Convert a 12px-tall line image into exact anchor columns and evidence metadata.
 *
 * Runtime input is expected to be a line crop. Only the first 12 rows are used.
 * Each exact #66ccff column is packed into a 12-bit integer and then encoded as
 * one UTF-16 code unit. Because production line width is less than 550, direct
 * String.fromCharCode(...columns) is safe and avoids chunking.
 */
export function buildLineAnchors(
  image: RgbaImage,
  options: {
    bboxPad?: number;
    endPad?: number;
    /** HSV parameters. Supplying this without evidenceMode keeps legacy HSV mode. */
    params?: CyanEvidenceParams;
    evidenceMode?: SoftEvidenceMode;
    bgAlphaParams?: Partial<BackgroundAlphaEvidenceParams>;
  } = {},
): LineAnchors {
  if (image.height < GLYPH_HEIGHT) {
    throw new Error(`line image height ${image.height} is less than ${GLYPH_HEIGHT}`);
  }

  const bboxPad = options.bboxPad ?? 8;
  const endPad = options.endPad ?? 3;
  // Backward compatibility: callers that pass HSV params expect the old HSV map.
  const evidenceMode = options.evidenceMode ?? (options.params ? "hsv" : DEFAULT_SOFT_EVIDENCE_MODE);
  const params = options.params ?? DEFAULT_CYAN_EVIDENCE_PARAMS;
  const bgAlphaParams = mergeBgAlphaParams(evidenceMode, options.bgAlphaParams);
  const width = image.width;
  const columns = new Array<number>(width).fill(0);
  const evidence = new Float32Array(GLYPH_HEIGHT * width);
  const evidenceCache = evidenceMode === "hsv" ? undefined : new Float32Array(GLYPH_HEIGHT * width);
  if (evidenceCache) evidenceCache.fill(-1);

  let exactMinX = Number.POSITIVE_INFINITY;
  let exactMaxX = -1;

  for (let y = 0; y < GLYPH_HEIGHT; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];

      const isExact = r === CYAN_R && g === CYAN_G && b === CYAN_B;
      if (isExact) {
        columns[x] |= 1 << y;
        if (x < exactMinX) exactMinX = x;
        if (x > exactMaxX) exactMaxX = x;
      }

      if (evidenceMode === "hsv") {
        evidence[y * width + x] = cyanEvidencePixel(r, g, b, params);
      }
    }
  }

  let evidenceX0 = 0;
  let evidenceX1 = 0;
  let estimatedEndX = 0;

  if (exactMaxX >= 0) {
    evidenceX0 = Math.max(0, exactMinX - bboxPad);
    evidenceX1 = Math.min(width, exactMaxX + 1 + bboxPad);
    // TODO: Handle a final zero-anchor 3px glyph with atlas-aware soft-template matching.
    estimatedEndX = Math.min(width, exactMaxX + endPad);

    if (evidenceMode === "hsv") {
      for (let y = 0; y < GLYPH_HEIGHT; y++) {
        const row = y * width;
        for (let x = 0; x < evidenceX0; x++) evidence[row + x] = 0;
        for (let x = evidenceX1; x < width; x++) evidence[row + x] = 0;
      }
    }
  } else {
    evidence.fill(0);
  }

  return {
    width,
    height: GLYPH_HEIGHT,
    columns,
    anchorString: String.fromCharCode(...columns),
    evidence,
    evidenceX0,
    evidenceX1,
    estimatedEndX,
    imageData: image.data,
    evidenceMode,
    bgAlphaParams,
    evidenceCache,
  };
}

/** Evidence lookup used by reranking.
 *
 * This is intentionally lazy for background-aware modes because reranking only
 * needs evidence at candidate-diff pixels. Repeated pairwise comparisons of the
 * same pixel are cached.
 */
export function evidenceAt(line: LineAnchors, x: number, y: number): number {
  if (y < 0 || y >= GLYPH_HEIGHT || x < 0 || x >= line.width) return 0;
  if (line.estimatedEndX > 0 && (x < line.evidenceX0 || x >= line.evidenceX1)) return 0;

  const i = y * line.width + x;
  if ((line.evidenceMode ?? "hsv") === "hsv") return line.evidence[i] ?? 0;

  const cached = line.evidenceCache?.[i];
  if (cached !== undefined && cached >= 0) return cached;

  const value = backgroundAlphaEvidenceAt(line, x, y);
  if (!line.evidenceCache) return value;

  line.evidenceCache[i] = value;
  return line.evidenceCache[i];
}

function pixelOffset(line: LineAnchors, x: number, y: number): number {
  return (y * line.width + x) * 4;
}

function isExactCyanAt(line: LineAnchors, x: number, y: number): boolean {
  const data = line.imageData;
  if (!data) return false;
  const i = pixelOffset(line, x, y);
  return data[i] === CYAN_R && data[i + 1] === CYAN_G && data[i + 2] === CYAN_B;
}

function backgroundAlphaEvidenceAt(line: LineAnchors, x: number, y: number): number {
  const data = line.imageData;
  const params = line.bgAlphaParams;
  if (!data || !params) return line.evidence[y * line.width + x] ?? 0;

  const i = pixelOffset(line, x, y);
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (r === CYAN_R && g === CYAN_G && b === CYAN_B) return 1.0;

  const bg = estimateLocalBackground(line, x, y, params);
  const vr = CYAN_R - bg.r;
  const vg = CYAN_G - bg.g;
  const vb = CYAN_B - bg.b;
  const denom = vr * vr + vg * vg + vb * vb;
  if (denom <= 1e-9) return 0;

  const ur = r - bg.r;
  const ug = g - bg.g;
  const ub = b - bg.b;
  const alpha = clamp01((ur * vr + ug * vg + ub * vb) / denom);

  const er = bg.r + alpha * vr;
  const eg = bg.g + alpha * vg;
  const eb = bg.b + alpha * vb;
  const dr = r - er;
  const dg = g - eg;
  const db = b - eb;
  const residualSq = dr * dr + dg * dg + db * db;

  let penalty: number;
  if (params.residualPenalty === "gaussian") {
    const sigmaSq = params.residualSigma * params.residualSigma;
    penalty = sigmaSq <= 1e-9 ? 0 : Math.exp(-residualSq / (2 * sigmaSq));
  } else {
    const maxSq = params.residualMax * params.residualMax;
    penalty = maxSq <= 1e-9 ? 0 : clamp01(1 - residualSq / maxSq);
  }

  let gate = 1.0;
  if (params.hueGate) {
    const h = rgbToHsv01(r, g, b).h;
    gate = clamp01(1 - circularHueDistance(h, CYAN_HUE) / params.hueGateTol);
  }

  const evidence = clamp01(alpha * penalty * gate);
  return params.gamma === 1 ? evidence : Math.pow(evidence, params.gamma);
}

type BackgroundStats = { r: number; g: number; b: number };

function estimateLocalBackground(
  line: LineAnchors,
  x: number,
  y: number,
  params: BackgroundAlphaEvidenceParams,
): BackgroundStats {
  const first = collectBackgroundSamples(line, x, y, params, params.radiusX, params.radiusY);
  const samples = first.count >= params.minSamples
    ? first
    : collectBackgroundSamples(
      line,
      x,
      y,
      params,
      params.radiusX + params.fallbackExtraX,
      params.radiusY + params.fallbackExtraY,
    );

  if (samples.count === 0) {
    const data = line.imageData;
    if (!data) return { r: 0, g: 0, b: 0 };
    const i = pixelOffset(line, x, y);
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  }

  if (params.backgroundStat === "median") {
    return {
      r: median(samples.rs),
      g: median(samples.gs),
      b: median(samples.bs),
    };
  }

  return {
    r: samples.rSum / samples.count,
    g: samples.gSum / samples.count,
    b: samples.bSum / samples.count,
  };
}

type BackgroundSampleSet = {
  count: number;
  rSum: number;
  gSum: number;
  bSum: number;
  rs: number[];
  gs: number[];
  bs: number[];
};

function collectBackgroundSamples(
  line: LineAnchors,
  x: number,
  y: number,
  params: BackgroundAlphaEvidenceParams,
  radiusX: number,
  radiusY: number,
): BackgroundSampleSet {
  const out: BackgroundSampleSet = { count: 0, rSum: 0, gSum: 0, bSum: 0, rs: [], gs: [], bs: [] };
  const data = line.imageData;
  if (!data) return out;

  const x0 = Math.max(0, x - radiusX);
  const x1 = Math.min(line.width - 1, x + radiusX);
  const y0 = Math.max(0, y - radiusY);
  const y1 = Math.min(GLYPH_HEIGHT - 1, y + radiusY);

  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (Math.abs(xx - x) <= params.innerSkipX && Math.abs(yy - y) <= params.innerSkipY) continue;
      if (isExactCyanAt(line, xx, yy)) continue;

      const i = pixelOffset(line, xx, yy);
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (cyanEvidencePixel(r, g, b, BG_ALPHA_TEXT_REJECT_CYAN_PARAMS) > params.textRejectEvidence) continue;

      out.count += 1;
      out.rSum += r;
      out.gSum += g;
      out.bSum += b;
      if (params.backgroundStat === "median") {
        out.rs.push(r);
        out.gs.push(g);
        out.bs.push(b);
      }
    }
  }

  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
