import type { AuditRecord } from "../types";

export function timestampDisplay(timestamp: string): string {
  const match = timestamp.match(/^\[(\d{2}:\d{2}:\d{2})\]$/);
  return match?.[1] ?? timestamp.replace(/[\[\]]/g, "");
}

export function secondsOfDay(timestamp: string): number {
  const match = timestamp.match(/(\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function sortRecordsWithMidnightWrap(records: AuditRecord[]): AuditRecord[] {
  if (records.length <= 1) return [...records];
  const sorted = [...records].sort((a, b) => secondsOfDay(a.timestamp) - secondsOfDay(b.timestamp));
  let maxGap = -1;
  let startIndex = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = secondsOfDay(sorted[i].timestamp);
    const nextIndex = (i + 1) % sorted.length;
    const next = secondsOfDay(sorted[nextIndex].timestamp) + (nextIndex === 0 ? 86400 : 0);
    const gap = next - current;
    if (gap > maxGap) {
      maxGap = gap;
      startIndex = nextIndex;
    }
  }
  return [...sorted.slice(startIndex), ...sorted.slice(0, startIndex)];
}

export function deduplicateRecords(records: AuditRecord[]): AuditRecord[] {
  const seen = new Set<string>();
  const unique: AuditRecord[] = [];
  for (const record of records) {
    const key = JSON.stringify([record.timestamp, record.player, record.item]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
}

export function countBy<T>(items: T[], keyFn: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item).trim() || "Unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function nestedCounts(records: AuditRecord[], outer: keyof Pick<AuditRecord, "player" | "item">, inner: keyof Pick<AuditRecord, "player" | "item">): Map<string, [string, number][]> {
  const groups = new Map<string, AuditRecord[]>();
  for (const record of records) {
    const key = String(record[outer]);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return new Map([...groups.entries()].map(([key, group]) => [key, countBy(group, (record) => String(record[inner]))]));
}
