import { BUFF_ITEM_NAMES } from "../buff-items";
import type { GlyphAtlas } from "./atlas";
import { compileDecodeToken, decodeLine, type DecodeDecision, type DecodeResult, type DecodeToken } from "./decoder";
import type { LineAnchors } from "./preprocess";

const USED_TOKEN_TEXT = " used ";

type CompiledBuffTokens = {
  usedToken: DecodeToken;
  itemTokens: DecodeToken[];
};

const defaultTokenCache = new WeakMap<GlyphAtlas, CompiledBuffTokens>();

export type DecodeBuffMsgOptions = {
  startX: number;
  endX?: number;
  itemNames?: readonly string[];
};

export function decodeBuffMsg(
  messageAtlas: GlyphAtlas,
  playerNameAtlas: GlyphAtlas,
  line: LineAnchors,
  options: DecodeBuffMsgOptions,
): DecodeResult {
  const defaultTokens = defaultTokensForAtlas(messageAtlas);
  const stage1 = decodeLine(playerNameAtlas, line, {
    startX: options.startX,
    endX: options.endX,
    tokenList: [defaultTokens.usedToken],
  });

  if (!terminatedWithToken(stage1, USED_TOKEN_TEXT)) return stage1;

  const itemTokens = options.itemNames ? compileCustomItemTokens(messageAtlas, options.itemNames) : defaultTokens.itemTokens;
  const stage2 = decodeLine(messageAtlas, line, {
    startX: stage1.x,
    endX: options.endX,
    tokenList: itemTokens,
  });

  return {
    text: stage1.text + stage2.text,
    x: stage2.x,
    score: stage1.score + stage2.score,
    decisions: [
      ...stage1.decisions,
      ...stage2.decisions.map((decision) => shiftDecisionStep(decision, stage1.decisions.length)),
    ],
  };
}

function defaultTokensForAtlas(atlas: GlyphAtlas): CompiledBuffTokens {
  const cached = defaultTokenCache.get(atlas);
  if (cached) return cached;

  const compiled = {
    usedToken: compileDecodeToken(atlas, USED_TOKEN_TEXT, { terminate: true }),
    itemTokens: compileDefaultItemTokens(atlas),
  };
  defaultTokenCache.set(atlas, compiled);
  return compiled;
}

function compileDefaultItemTokens(atlas: GlyphAtlas): DecodeToken[] {
  return BUFF_ITEM_NAMES.map((item) => compileDecodeToken(atlas, item, { acceptOnAnchorMatch: true }));
}

function compileCustomItemTokens(atlas: GlyphAtlas, itemNames: readonly string[]): DecodeToken[] {
  return itemNames
    .map((item) => compileDecodeToken(atlas, item, { acceptOnAnchorMatch: true }))
    .sort((a, b) => b.anchorKey.length - a.anchorKey.length);
}

function terminatedWithToken(result: DecodeResult, tokenText: string): boolean {
  const last = result.decisions.at(-1);
  return last?.kind === "token" && last.selected.token.terminate === true && last.selected.token.text === tokenText;
}

function shiftDecisionStep(decision: DecodeDecision, offset: number): DecodeDecision {
  return {
    ...decision,
    step: decision.step + offset,
  };
}
