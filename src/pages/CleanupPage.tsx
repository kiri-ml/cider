import { useMemo, useState } from "react";
import { Check, CircleAlert, PencilLine, RotateCcw, ScanLine } from "lucide-react";
import { Layout } from "../components/Layout";
import { RecordEditor } from "../components/RecordEditor";
import type { AuditRecord } from "../types";
import { focusLeftContainer } from "../lib/focus";
import { activeAcceptedSlices, isRecordComplete, isRecordEmpty, recordsInitialRecords, recordChanged, reviewRecords } from "../session/session";
import { resetRecordsOutput } from "../session/stageManagement";
import { useSession } from "../session/useSession";
import { countBy, secondsOfDay, timestampDisplay } from "../lib/records";

export function CleanupPage() {
  const { session, updateSession } = useSession();
  const [focusedPlayer, setFocusedPlayer] = useState<string | null>(null);
  const [focusedRecord, setFocusedRecord] = useState<string | null>(null);
  const [playerDrafts, setPlayerDrafts] = useState<Record<string, string>>({});
  if (!session) return null;

  const records = useMemo(() => reviewRecords(session), [session]);
  const baseById = useMemo(() => new Map(recordsInitialRecords(session).map((record) => [record.id, record])), [session]);
  const sliceById = useMemo(() => new Map(activeAcceptedSlices(session).map((slice) => [slice.id, slice])), [session]);
  const playerRows = countBy(records, (record) => record.player);
  const filteredRecords = useMemo(() => {
    if (!focusedPlayer) return [];
    return records
      .filter((record) => record.player === focusedPlayer)
      .sort((a, b) => secondsOfDay(a.timestamp) - secondsOfDay(b.timestamp) || a.id.localeCompare(b.id));
  }, [focusedPlayer, records]);
  const playerSuggestions = useMemo(() => {
    return [...new Set(records.map((record) => record.player.trim()).filter(Boolean))].sort();
  }, [records]);

  function updatePlayerDraft(player: string, value: string) {
    setPlayerDrafts((drafts) => ({ ...drafts, [player]: value }));
  }

  async function commitPlayerRename(player: string) {
    const draft = playerDrafts[player];
    if (draft === undefined) return;
    const nextPlayer = draft.trim();
    setPlayerDrafts((drafts) => {
      const next = { ...drafts };
      delete next[player];
      return next;
    });
    if (!nextPlayer || nextPlayer === player) return;

    await updateSession((current) => {
      const currentRecords = reviewRecords(current);
      const initialById = new Map(recordsInitialRecords(current).map((record) => [record.id, record]));
      const nextEdits = { ...current.recordEdits };
      const nextDrafts = { ...current.recordDrafts };
      let changed = false;

      for (const record of currentRecords) {
        if (record.player !== player) continue;
        const initial = initialById.get(record.id);
        if (!initial) continue;
        const renamed = { ...record, player: nextPlayer };
        if (recordChanged(initial, renamed)) {
          nextEdits[record.id] = renamed;
        } else {
          delete nextEdits[record.id];
        }
        if (nextDrafts[record.id]) {
          nextDrafts[record.id] = { ...nextDrafts[record.id], player: nextPlayer };
        }
        changed = true;
      }

      return changed ? { ...current, recordEdits: nextEdits, recordDrafts: nextDrafts } : current;
    });
    setFocusedPlayer((current) => current === player ? nextPlayer : current);
  }

  function togglePlayerFilter(player: string) {
    setFocusedPlayer((current) => current === player ? null : player);
  }

  async function resetRecords() {
    if (!window.confirm("Reset records and discard your edits?")) return;
    setFocusedPlayer(null);
    setFocusedRecord(null);
    setPlayerDrafts({});
    await updateSession((current) => resetRecordsOutput(current));
  }

  async function commitRecord(recordId: string) {
    await updateSession((current) => {
      const draft = current.recordDrafts[recordId];
      if (!draft) return current;
      const base = recordsInitialRecords(current).find((record) => record.id === recordId);
      if (!base) return current;
      const nextDrafts = { ...current.recordDrafts };
      if (isRecordComplete(draft)) {
        delete nextDrafts[recordId];
        const nextEdits = { ...current.recordEdits };
        if (recordChanged(base, draft)) nextEdits[recordId] = draft; else delete nextEdits[recordId];
        return { ...current, recordEdits: nextEdits, recordDrafts: nextDrafts };
      }
      if (isRecordEmpty(draft)) {
        delete nextDrafts[recordId];
        return { ...current, recordDrafts: nextDrafts };
      }
      return current;
    });
  }

  async function updateRecordDraft(recordId: string, draft: AuditRecord) {
    await updateSession((current) => {
      const base = recordsInitialRecords(current).find((record) => record.id === recordId);
      if (!base) return current;
      const nextDrafts = { ...current.recordDrafts, [recordId]: draft };
      if (isRecordEmpty(draft)) {
        delete nextDrafts[recordId];
        return { ...current, recordDrafts: nextDrafts };
      }
      return { ...current, recordDrafts: nextDrafts };
    });
  }

  function focusRecord(record: AuditRecord) {
    if (focusedRecord && focusedRecord !== record.id) void commitRecord(focusedRecord);
    setFocusedRecord(record.id);
    void updateSession((current) => current.recordDrafts[record.id] ? current : { ...current, recordDrafts: { ...current.recordDrafts, [record.id]: current.recordEdits[record.id] ?? record } });
  }

  function toggleRecord(record: AuditRecord) {
    if (focusedRecord === record.id) {
      void commitRecord(record.id);
      setFocusedRecord(null);
      return;
    }
    focusRecord(record);
  }

  function togglePlayerFilterFromKey(event: React.KeyboardEvent, player: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePlayerFilter(player);
  }

  function toggleRecordFromKey(event: React.KeyboardEvent, record: AuditRecord) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleRecord(record);
  }

  return <Layout title="Cleanup" description="Check each player’s logs. Fix names, items, or times as needed. Duplicates are handled later." stage="cleanup" contentClassName="cleanup-stage">
    <div className="cleanup-workspace">
      <aside className="cleanup-sidebar" aria-label="Players to clean up">
        <div className="cleanup-pane-header">
          <div>
            <h2>Players</h2>
            <p className="cleanup-pane-kicker">{records.length} logs</p>
          </div>
          <button className="secondary reset-button cleanup-reset-button" type="button" onClick={() => void resetRecords()}><RotateCcw aria-hidden="true" size={17} />Reset</button>
        </div>
        <div className="filter-list cleanup-player-list">{playerRows.map(([player, count]) => {
          return <article key={player} className={`filter-card cleanup-player-card ${focusedPlayer === player ? "focused" : ""}`} role="button" tabIndex={0} onClick={() => togglePlayerFilter(player)} onKeyDown={(event) => togglePlayerFilterFromKey(event, player)} onBlurCapture={(event) => { if (focusLeftContainer(event)) void commitPlayerRename(player); }}>
            <div className="filter-title cleanup-player-title">
              <PencilLine className="cleanup-player-icon" aria-hidden="true" size={15} />
              <input value={playerDrafts[player] ?? player} aria-label={`Player name for ${player}`} onFocus={() => setFocusedPlayer(player)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => updatePlayerDraft(player, event.target.value)} />
              <span className="cleanup-count-badge">{count}</span>
            </div>
          </article>;
        })}</div>
      </aside>
      <section className="cleanup-editor-pane" aria-label="Logs to clean up">
        <div className="cleanup-pane-header">
          <div>
            <h2>Logs to clean up</h2>
            <p className="cleanup-pane-kicker">{focusedPlayer ? focusedPlayer : "Choose a player"}</p>
          </div>
          {focusedPlayer && <span className="cleanup-count-badge">{filteredRecords.length}</span>}
        </div>
        <div className="record-list cleanup-record-list">{filteredRecords.map((record) => {
          const base = baseById.get(record.id) ?? record;
          const draft = session.recordDrafts[record.id];
          const partial = draft && !isRecordEmpty(draft) && !isRecordComplete(draft);
          const edited = recordChanged(base, record);
          const slice = sliceById.get(record.sourceSliceId);
          return <article key={record.id} className={`record-card cleanup-record-card ${edited ? "success" : ""} ${partial ? "warning" : ""} ${focusedRecord === record.id ? "expanded" : ""}`} role="button" tabIndex={0} onClick={() => toggleRecord(record)} onKeyDown={(event) => toggleRecordFromKey(event, record)}>
            <div className="cleanup-record-main">
              <div className="cleanup-record-summary">
                <span className="timestamp-pill">{timestampDisplay(record.timestamp)}</span>
                <span className="cleanup-record-text"><strong>{record.player}</strong><span>{record.item}</span></span>
                <span className={`cleanup-status-chip ${partial ? "warning" : edited ? "success" : ""}`}>{partial ? <CircleAlert aria-hidden="true" size={14} /> : edited ? <Check aria-hidden="true" size={14} /> : <PencilLine aria-hidden="true" size={14} />}{partial ? "Draft" : edited ? "Edited" : "Edit"}</span>
              </div>
              {slice?.url && <div className="cleanup-source-strip"><ScanLine aria-hidden="true" size={15} /><img src={slice.url} alt={`${slice.imageFileName} line ${slice.index}`} width={slice.width} height={slice.height} loading="eager" decoding="sync" /></div>}
            </div>
            {focusedRecord === record.id && draft && <div className="inline-editor cleanup-inline-editor card-details" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onBlurCapture={(event) => { if (focusLeftContainer(event)) void commitRecord(record.id); }}><RecordEditor record={draft} playerSuggestions={playerSuggestions} onChange={(next) => void updateRecordDraft(record.id, next)} /></div>}
          </article>;
        })}</div>
        {filteredRecords.length === 0 && <p className="empty cleanup-empty">{focusedPlayer ? "No logs found." : "Select a player to view their logs, then select a log to edit it."}</p>}
      </section>
    </div>
  </Layout>;
}
