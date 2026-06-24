import type { AuditRecord, EffectiveAppleMode, ExportFormat, SliceAsset } from "../types";
import { formatEffectiveApples, itemWatt, summarizePlayers } from "./effectiveApples";
import { deduplicateRecords, timestampDisplay } from "./records";

export function exportFileName(format: ExportFormat, createdAt: string): string {
  const ext = format === "json" ? "json" : format === "csv" ? "csv" : "txt";
  const suffix = format === "discord" ? "-discord" : "";
  return `cider-${fileTimestamp(new Date(createdAt))}${suffix}.${ext}`;
}

export function exportMime(format: ExportFormat): string {
  if (format === "json") return "application/json";
  if (format === "csv") return "text/csv";
  return "text/plain";
}

export function serializeRecords(records: AuditRecord[], format: ExportFormat, slices: SliceAsset[] = [], effectiveAppleMode: EffectiveAppleMode = "cutoff"): string {
  if (format === "json") return toJson(records, slices);
  if (format === "csv") return toCsv(records, slices);
  if (format === "discord") return serializeDiscordMessages(records, effectiveAppleMode).join("\n\n");
  return toPlain(records, effectiveAppleMode);
}

export function serializeDiscordMessages(records: AuditRecord[], effectiveAppleMode: EffectiveAppleMode = "cutoff"): string[] {
  if (records.length === 0) return ["No buff logs found."];
  const playerRecordGroups = playerGroups(records);
  const effectiveByPlayer = effectivePlayerLookup(records, effectiveAppleMode);
  const uniqueRecords = deduplicateRecords(records);
  const playerBlocks = playerRecordGroups.map((group) => [
    `### ${playerSummaryLabel(group, effectiveByPlayer)}`,
    ...group.records.map((record) => `\`${timestampDisplay(record.timestamp)}\` ${record.item}`),
  ].join("\n"));
  const summaryMessage = [
    "# [CIDER Buff Log Summary](https://cider.pages.dev)",
    `-# ${playerRecordGroups.length} ${playersLabel(playerRecordGroups.length)} · ${uniqueRecords.length} items used`,
    "### Items used",
    "```text",
    itemTable(uniqueRecords),
    "```",
    "### Effective Apples",
    `-# ${effectiveAppleModeDescription(effectiveAppleMode)}; overlaps removed`,
    "```text",
    effectiveApplesTable(records, effectiveAppleMode),
    "```",
  ].join("\n");
  return [summaryMessage, ...discordPlayerMessages(playerBlocks)];
}

function toCsv(records: AuditRecord[], slices: SliceAsset[]): string {
  const sliceById = sliceLookup(slices);
  const rows = [["time", "player", "item", "source", "line from bottom"], ...records.map((record) => {
    const slice = sliceForRecord(record, sliceById);
    return [timestampDisplay(record.timestamp), record.player, record.item, sourceForSlice(slice), lineForSlice(slice)?.toString() ?? ""];
  })];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function toJson(records: AuditRecord[], slices: SliceAsset[]): string {
  const sliceById = sliceLookup(slices);
  return JSON.stringify({
    schema: 1,
    records: records.map((record) => {
      const slice = sliceForRecord(record, sliceById);
      return {
        timestamp: record.timestamp,
        player: record.player,
        item: record.item,
        source: sourceForSlice(slice),
        lineFromBottom: lineForSlice(slice),
      };
    }),
  }, null, 2);
}

function toPlain(records: AuditRecord[], effectiveAppleMode: EffectiveAppleMode): string {
  if (records.length === 0) return "No buff logs found.";
  const groups = playerGroups(records);
  const effectiveByPlayer = effectivePlayerLookup(records, effectiveAppleMode);
  const uniqueRecords = deduplicateRecords(records);
  const details = groups.map((group) => [
    playerSummaryLabel(group, effectiveByPlayer),
    ...group.records.map((record) => `${timestampDisplay(record.timestamp)} ${record.item}`),
  ].join("\n"));
  return [
    "CIDER Buff Log Summary",
    `${groups.length} ${playersLabel(groups.length)} · ${uniqueRecords.length} items used`,
    "",
    "Items used",
    itemTable(uniqueRecords),
    "",
    `Effective Apples (${effectiveAppleModeLabel(effectiveAppleMode)})`,
    effectiveApplesTable(records, effectiveAppleMode),
    "",
    details.join("\n\n"),
  ].join("\n");
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function sliceLookup(slices: SliceAsset[]): Map<SliceAsset["id"], SliceAsset> {
  return new Map(slices.map((slice) => [slice.id, slice]));
}

function sliceForRecord(record: AuditRecord, sliceById: Map<SliceAsset["id"], SliceAsset>): SliceAsset | undefined {
  return sliceById.get(record.sourceSliceId);
}

function sourceForSlice(slice: SliceAsset | undefined): string {
  return slice?.imageFileName ?? "unknown.png";
}

function lineForSlice(slice: SliceAsset | undefined): number | null {
  return slice?.displayId ?? null;
}

function fileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("-");
}

type PlayerGroup = {
  player: string;
  records: AuditRecord[];
};

const DISCORD_MESSAGE_LIMIT = 2000;

function playerGroups(records: AuditRecord[]): PlayerGroup[] {
  const groups = new Map<string, AuditRecord[]>();
  for (const record of records) {
    const group = groups.get(record.player);
    if (group) group.push(record);
    else groups.set(record.player, [record]);
  }
  return [...groups.entries()]
    .map(([player, groupRecords]) => ({ player, records: groupRecords }))
    .sort((a, b) => a.player.localeCompare(b.player, undefined, { sensitivity: "base" }) || a.player.localeCompare(b.player));
}

function itemTotals(records: AuditRecord[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.item, (counts.get(record.item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }) || a[0].localeCompare(b[0]));
}

function itemTable(records: AuditRecord[]): string {
  const totals = itemTotals(records);
  if (totals.length === 0) return "None  0";
  const itemNameWidth = Math.max(...totals.map(([item]) => item.length));
  const itemCountWidth = Math.max(...totals.map(([, count]) => String(count).length));
  return totals.map(([item, count]) => `${item.padEnd(itemNameWidth)}  ${String(count).padStart(itemCountWidth)}`).join("\n");
}

function discordPlayerMessages(playerBlocks: string[]): string[] {
  const messages: string[] = [];
  let current = "";
  for (const block of playerBlocks) {
    if (block.length > DISCORD_MESSAGE_LIMIT) {
      if (current) {
        messages.push(current);
        current = "";
      }
      messages.push(...splitLongDiscordPlayerBlock(block));
      continue;
    }
    const next = current ? `${current}\n${block}` : block;
    if (next.length <= DISCORD_MESSAGE_LIMIT) {
      current = next;
      continue;
    }
    if (current) messages.push(current);
    current = block;
  }
  if (current) messages.push(current);
  return messages;
}

function splitLongDiscordPlayerBlock(block: string): string[] {
  const [heading, ...lines] = block.split("\n");
  const messages: string[] = [];
  let current = heading;
  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length <= DISCORD_MESSAGE_LIMIT) {
      current = next;
      continue;
    }
    messages.push(current);
    current = `${heading}\n${line}`;
  }
  if (current) messages.push(current);
  return messages;
}

function effectiveApplesTable(records: AuditRecord[], effectiveAppleMode: EffectiveAppleMode): string {
  const rows = summarizePlayers(records, effectiveAppleMode).map((row) => ({
    player: row.player,
    uses: formatEffectiveUses(row.segments.map((segment) => segment.record)),
    effective: `(${formatEffectiveApples(row.effectiveApples)})`,
  }));
  const playerWidth = Math.max("Player".length, ...rows.map((row) => row.player.length));
  const usesWidth = Math.max("Uses".length, ...rows.map((row) => row.uses.length));
  const effectiveWidth = Math.max("Apples".length, ...rows.map((row) => row.effective.length));
  const header = [
    "Player".padEnd(playerWidth),
    "Uses".padEnd(usesWidth),
    "Apples".padStart(effectiveWidth),
  ].join("  ");
  const separator = [
    "─".repeat(playerWidth),
    "─".repeat(usesWidth),
    "─".repeat(effectiveWidth),
  ].join("  ");
  return [
    header,
    separator,
    ...rows.map((row) => [
      row.player.padEnd(playerWidth),
      row.uses.padEnd(usesWidth),
      row.effective.padStart(effectiveWidth),
    ].join("  ")),
  ].join("\n");
}

function formatEffectiveUses(records: AuditRecord[]): string {
  const highAttackUses = records.filter((record) => itemWatt(record.item) >= 100).length;
  const otherUses = records.length - highAttackUses;
  if (otherUses === 0) return String(highAttackUses);
  return `${highAttackUses}+${otherUses}`;
}

function effectivePlayerLookup(records: AuditRecord[], effectiveAppleMode: EffectiveAppleMode): Map<string, string> {
  return new Map(summarizePlayers(records, effectiveAppleMode).map((row) => [row.player, formatEffectiveApples(row.effectiveApples)]));
}

function playerSummaryLabel(group: PlayerGroup, effectiveByPlayer: Map<string, string>): string {
  return `${group.player} · ${group.records.length} ${usesLabel(group.records.length)} (${effectiveByPlayer.get(group.player) ?? "0.00"})`;
}

function playersLabel(count: number): string {
  return count === 1 ? "player" : "players";
}

function usesLabel(count: number): string {
  return count === 1 ? "use" : "uses";
}

function effectiveAppleModeDescription(mode: EffectiveAppleMode): string {
  return mode === "scaled" ? "Scaled by attack above Cider" : "100+ attack only";
}

function effectiveAppleModeLabel(mode: EffectiveAppleMode): string {
  return mode === "scaled" ? "Scaled" : "Cutoff";
}
