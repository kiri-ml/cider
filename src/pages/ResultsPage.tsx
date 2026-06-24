import { useMemo, useState, type ReactNode } from "react";
import { Apple, Sword } from "lucide-react";
import { Layout } from "../components/Layout";
import { useSession } from "../session/useSession";
import { activeAcceptedSlices } from "../session/session";
import { countBy, timestampDisplay } from "../lib/records";
import {
  formatAppleDelta,
  formatDuration,
  formatEffectiveApples,
  formatSegmentRange,
  itemEffectiveAppleLabel,
  summarizeEffectiveApplesForView,
  summarizePlayers,
  summarizePlayersForView,
  type EffectiveAppleSegment,
  type EffectivePlayerRow,
} from "../lib/effectiveApples";
import type { AuditRecord, EffectiveAppleMode, SliceAsset } from "../types";

const EFFECTIVE_APPLE_MODES: { id: EffectiveAppleMode; label: string }[] = [
  { id: "cutoff", label: "Cutoff" },
  { id: "scaled", label: "Scaled" },
];

type FilterCardProps = {
  label: string;
  count: number;
  detail?: string;
  active: boolean;
  onToggle: () => void;
  onKeyToggle: (event: React.KeyboardEvent) => void;
};

type PlayerCardsProps = {
  rows: EffectivePlayerRow[];
  focusedPlayer: string | null;
  onTogglePlayer: (player: string) => void;
  onKeyToggle: (event: React.KeyboardEvent, toggle: () => void) => void;
};

type PlayerCardProps = {
  row: EffectivePlayerRow;
  active: boolean;
  onToggle: () => void;
  onKeyToggle: (event: React.KeyboardEvent) => void;
};

type ResultLogRowProps = {
  segment: EffectiveAppleSegment;
  mode: EffectiveAppleMode;
  slice?: SliceAsset;
};

type PlayerLogGroupProps = {
  row: EffectivePlayerRow;
  mode: EffectiveAppleMode;
  sliceById: Map<string, SliceAsset>;
};

export function ResultsPage() {
  const { session, updateSession } = useSession();
  const [focusedPlayer, setFocusedPlayer] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  if (!session) return null;
  const allRecords = session.resultsRecords;
  const effectiveAppleMode = session.effectiveAppleMode ?? "cutoff";
  const sliceById = useMemo(() => new Map(activeAcceptedSlices(session).map((slice) => [slice.id, slice])), [session]);
  const recordsForItemBreakdown = allRecords.filter((record) => !focusedPlayer || record.player === focusedPlayer);
  const allPlayerRows = useMemo(() => summarizePlayers(allRecords, effectiveAppleMode), [allRecords, effectiveAppleMode]);
  const playerRowsByName = useMemo(() => new Map(summarizePlayersForView(allRecords, (record) => selectedItems.length === 0 || selectedItems.includes(record.item), effectiveAppleMode).map((row) => [row.player, row])), [allRecords, selectedItems, effectiveAppleMode]);
  const allItemRows = countBy(allRecords, (record) => record.item);
  const itemCounts = new Map(countBy(recordsForItemBreakdown, (record) => record.item));
  const matchesFilters = (record: AuditRecord) => (!focusedPlayer || record.player === focusedPlayer) && (selectedItems.length === 0 || selectedItems.includes(record.item));
  const filtered = allRecords.filter(matchesFilters);
  const filteredSummary = summarizeEffectiveApplesForView(allRecords, matchesFilters, effectiveAppleMode);
  const rankedPlayerRows = useMemo(
    () => allPlayerRows
      .map((baseRow) => playerRowsByName.get(baseRow.player) ?? emptyPlayerRow(baseRow.player))
      .sort(compareResultRows),
    [allPlayerRows, playerRowsByName],
  );
  const logPlayerRows = useMemo(() => {
    return summarizePlayersForView(allRecords, matchesFilters, effectiveAppleMode).filter((row) => row.logs > 0);
  }, [allRecords, focusedPlayer, selectedItems, effectiveAppleMode]);
  const filteredPlayerCount = countBy(filtered, (record) => record.player).length;
  const filteredOverlapCount = filteredSummary.segments.filter((segment) => segment.lostSeconds > 0 && segment.weight > 0).length;
  const firstTime = filtered.length > 0 ? timestampDisplay(filtered[0].timestamp) : "0";
  const lastTime = filtered.length > 0 ? timestampDisplay(filtered[filtered.length - 1].timestamp) : "0";
  const filteredLogDetail = filtered.length > 0 ? `${filtered.length} of ${allRecords.length} logs · ${firstTime}–${lastTime}` : `${filtered.length} of ${allRecords.length} logs`;

  function toggleFromKey(event: React.KeyboardEvent, toggle: () => void) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  }

  function togglePlayer(player: string) {
    setFocusedPlayer((current) => current === player ? null : player);
  }

  function toggleItem(item: string) {
    setSelectedItems((current) => current.includes(item) ? current.filter((selected) => selected !== item) : [...current, item]);
  }

  function setEffectiveAppleMode(mode: EffectiveAppleMode) {
    void updateSession((current) => ({ ...current, effectiveAppleMode: mode }));
  }

  return <Layout title="Results" description="View effective apple usage, player totals, and the cleaned log evidence." stage="results">
    <div className="results-workspace">
      <section className="results-section results-players-section">
        <SectionHeader title="Players" detail={selectedItems.length > 0 ? `${selectedItems.length} item filters applied` : `${allPlayerRows.length} players`} />
        <PlayerCards rows={rankedPlayerRows} focusedPlayer={focusedPlayer} onTogglePlayer={togglePlayer} onKeyToggle={toggleFromKey} />
      </section>

      <section className="results-section results-items-section">
        <SectionHeader title="Items" detail={selectedItems.length > 0 ? `${selectedItems.length} selected` : `${allItemRows.length} items`} action={<EffectiveAppleModeToggle mode={effectiveAppleMode} onChange={setEffectiveAppleMode} />} />
        <div className="results-item-filter-list" aria-label="Item filters">
          {allItemRows.map(([item]) => <FilterCard key={item} label={item} count={itemCounts.get(item) ?? 0} detail={itemEffectiveAppleLabel(item, effectiveAppleMode)} active={selectedItems.includes(item)} onToggle={() => toggleItem(item)} onKeyToggle={(event) => toggleFromKey(event, () => toggleItem(item))} />)}
        </div>
      </section>
    </div>

    <section className="results-logs-section">
      <SectionHeader title="Logs" detail={filteredLogDetail} />
      <div className="results-summary" aria-label="Results summary">
        <ResultStat label="Effective" value={<AppleAmount value={formatEffectiveApples(filteredSummary.effectiveApples)} />} note="net value" emphasized />
        <ResultStat label="Raw Uses" value={<AppleAmount value={formatEffectiveApples(filteredSummary.loggedValue)} />} note={`${filtered.length} ${filtered.length === 1 ? "log entry" : "log entries"}`} />
        <ResultStat label="Overlap Loss" value={<AppleAmount value={formatAppleDelta(filteredSummary.overlapLoss)} />} note={`${filteredOverlapCount} ${filteredOverlapCount === 1 ? "overlap" : "overlaps"}`} />
        <ResultStat label="Boost Time" value={formatDuration(filteredSummary.boostSeconds)} note={`${filteredPlayerCount} ${filteredPlayerCount === 1 ? "player" : "players"}`} />
      </div>
      <div className="results-player-log-groups">
        {logPlayerRows.map((row) => <PlayerLogGroup key={row.player} row={row} mode={effectiveAppleMode} sliceById={sliceById} />)}
      </div>
      {filtered.length === 0 && <p className="empty results-empty">{allRecords.length === 0 ? "No cleaned logs are available yet." : "No logs match the active filters."}</p>}
    </section>
  </Layout>;
}

function ResultStat({ label, value, note, emphasized = false }: { label: string; value: ReactNode; note?: string; emphasized?: boolean }) {
  return <div className={`results-stat ${emphasized ? "emphasized" : ""}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </div>;
}

function EffectiveAppleModeToggle({ mode, onChange }: { mode: EffectiveAppleMode; onChange: (mode: EffectiveAppleMode) => void }) {
  return <div className="segmented-control results-mode-toggle" role="group" aria-label="Effective apple weighting mode">
    {EFFECTIVE_APPLE_MODES.map((item) => (
      <button
        key={item.id}
        type="button"
        className={mode === item.id ? "selected" : ""}
        aria-pressed={mode === item.id}
        onClick={() => onChange(item.id)}
      >
        {item.label}
      </button>
    ))}
  </div>;
}

function SectionHeader({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="results-section-header">
    <h2>{title}</h2>
    {action}
    <div className="results-section-header-meta">
      <span className="results-section-header-detail">{detail}</span>
    </div>
  </div>;
}

function PlayerCards({ rows, focusedPlayer, onTogglePlayer, onKeyToggle }: PlayerCardsProps) {
  return <div className="results-player-card-grid" aria-label="Effective apple ranking by player">
    {rows.map((row) => <PlayerCard key={row.player} row={row} active={focusedPlayer === row.player} onToggle={() => onTogglePlayer(row.player)} onKeyToggle={(event) => onKeyToggle(event, () => onTogglePlayer(row.player))} />)}
  </div>;
}

function PlayerCard({ row, active, onToggle, onKeyToggle }: PlayerCardProps) {
  return <article className={`results-player-card ${active ? "focused" : ""} ${row.logs === 0 ? "muted-result" : ""}`} role="button" tabIndex={0} onClick={onToggle} onKeyDown={onKeyToggle} aria-pressed={active}>
    <div className="results-player-card-head">
      <strong className="results-player-name">{row.player}</strong>
      <span className="results-player-card-count">{row.logs} {row.logs === 1 ? "use" : "uses"}</span>
    </div>
    <strong className="results-player-effective" aria-label={`${formatEffectiveApples(row.effectiveApples)} effective apples`}>
      <AppleAmount value={formatEffectiveApples(row.effectiveApples)} />
    </strong>
  </article>;
}

function FilterCard({ label, count, detail, active, onToggle, onKeyToggle }: FilterCardProps) {
  return <article className={`results-item-chip ${active ? "focused" : ""} ${count === 0 ? "muted-result" : ""}`} role="button" tabIndex={0} onClick={onToggle} onKeyDown={onKeyToggle} aria-pressed={active}>
    <div className="results-item-chip-title">
      <strong>{label}</strong>
      <span className="cleanup-count-badge">{count}</span>
    </div>
    {detail && <WeaponAttackAppleLabel label={detail} />}
  </article>;
}

function WeaponAttackAppleLabel({ label }: { label: string }) {
  const value = label.replace(/×$/, "");

  return <span className="results-item-chip-detail" aria-label={`${label} weapon attack relative to apple`}>
    <span className="results-apple-amount">
      <span>{value}×</span>
      <Sword aria-hidden="true" size={15} strokeWidth={2.4} />
    </span>
  </span>;
}

function AppleAmount({ value }: { value: string }) {
  return <span className="results-apple-amount">
    <span>{value}</span>
    <Apple aria-hidden="true" size={13} strokeWidth={2.4} />
  </span>;
}

function PlayerLogGroup({ row, mode, sliceById }: PlayerLogGroupProps) {
  return <article className="results-player-log-group">
    <header className="results-player-log-header">
      <div className="results-player-log-heading">
        <h3>{row.player}</h3>
      </div>
      <strong className="results-player-effective-badge" aria-label={`${formatEffectiveApples(row.effectiveApples)} effective apples`}>
        <AppleAmount value={formatEffectiveApples(row.effectiveApples)} />
      </strong>
    </header>
    <div className="record-list readonly results-log-list compact">
      {row.segments.map((segment) => <ResultLogRow key={segment.record.id} segment={segment} mode={mode} slice={sliceById.get(segment.record.sourceSliceId)} />)}
    </div>
  </article>;
}

function ResultLogRow({ segment, mode, slice }: ResultLogRowProps) {
  const record = segment.record;
  const hasOverlap = segment.lostSeconds > 0 && segment.weight > 0;
  const multiplier = itemEffectiveAppleLabel(record.item, mode).replace(/×$/, "");

  return <article className={`record-card results-log-card ${hasOverlap ? "has-overlap" : ""}`}>
    <div className="results-log-row compact">
      <TimeRangePill segment={segment} hasOverlap={hasOverlap} />
      <div className="results-log-main">
        <span className="results-log-item">{record.item}</span>
        <span className="results-log-calculation" aria-label={`${formatLogDuration(segment.activeSeconds)} times ${multiplier} weapon attack relative to apple`}>
          <span className={`results-duration-chip ${hasOverlap ? "strong" : "muted"}`}>{formatLogDuration(segment.activeSeconds)}</span>
          <span>×</span>
          <span className="results-log-multiplier">
            <span>{multiplier}</span>
            <Sword aria-hidden="true" size={14} strokeWidth={2.4} />
          </span>
          <span>=</span>
        </span>
      </div>
      <div className="results-log-result" aria-label="Effective apples from this log">
        <AppleAmount value={formatEffectiveApples(segment.contribution)} />
      </div>
      {slice?.url && <div className="results-source-strip"><img src={slice.url} alt={`${slice.imageFileName} line ${slice.index}`} width={slice.width} height={slice.height} loading="eager" decoding="sync" /></div>}
    </div>
  </article>;
}

function TimeRangePill({ segment, hasOverlap }: { segment: EffectiveAppleSegment; hasOverlap: boolean }) {
  const [startTime, endTime] = formatSegmentRange(segment).split("–");

  return <span className={`timestamp-pill results-log-time ${hasOverlap ? "has-overlap" : ""}`} aria-label={`${startTime} to estimated ${endTime}`}>
    <span className="results-log-time-start">{startTime}</span>
    <span className="results-log-time-separator" aria-hidden="true">–</span>
    <span className="results-log-time-end" title="Estimated end time">{endTime}</span>
  </span>;
}

function emptyPlayerRow(player: string): EffectivePlayerRow {
  return {
    player,
    itemMix: "",
    logs: 0,
    effectiveApples: 0,
    loggedValue: 0,
    overlapLoss: 0,
    boostSeconds: 0,
    weightedLogs: 0,
    unweightedLogs: 0,
    segments: [],
  };
}

function compareResultRows(a: EffectivePlayerRow, b: EffectivePlayerRow): number {
  return b.effectiveApples - a.effectiveApples || b.logs - a.logs || a.player.localeCompare(b.player, undefined, { sensitivity: "base" }) || a.player.localeCompare(b.player);
}

function formatLogDuration(seconds: number): string {
  return formatDuration(seconds);
}
