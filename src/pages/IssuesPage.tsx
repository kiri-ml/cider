import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Layout } from "../components/Layout";
import { RecordEditor } from "../components/RecordEditor";
import { SliceCard } from "../components/SliceCard";
import type { AuditRecord } from "../types";
import { focusLeftContainer } from "../lib/focus";
import { activeAcceptedSlices, activeImportOcrResults, backendRejectedResults, baseRecords, isRecordComplete, isRecordEmpty } from "../session/session";
import { useSession } from "../session/useSession";

export function IssuesPage() {
  const { session, updateSession } = useSession();
  const [focused, setFocused] = useState<string | null>(null);
  if (!session) return null;
  const rejected = backendRejectedResults(activeImportOcrResults(session));
  const rejectedIds = new Set(rejected.map((r) => r.sliceId));
  const slices = activeAcceptedSlices(session).filter((slice) => rejectedIds.has(slice.id));
  const manualBySlice = new Map(session.manualRecords.map((record) => [record.sourceSliceId, record]));
  const suggestions = useMemo(() => [...new Set(baseRecords(session).map((r) => r.player).filter(Boolean))].sort(), [session]);

  async function commit(sliceId: string) {
    await updateSession((current) => {
      const draft = current.manualDrafts[sliceId];
      if (!draft) return current;
      const previous = current.manualRecords.find((record) => record.sourceSliceId === sliceId);
      const existing = current.manualRecords.filter((record) => record.sourceSliceId !== sliceId);
      const nextRecord = isRecordComplete(draft) ? draft : undefined;
      const manualRecords = nextRecord ? [...existing, nextRecord] : existing;
      const changed = !sameRecord(previous, nextRecord);
      return changed ? { ...current, manualRecords } : { ...current, manualRecords };
    });
  }

  async function updateDraft(sliceId: string, record: AuditRecord) {
    await updateSession((current) => {
      const existing = current.manualRecords.filter((item) => item.sourceSliceId !== sliceId);
      const manualRecords = isRecordComplete(record) ? [...existing, record] : existing;
      return { ...current, manualDrafts: { ...current.manualDrafts, [sliceId]: record }, manualRecords };
    });
  }

  function open(sliceId: string) {
    if (focused && focused !== sliceId) void commit(focused);
    setFocused(sliceId);
    void updateSession((current) => {
      if (current.manualDrafts[sliceId]) return current;
      const existing = current.manualRecords.find((record) => record.sourceSliceId === sliceId);
      const draft = existing ?? { id: `manual_${sliceId}`, sourceSliceId: sliceId as any, timestamp: "[::]", player: "", item: "", source: "manual" as const };
      return { ...current, manualDrafts: { ...current.manualDrafts, [sliceId]: draft } };
    });
  }

  function toggle(sliceId: string) {
    if (focused === sliceId) {
      void commit(sliceId);
      setFocused(null);
      return;
    }
    open(sliceId);
  }

  return <Layout title="Issues" description="Review anything that could not be read confidently. Add missed buff logs if needed." stage="issues">
    {slices.length === 0 ? <p className="empty">No issues found. You can continue to the next step.</p> : <div className="slice-list">{slices.map((slice) => {
      const draft = session.manualDrafts[slice.id];
      const committed = manualBySlice.get(slice.id);
      const partial = draft && !isRecordEmpty(draft) && !isRecordComplete(draft);
      const result = rejected.find((item) => item.sliceId === slice.id);
      const committedText = committed ? <><span className="timestamp-pill">{committed.timestamp.replace(/[\[\]]/g, "")}</span> {committed.player} used {committed.item}.</> : partial ? <span className="partial-ocr-warning"><TriangleAlert aria-hidden="true" size={16} />Partial edit is not saved.</span> : undefined;
      return <SliceCard key={slice.id} slice={slice} reason={result?.rejectionReason} expanded={focused === slice.id} success={!!committed} warning={!!partial} onClick={() => toggle(slice.id)} committedText={committedText} footer={focused === slice.id && draft ? <div className="inline-editor card-details" onBlurCapture={(event) => { if (focusLeftContainer(event)) void commit(slice.id); }}><RecordEditor record={draft} playerSuggestions={suggestions} onChange={(record) => void updateDraft(slice.id, record)} /></div> : undefined} />;
    })}</div>}
  </Layout>;
}

function sameRecord(a: AuditRecord | undefined, b: AuditRecord | undefined): boolean {
  return a?.timestamp === b?.timestamp && a?.player === b?.player && a?.item === b?.item;
}
