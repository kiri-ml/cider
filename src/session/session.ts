import type { AcceptedImageAsset, AuditRecord, ImageAsset, ImportSettings, OcrResult, RejectedImageAsset, Session, SliceAsset, StageId } from "../types";
import { clearBlobs, getBlob } from "./indexedDb";

export const STORAGE_KEY = "cider-production-session-v1";
export const DEFAULT_IMPORT_SETTINGS: ImportSettings = { recognitionMode: "balanced" };

export const stages: { id: StageId; label: string; path: string }[] = [
  { id: "import", label: "Import", path: "/import" },
  { id: "issues", label: "Issues", path: "/issues" },
  { id: "cleanup", label: "Cleanup", path: "/cleanup" },
  { id: "results", label: "Results", path: "/results" },
  { id: "export", label: "Export", path: "/export" },
];

export function createNewSession(): Session {
  const now = new Date();
  return {
    id: `session_${now.getTime()}`,
    name: `CIDER Session - ${formatDateTime(now)}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    currentStage: "import",
    stageInitialHashes: {},
    stageOutputHashes: {},
    nextImageId: 1,
    images: [],
    slices: [],
    ocrResults: [],
    importSettings: { ...DEFAULT_IMPORT_SETTINGS },
    manualRecords: [],
    manualDrafts: {},
    recordEdits: {},
    recordDrafts: {},
    deletedRecordIds: [],
    resultsRecords: [],
    effectiveAppleMode: "cutoff",
    exportFormat: "plain",
  };
}

export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stripRuntime(session: Session): Session {
  const persistedImages = acceptedImageAssets(session.images);
  const persistedImageIds = new Set(persistedImages.map((image) => image.id));
  const persistedSliceIds = new Set(session.slices.filter((slice) => persistedImageIds.has(slice.imageId)).map((slice) => slice.id));
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    images: persistedImages.map(({ url: _url, ...image }) => image),
    slices: session.slices.filter((slice) => persistedImageIds.has(slice.imageId)).map(({ url: _url, ...slice }) => slice),
    ocrResults: session.ocrResults.filter((result) => persistedSliceIds.has(result.sliceId)),
  };
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stripRuntime(session)));
}

export function loadSessionMetadata(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session> & { ocrBatches?: unknown };
    const { ocrBatches: _ocrBatches, ...metadata } = parsed;
    return {
      ...createNewSession(),
      ...metadata,
      images: metadata.images ?? [],
      slices: metadata.slices ?? [],
      ocrResults: metadata.ocrResults ?? [],
      importSettings: { ...DEFAULT_IMPORT_SETTINGS, ...metadata.importSettings },
      manualRecords: metadata.manualRecords ?? [],
      manualDrafts: metadata.manualDrafts ?? {},
      recordEdits: metadata.recordEdits ?? {},
      recordDrafts: metadata.recordDrafts ?? {},
      deletedRecordIds: metadata.deletedRecordIds ?? [],
      stageInitialHashes: metadata.stageInitialHashes ?? {},
      stageOutputHashes: metadata.stageOutputHashes ?? {},
      resultsRecords: metadata.resultsRecords ?? [],
      effectiveAppleMode: metadata.effectiveAppleMode ?? "cutoff",
      exportFormat: metadata.exportFormat ?? "plain",
      nextImageId: metadata.nextImageId ?? 1,
      currentStage: metadata.currentStage ?? "import",
    };
  } catch {
    return null;
  }
}

export async function hydrateSessionUrls(session: Session): Promise<Session> {
  const imageEntries = await Promise.all(acceptedImageAssets(session.images).map(async (image) => {
    const key = image.thumbnailBlobKey;
    return [image.id, key ? await getBlob(key) : undefined] as const;
  }));
  const sliceEntries = await Promise.all(session.slices.map(async (slice) => [slice.id, await getBlob(slice.blobKey)] as const));
  const imageUrls = new Map(imageEntries.map(([id, blob]) => [id, blob ? URL.createObjectURL(blob) : undefined]));
  const sliceUrls = new Map(sliceEntries.map(([id, blob]) => [id, blob ? URL.createObjectURL(blob) : undefined]));
  return {
    ...session,
    images: session.images.map((image) => image.status === "accepted" ? { ...image, url: imageUrls.get(image.id) } : image),
    slices: session.slices.map((slice) => ({ ...slice, url: sliceUrls.get(slice.id) })),
  };
}

export function revokeSessionUrls(session: Session | null): void {
  if (!session) return;
  for (const image of session.images) if (image.url) URL.revokeObjectURL(image.url);
  for (const slice of session.slices) if (slice.url) URL.revokeObjectURL(slice.url);
}

export async function clearSession(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  await clearBlobs();
}

export function stageIndex(stageId: StageId): number {
  return stages.findIndex((stage) => stage.id === stageId);
}

export function furthestClickableStageIndex(session: Session): number {
  return Math.min(stageIndex(session.currentStage) + 1, stages.length - 1);
}

export function canClickStage(session: Session, targetStage: StageId): boolean {
  const targetIndex = stageIndex(targetStage);
  return targetIndex >= 0 && targetIndex <= furthestClickableStageIndex(session);
}

export function markStageVisited(session: Session, stage: StageId): Session {
  return stageIndex(stage) <= stageIndex(session.currentStage) ? session : { ...session, currentStage: stage };
}

export function acceptedImageAssets(images: ImageAsset[]): AcceptedImageAsset[] { return images.filter((image) => image.status === "accepted"); }
export function acceptedImages(images: ImageAsset[]): AcceptedImageAsset[] { return acceptedImageAssets(images).filter((image) => image.lifecycle === "active"); }
export function rejectedImages(images: ImageAsset[]): RejectedImageAsset[] { return images.filter((image) => image.status === "rejected"); }
export function activeAcceptedImageIds(session: Session): Set<number> { return new Set(acceptedImages(session.images).map((image) => image.id)); }
export function activeAcceptedSlices(session: Session): SliceAsset[] {
  const acceptedImageIds = activeAcceptedImageIds(session);
  return session.slices.filter((slice) => acceptedImageIds.has(slice.imageId) && slice.prefilterStatus === "accepted");
}
export function activeImportOcrResults(session: Session): OcrResult[] {
  const activeSliceIds = new Set(activeAcceptedSlices(session).map((slice) => slice.id));
  return session.ocrResults.filter((result) => result.status !== "failed" && activeSliceIds.has(result.sliceId));
}
export function frontendRejectedSlices(slices: SliceAsset[]): SliceAsset[] { return slices.filter((slice) => slice.prefilterStatus === "rejected"); }
export function frontendAcceptedSlices(slices: SliceAsset[]): SliceAsset[] { return slices.filter((slice) => slice.prefilterStatus === "accepted"); }
export function backendRejectedResults(results: OcrResult[]): OcrResult[] { return results.filter((result) => result.status === "rejected" || result.status === "failed"); }
export function acceptedOcrRecords(results: OcrResult[]): AuditRecord[] { return results.flatMap((result) => result.record ? [result.record] : []); }

export function canOpenStage(session: Session, stageId: StageId): boolean {
  if (stageId === "import") return true;
  return acceptedImages(session.images).length > 0 && activeAcceptedSlices(session).length > 0;
}

export function isTimestampComplete(timestamp: string): boolean {
  const match = timestamp.match(/^\[(\d{2}):(\d{2}):(\d{2})\]$/);
  if (!match) return false;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59;
}
export function isRecordComplete(record: AuditRecord): boolean { return isTimestampComplete(record.timestamp) && record.player.trim().length > 0 && record.item.trim().length > 0; }
export function isRecordEmpty(record: AuditRecord): boolean { return !/\d/.test(record.timestamp) && !record.player.trim() && !record.item.trim(); }

export function baseRecords(session: Session): AuditRecord[] {
  return [...acceptedOcrRecords(activeImportOcrResults(session)), ...session.manualRecords.filter(isRecordComplete)];
}

export function recordsInitialRecords(session: Session): AuditRecord[] {
  return baseRecords(session);
}

export function reviewRecords(session: Session): AuditRecord[] {
  const deleted = new Set(session.deletedRecordIds);
  return recordsInitialRecords(session)
    .map((record) => session.recordEdits[record.id] ?? record)
    .filter((record) => !deleted.has(record.id));
}

export function finalRecords(session: Session): AuditRecord[] {
  return reviewRecords(session);
}

export function recordChanged(a: AuditRecord, b: AuditRecord): boolean {
  return a.timestamp !== b.timestamp || a.player !== b.player || a.item !== b.item;
}

export function imageFileNameForSlice(session: Session, sliceId: string): string {
  return session.slices.find((slice) => slice.id === sliceId)?.imageFileName ?? "unknown.png";
}
export function sliceNumberForSlice(session: Session, sliceId: string): number | undefined {
  return session.slices.find((slice) => slice.id === sliceId)?.index;
}
