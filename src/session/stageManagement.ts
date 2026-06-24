import { deduplicateRecords, sortRecordsWithMidnightWrap } from "../lib/records";
import type { AuditRecord, Session, StageId } from "../types";
import { activeImportOcrResults, acceptedImages, backendRejectedResults, baseRecords, finalRecords, recordsInitialRecords, stageIndex, stages } from "./session";
import { buildSlicesAndRunOcr, garbageCollectInactiveImportImages } from "./pipeline";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export async function enterStage(session: Session, targetStage: StageId): Promise<Session> {
  const targetIndex = stageIndex(targetStage);
  if (targetIndex < 0) return session;

  let next = session;
  if (targetIndex > stageIndex("import")) {
    next = await garbageCollectInactiveImportImages(next);
    next = await buildSlicesAndRunOcr(next);
    for (const stage of stages.slice(0, targetIndex + 1)) {
      next = await refreshStage(next, stage.id);
    }
  }

  return stageIndex(targetStage) <= stageIndex(next.currentStage) ? next : { ...next, currentStage: targetStage };
}

async function refreshStage(session: Session, stage: StageId): Promise<Session> {
  const withPreviousOutput = rememberPreviousOutput(session, stage);
  const initial = deriveInitial(stage, withPreviousOutput);
  const hash = stableHash(initial);
  if (withPreviousOutput.stageInitialHashes[stage] === hash) return withPreviousOutput;

  const withHash = {
    ...withPreviousOutput,
    stageInitialHashes: { ...withPreviousOutput.stageInitialHashes, [stage]: hash },
  };

  let refreshed: Session;
  switch (stage) {
    case "import":
      refreshed = withHash;
      break;
    case "issues":
      refreshed = { ...withHash, manualRecords: [], manualDrafts: {} };
      break;
    case "cleanup":
      refreshed = resetRecordsOutput(withHash);
      break;
    case "results":
      refreshed = { ...withHash, resultsRecords: resultsOutput(withPreviousOutput) };
      break;
    case "export":
      refreshed = withHash;
      break;
  }

  return {
    ...refreshed,
    stageOutputHashes: { ...refreshed.stageOutputHashes, [stage]: fingerprintStageOutput(stage, refreshed) },
  };
}

function rememberPreviousOutput(session: Session, stage: StageId): Session {
  const index = stageIndex(stage);
  if (index <= 0) return session;
  const previousStage = stages[index - 1].id;
  return {
    ...session,
    stageOutputHashes: {
      ...session.stageOutputHashes,
      [previousStage]: fingerprintStageOutput(previousStage, session),
    },
  };
}

export function reachableStageIndex(session: Session): number {
  const maxVisited = stageIndex(session.currentStage);
  if (maxVisited < 0) return 0;
  const lastStage = stages.length - 1;

  for (let index = 0; index <= maxVisited; index += 1) {
    const stage = stages[index].id;
    const savedOutput = session.stageOutputHashes[stage];
    if (savedOutput && savedOutput !== fingerprintStageOutput(stage, session)) return Math.min(index + 1, lastStage);

    const nextStage = stages[index + 1]?.id;
    const savedNextInitial = nextStage ? session.stageInitialHashes[nextStage] : undefined;
    if (nextStage && savedNextInitial && savedNextInitial !== stableHash(deriveInitial(nextStage, session))) return index + 1;
  }

  return Math.min(maxVisited + 1, lastStage);
}

export function fingerprintStageOutput(stage: StageId, session: Session): string {
  return stableHash(deriveOutput(stage, session));
}

function deriveOutput(stage: StageId, session: Session): JsonValue {
  switch (stage) {
    case "import": {
      return {
        recognitionMode: session.importSettings?.recognitionMode ?? "balanced",
        ocrResults: activeImportOcrResults(session).map((result) => ({
          sliceId: result.sliceId,
          recognitionMode: result.recognitionMode ?? "",
          status: result.status,
          rejectionReason: result.rejectionReason ?? "",
          record: result.record ? normalizeRecord(result.record) : null,
        })).sort((a, b) => a.sliceId.localeCompare(b.sliceId)),
      };
    }
    case "issues":
      return normalizeRecords(baseRecords(session));
    case "cleanup":
      return normalizeRecords(finalRecords(session));
    case "results":
      return normalizeRecordList(session.resultsRecords);
    case "export":
      return {
        exportFormat: session.exportFormat,
        effectiveAppleMode: session.effectiveAppleMode ?? "cutoff",
      };
  }
}

function deriveInitial(stage: StageId, session: Session): JsonValue {
  switch (stage) {
    case "import": {
      return acceptedImages(session.images).map((image) => image.checksumSha256 ?? "").filter(Boolean).sort();
    }
    case "issues":
      return backendRejectedResults(activeImportOcrResults(session)).map((result) => ({
        sliceId: result.sliceId,
        status: result.status,
        rejectionReason: result.rejectionReason ?? "",
      }));
    case "cleanup":
      return normalizeRecords(recordsInitialRecords(session));
    case "results":
      return normalizeRecords(finalRecords(session));
    case "export":
      return normalizeRecords(session.resultsRecords);
  }
}

export function resetRecordsOutput(session: Session): Session {
  return { ...session, recordEdits: {}, recordDrafts: {}, deletedRecordIds: [] };
}

export function resultsOutput(session: Session): AuditRecord[] {
  return sortRecordsWithMidnightWrap(deduplicateRecords(finalRecords(session)));
}

function normalizeRecords(records: AuditRecord[]): JsonValue {
  return records
    .map(normalizeRecord)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeRecordList(records: AuditRecord[]): JsonValue {
  return records.map(normalizeRecord);
}

function normalizeRecord(record: AuditRecord) {
  return {
    id: record.id,
    sourceSliceId: record.sourceSliceId,
    timestamp: record.timestamp,
    player: record.player,
    item: record.item,
    source: record.source,
  };
}

function stableHash(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)]));
}
