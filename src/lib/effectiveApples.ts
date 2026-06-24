import { BUFF_ITEMS } from "../cider/buff-items";
import type { AuditRecord, EffectiveAppleMode } from "../types";
import { secondsOfDay, sortRecordsWithMidnightWrap, timestampDisplay } from "./records";

const EFFECTIVE_APPLE_WATT_THRESHOLD = 100;
const CIDER_WATT = 20;
const APPLE_WATT_DELTA = 80;
export const APPLE_DURATION_SECONDS = 600;

const ITEM_BY_NAME = new Map<string, (typeof BUFF_ITEMS)[number]>(BUFF_ITEMS.map((item) => [item.name, item]));

export type EffectiveAppleSegment = {
  record: AuditRecord;
  startSeconds: number;
  endSeconds: number;
  activeSeconds: number;
  fullSeconds: number;
  lostSeconds: number;
  weight: number;
  contribution: number;
  loggedValue: number;
};

export type EffectiveAppleSummary = {
  logs: number;
  effectiveApples: number;
  loggedValue: number;
  overlapLoss: number;
  boostSeconds: number;
  weightedLogs: number;
  unweightedLogs: number;
  segments: EffectiveAppleSegment[];
};

export type EffectivePlayerRow = EffectiveAppleSummary & {
  player: string;
  itemMix: string;
};

export function itemEffectiveAppleWeight(itemName: string, mode: EffectiveAppleMode = "cutoff"): number {
  const item = ITEM_BY_NAME.get(itemName);
  if (!item) return 0;
  if (mode === "scaled") return Math.max(0, (item.watt - CIDER_WATT) / APPLE_WATT_DELTA);
  return item.watt >= EFFECTIVE_APPLE_WATT_THRESHOLD ? 1 : 0;
}

export function itemDurationSeconds(itemName: string): number {
  return ITEM_BY_NAME.get(itemName)?.duration ?? 0;
}

export function itemWatt(itemName: string): number {
  return ITEM_BY_NAME.get(itemName)?.watt ?? 0;
}

export function itemOverwritesAttackBuff(itemName: string): boolean {
  return itemWatt(itemName) > 0 && itemDurationSeconds(itemName) > 0;
}

export function itemEffectiveAppleLabel(itemName: string, mode: EffectiveAppleMode = "cutoff"): string {
  const weight = itemEffectiveAppleWeight(itemName, mode);
  if (weight === 0) return "0×";
  return `${formatCompactNumber(weight)}×`;
}

export function summarizeEffectiveApples(records: AuditRecord[], mode: EffectiveAppleMode = "cutoff"): EffectiveAppleSummary {
  return summarizeSegments(buildSegments(records, mode));
}

export function summarizeEffectiveApplesForView(records: AuditRecord[], includeRecord: (record: AuditRecord) => boolean, mode: EffectiveAppleMode = "cutoff"): EffectiveAppleSummary {
  const segments = buildPlayerSegments(records, mode).filter((segment) => includeRecord(segment.record));
  return summarizeSegments(segments);
}

export function summarizePlayers(records: AuditRecord[], mode: EffectiveAppleMode = "cutoff"): EffectivePlayerRow[] {
  return playerGroups(records)
    .map(([player, group]) => ({
      player,
      itemMix: formatItemMix(group),
      ...summarizeEffectiveApples(group, mode),
    }))
    .sort(comparePlayerRows);
}

export function summarizePlayersForView(records: AuditRecord[], includeRecord: (record: AuditRecord) => boolean, mode: EffectiveAppleMode = "cutoff"): EffectivePlayerRow[] {
  return playerGroups(records)
    .map(([player, group]) => {
      const segments = buildSegments(group, mode).filter((segment) => includeRecord(segment.record));
      return {
        player,
        itemMix: formatItemMix(segments.map((segment) => segment.record)),
        ...summarizeSegments(segments),
      };
    })
    .sort(comparePlayerRows);
}

export function formatEffectiveApples(value: number): string {
  return value.toFixed(2);
}

export function formatAppleDelta(value: number): string {
  return value === 0 ? "0.00" : `-${formatEffectiveApples(value)}`;
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatSegmentRange(segment: EffectiveAppleSegment): string {
  return `${formatSecondsOfDay(segment.startSeconds)}–${formatSecondsOfDay(segment.endSeconds)}`;
}

function buildPlayerSegments(records: AuditRecord[], mode: EffectiveAppleMode): EffectiveAppleSegment[] {
  return playerGroups(records).flatMap(([, group]) => buildSegments(group, mode));
}

function buildSegments(records: AuditRecord[], mode: EffectiveAppleMode): EffectiveAppleSegment[] {
  const orderedRecords = sortRecordsWithMidnightWrap(records);
  const timeline = makeTimeline(orderedRecords);
  type DraftSegment = Omit<EffectiveAppleSegment, "activeSeconds" | "lostSeconds" | "contribution" | "loggedValue">;
  const drafts: DraftSegment[] = [];
  let activeAttackSegmentIndex: number | null = null;

  for (const point of timeline) {
    const duration = Math.max(0, itemDurationSeconds(point.record.item));
    const weight = itemEffectiveAppleWeight(point.record.item, mode);
    const fullEnd = point.seconds + duration;
    const overwritesAttackBuff = itemOverwritesAttackBuff(point.record.item);

    if (overwritesAttackBuff && activeAttackSegmentIndex !== null) {
      const activeSegment = drafts[activeAttackSegmentIndex];
      activeSegment.endSeconds = Math.min(activeSegment.endSeconds, point.seconds);
    }

    drafts.push({
      record: point.record,
      startSeconds: point.seconds,
      endSeconds: fullEnd,
      fullSeconds: duration,
      weight,
    });

    if (overwritesAttackBuff) activeAttackSegmentIndex = drafts.length - 1;
  }

  return drafts.map((draft) => {
    const activeSeconds = Math.max(0, Math.min(draft.endSeconds, draft.startSeconds + draft.fullSeconds) - draft.startSeconds);
    const lostSeconds = Math.max(0, draft.fullSeconds - activeSeconds);
    const contribution = secondsToApples(activeSeconds, draft.weight);
    const loggedValue = secondsToApples(draft.fullSeconds, draft.weight);

    return {
      ...draft,
      activeSeconds,
      lostSeconds,
      contribution,
      loggedValue,
    };
  });
}

function summarizeSegments(segments: EffectiveAppleSegment[]): EffectiveAppleSummary {
  const effectiveApples = segments.reduce((sum, segment) => sum + segment.contribution, 0);
  const loggedValue = segments.reduce((sum, segment) => sum + segment.loggedValue, 0);
  const overlapLoss = Math.max(0, loggedValue - effectiveApples);
  const boostSeconds = segments.reduce((sum, segment) => sum + (segment.weight > 0 ? segment.activeSeconds : 0), 0);
  const weightedLogs = segments.filter((segment) => segment.weight > 0 && segment.fullSeconds > 0).length;

  return {
    logs: segments.length,
    effectiveApples,
    loggedValue,
    overlapLoss,
    boostSeconds,
    weightedLogs,
    unweightedLogs: segments.length - weightedLogs,
    segments,
  };
}

function playerGroups(records: AuditRecord[]): [string, AuditRecord[]][] {
  const groups = new Map<string, AuditRecord[]>();
  for (const record of records) {
    const player = record.player.trim() || "Unknown";
    groups.set(player, [...(groups.get(player) ?? []), record]);
  }
  return [...groups.entries()];
}

function comparePlayerRows(a: EffectivePlayerRow, b: EffectivePlayerRow): number {
  return b.effectiveApples - a.effectiveApples || b.logs - a.logs || a.player.localeCompare(b.player, undefined, { sensitivity: "base" }) || a.player.localeCompare(b.player);
}

function secondsToApples(seconds: number, weight: number): number {
  return (seconds / APPLE_DURATION_SECONDS) * weight;
}

function makeTimeline(records: AuditRecord[]): { record: AuditRecord; seconds: number }[] {
  const timeline: { record: AuditRecord; seconds: number }[] = [];
  let dayOffset = 0;
  let previousSeconds: number | null = null;

  for (const record of records) {
    const seconds = secondsOfDay(record.timestamp);
    if (previousSeconds !== null && seconds < previousSeconds) dayOffset += 86400;
    timeline.push({ record, seconds: seconds + dayOffset });
    previousSeconds = seconds;
  }

  return timeline;
}

function formatItemMix(records: AuditRecord[]): string {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.item, (counts.get(record.item) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([item, count]) => `${item} ×${count}`)
    .join(", ");
}

function formatCompactNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatSecondsOfDay(totalSeconds: number): string {
  const normalized = ((Math.round(totalSeconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  return timestampDisplay(`[${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}]`);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
