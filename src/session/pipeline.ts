import {
  DEFAULT_LINE_COUNT,
  appleTimestampBracketPrefilter,
  canvasToPngBlob,
  closeBitmap,
  createCanvas,
  getCanvasContext,
  readFullImage,
  recognizeAppleOcrSlice,
  stripRuntimeImageFields,
  type AppleOcrOptions,
  type AppleOcrSliceInput,
  type LoadedFullImage,
  type Rect,
} from "../cider";
import type { AppleOcrResult } from "../cider";
import type { RgbaImage, SoftEvidenceMode } from "../cider/glyph-decoder/preprocess";
import type { AcceptedImageAsset, AuditRecord, ImageAsset, OcrResult, RecognitionMode, Session, SliceAsset, UserFacingRejectionReason } from "../types";
import { deleteBlob, getBlob, putBlob, putBlobs } from "./indexedDb";
import { acceptedImages, activeAcceptedSlices, baseRecords, isRecordComplete } from "./session";

type PendingSliceEncode = { key: string; canvas: ReturnType<typeof createCanvas> };
type PendingThumbnailWrite = { key: string; image: LoadedFullImage };
type PendingBlobWrite = { key: string; blob: Blob };
type CropAndPrefilterResult = {
  slices: SliceAsset[];
  encodes: PendingSliceEncode[];
};
type AddFileResult = {
  image?: ImageAsset;
  restored?: AcceptedImageAsset;
  slices: SliceAsset[];
  sliceEncodes: PendingSliceEncode[];
  thumbnailWrites: PendingThumbnailWrite[];
};

const IMPORT_IMAGE_CONCURRENCY = 4;

let pendingSliceWriteQueue: Promise<void> = Promise.resolve();
let pendingThumbnailWriteQueue: Promise<void> = Promise.resolve();
const completedSliceUrls = new Map<string, string>();
const sliceImageCache = new Map<SliceAsset["id"], RgbaImage>();
const sliceOcrPromises = new Map<string, Promise<OcrResult | null>>();

const RECOGNITION_EVIDENCE_MODES: Record<RecognitionMode, SoftEvidenceMode> = {
  fast: "hsv",
  balanced: "bg-alpha-fast",
  best: "bg-alpha-accurate",
};

function normalizeRect(rect: Rect): Rect {
  return { left: Math.trunc(rect.left), top: Math.trunc(rect.top), width: Math.max(1, Math.trunc(rect.width)), height: Math.max(1, Math.trunc(rect.height)) };
}

export async function addFilesToSession(
  session: Session,
  files: File[],
): Promise<Session> {
  let nextImageId = session.nextImageId;
  const images: ImageAsset[] = [...session.images];
  const slices: SliceAsset[] = [...session.slices];
  const sliceEncodes: PendingSliceEncode[] = [];
  const thumbnailWrites: PendingThumbnailWrite[] = [];
  const activeAcceptedByChecksum = new Map(acceptedImages(images).map((image) => [image.checksumSha256, image] as const));
  const removedAcceptedByChecksum = new Map(images
    .filter((item): item is AcceptedImageAsset => item.status === "accepted" && item.lifecycle === "removed")
    .map((image) => [image.checksumSha256, image] as const));
  const claimedChecksums = new Set<string>();
  const claimImageId = (): number => {
    const id = nextImageId;
    nextImageId += 1;
    return id;
  };
  const results = await mapConcurrent(files, IMPORT_IMAGE_CONCURRENCY, (file) => processImportFile(session, file, {
    activeAcceptedByChecksum,
    removedAcceptedByChecksum,
    claimedChecksums,
    claimImageId,
  }));
  for (const result of results) {
    if (!result) continue;
    if (result.restored) {
      const removedIndex = images.findIndex((image) => image.status === "accepted" && image.id === result.restored?.id);
      if (removedIndex >= 0) images[removedIndex] = result.restored;
    }
    if (result.image) images.push(result.image);
    slices.push(...result.slices);
    sliceEncodes.push(...result.sliceEncodes);
    thumbnailWrites.push(...result.thumbnailWrites);
  }
  enqueueThumbnailCreateAndStore(thumbnailWrites);
  enqueueSliceEncodeAndStore(sliceEncodes);
  const next = invalidateDerived({ ...session, images, slices, nextImageId }, { keepSlices: true, keepOcrResults: true });
  return waitForMissingActiveSliceOcr(next, {
    fallbackToStoredPng: false,
    recognitionMode: importRecognitionMode(session),
  });
}

async function processImportFile(
  session: Session,
  file: File,
  state: {
    activeAcceptedByChecksum: ReadonlyMap<string, AcceptedImageAsset>;
    removedAcceptedByChecksum: ReadonlyMap<string, AcceptedImageAsset>;
    claimedChecksums: Set<string>;
    claimImageId: () => number;
  },
): Promise<AddFileResult | null> {
  const emptyResult = (): AddFileResult => ({ slices: [], sliceEncodes: [], thumbnailWrites: [] });
  let image: ImageAsset;
  if (!(file.type === "image/png" || file.name.toLowerCase().endsWith(".png"))) {
    image = rejectedImage(file, "Unsupported file type");
    return { ...emptyResult(), image };
  }
  if (file.size >= 3 * 1024 * 1024) {
    image = rejectedImage(file, "Image is too large");
    return { ...emptyResult(), image };
  }

  try {
    const checksumSha256 = await sha256File(file);
    const duplicate = state.activeAcceptedByChecksum.get(checksumSha256);
    if (duplicate) {
      image = rejectedImage(file, "Duplicate screenshot", duplicate.width, duplicate.height, duplicate.frame, URL.createObjectURL(file));
      return { ...emptyResult(), image };
    }
    if (state.claimedChecksums.has(checksumSha256)) {
      return null;
    }
    state.claimedChecksums.add(checksumSha256);

    const removed = state.removedAcceptedByChecksum.get(checksumSha256);
    if (removed) {
      const restored: AcceptedImageAsset = {
        ...removed,
        lifecycle: "active" as const,
        fileName: file.name,
        sizeBytes: file.size,
        url: removed.url ?? URL.createObjectURL(file),
      };
      return { ...emptyResult(), restored };
    }

    const id = state.claimImageId();
    const full = await readFullImage(file, { id: String(id), lineCount: DEFAULT_LINE_COUNT });
    const analysis = stripRuntimeImageFields(full);
    if (!analysis.ok) {
      image = rejectedImage(file, "Not a Maple screenshot", analysis.size.width, analysis.size.height, analysis.frame, URL.createObjectURL(file));
      return { ...emptyResult(), image };
    }

    const cropped = await cropAndPrefilterImage(session, full, { id, fileName: file.name });
    if (cropped.slices.length === 0) {
      image = rejectedImage(file, "No buff log detected", analysis.size.width, analysis.size.height, analysis.frame, URL.createObjectURL(file));
      return { ...emptyResult(), image };
    }

    const thumbnailBlobKey = `${session.id}/thumbnail/${id}`;
    image = {
      id,
      fileName: file.name,
      createdAt: new Date().toISOString(),
      thumbnailBlobKey,
      checksumSha256,
      lifecycle: "active",
      url: URL.createObjectURL(file),
      width: analysis.size.width,
      height: analysis.size.height,
      sizeBytes: file.size,
      status: "accepted",
      frame: analysis.frame,
    };
    return {
      image,
      slices: cropped.slices,
      sliceEncodes: cropped.encodes,
      thumbnailWrites: [{ key: thumbnailBlobKey, image: full }],
    };
  } catch (error) {
    const reason = userFacingImageError(error);
    image = rejectedImage(file, reason);
    return { ...emptyResult(), image };
  }
}

function rejectedImage(file: File, reason: UserFacingRejectionReason, width = 0, height = 0, frame: ImageAsset["frame"] = undefined, url?: string): ImageAsset {
  return { fileName: file.name, createdAt: new Date().toISOString(), url, width, height, sizeBytes: file.size, status: "rejected", rejectionReason: reason, frame };
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

export async function sha256File(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function enqueueSliceEncodeAndStore(entries: PendingSliceEncode[]): void {
  if (entries.length === 0) return;
  const writeTask = pendingSliceWriteQueue.then(async () => {
    const writes: PendingBlobWrite[] = [];
    for (const entry of entries) {
      const blob = await canvasToPngBlob(entry.canvas);
      completedSliceUrls.set(entry.key, URL.createObjectURL(blob));
      writes.push({ key: entry.key, blob });
    }
    await putBlobs(writes);
  });
  pendingSliceWriteQueue = writeTask.catch((error) => {
    console.error("[cider] failed to encode/store slice blobs", error);
  });
}

function enqueueThumbnailCreateAndStore(entries: PendingThumbnailWrite[]): void {
  if (entries.length === 0) return;
  const writeTask = pendingThumbnailWriteQueue.then(async () => {
    for (const entry of entries) {
      const blob = await createThumbnailBlob(entry.image);
      await putBlob(entry.key, blob);
    }
  });
  pendingThumbnailWriteQueue = writeTask.catch((error) => {
    console.error("[cider] failed to create/store thumbnails", error);
  });
}

async function waitForPendingImportWrites(): Promise<void> {
  await Promise.all([pendingSliceWriteQueue, pendingThumbnailWriteQueue]);
}

function applyCompletedSliceUrls(session: Session): Session {
  let changed = false;
  const slices = session.slices.map((slice) => {
    if (slice.url) return slice;
    const url = completedSliceUrls.get(slice.blobKey);
    if (!url) return slice;
    completedSliceUrls.delete(slice.blobKey);
    changed = true;
    return { ...slice, url };
  });
  return changed ? { ...session, slices } : session;
}

function userFacingImageError(error: unknown): UserFacingRejectionReason {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not a PNG")) return "Unsupported file type";
  if (message.includes("larger than")) return "Image is too large";
  if (message.includes("no_client_frame")) return "Not a Maple screenshot";
  return "Could not read image";
}

export async function deleteImageFromSession(session: Session, target: ImageAsset): Promise<Session> {
  if (target.status === "accepted") {
    const images = session.images.map((item) => item.status === "accepted" && item.id === target.id ? { ...item, lifecycle: "removed" as const } : item);
    return clearInactiveSliceRuntimeState(invalidateDerived({ ...session, images }, { keepSlices: true, keepOcrResults: true }));
  }
  const images = removeRejectedImage(session.images, target);
  return clearInactiveSliceRuntimeState(invalidateDerived({ ...session, images }, { keepSlices: true, keepOcrResults: true }));
}

function removeRejectedImage(images: ImageAsset[], target: ImageAsset): ImageAsset[] {
  let removed = false;
  return images.filter((image) => {
    if (removed || image.status !== "rejected") return true;
    const matches = image === target
      || (image.fileName === target.fileName
        && image.createdAt === target.createdAt
        && image.sizeBytes === target.sizeBytes
        && image.rejectionReason === target.rejectionReason);
    if (!matches) return true;
    removed = true;
    return false;
  });
}

export function invalidateDerived(session: Session, options: { keepSlices?: boolean; keepOcrResults?: boolean } = {}): Session {
  if (!options.keepSlices) {
    sliceImageCache.clear();
    sliceOcrPromises.clear();
  }
  const stageInitialHashes = { ...session.stageInitialHashes };
  const stageOutputHashes = { ...session.stageOutputHashes };
  delete stageInitialHashes.import;
  return {
    ...session,
    slices: options.keepSlices ? session.slices : [],
    ocrResults: options.keepOcrResults ? session.ocrResults : [],
    stageInitialHashes,
    stageOutputHashes,
  };
}

export async function buildSlicesAndRunOcr(session: Session): Promise<Session> {
  const sessionWithSliceUrls = applyCompletedSliceUrls(await waitForPendingImportWrites().then(() => session));
  return waitForMissingActiveSliceOcr(sessionWithSliceUrls, {
    fallbackToStoredPng: true,
    recognitionMode: importRecognitionMode(session),
  });
}

export async function garbageCollectInactiveImportImages(session: Session): Promise<Session> {
  const hasRejectedImages = session.images.some((image) => image.status === "rejected");
  const removedAcceptedImageIds = new Set(session.images.filter((image) => image.status === "accepted" && image.lifecycle === "removed").map((image) => image.id));
  if (!hasRejectedImages && removedAcceptedImageIds.size === 0) return session;
  const removedSlices = session.slices.filter((slice) => removedAcceptedImageIds.has(slice.imageId));
  const removedSliceIds = new Set(removedSlices.map((slice) => slice.id));
  await Promise.all([
    ...session.images.filter((image) => removedAcceptedImageIds.has(image.id) && image.thumbnailBlobKey).map((image) => deleteBlob(image.thumbnailBlobKey as string)),
    ...removedSlices.map((slice) => deleteBlob(slice.blobKey)),
  ]);
  const images = session.images.filter((image) => image.status !== "rejected" && !removedAcceptedImageIds.has(image.id));
  const slices = session.slices.filter((slice) => !removedAcceptedImageIds.has(slice.imageId));
  const ocrResults = session.ocrResults.filter((result) => !removedSliceIds.has(result.sliceId));
  clearSliceRuntimeState(removedSliceIds);
  return { ...session, images, slices, ocrResults };
}

async function cropAndPrefilterImage(
  session: Session,
  full: LoadedFullImage,
  image: Pick<AcceptedImageAsset, "id" | "fileName">,
): Promise<CropAndPrefilterResult> {
  const results: SliceAsset[] = [];
  const sliceEncodes: PendingSliceEncode[] = [];
  for (const rect of full.lineRects) {
    const safeRect = normalizeRect(rect);
    const index = rect.index + 1;
    const id = `${image.id}-${index}` as const;
    const blobKey = `${session.id}/slice/${id}`;
    const prefilterPixels = cropPixelsFromFullImage(full, safeRect);
    const prefilter = appleTimestampBracketPrefilter(prefilterPixels, safeRect.width, safeRect.height);
    if (!prefilter.ok) continue;
    sliceImageCache.set(id, { width: safeRect.width, height: safeRect.height, data: prefilterPixels });
    const canvas = cropRectToCanvas(full, safeRect);
    sliceEncodes.push({ key: blobKey, canvas });
    results.push({
      id,
      imageId: image.id,
      imageFileName: image.fileName,
      index,
      displayId: DEFAULT_LINE_COUNT + 1 - index,
      blobKey,
      crop: safeRect,
      width: safeRect.width,
      height: safeRect.height,
      prefilterStatus: "accepted",
    });
  }
  return { slices: results, encodes: sliceEncodes };
}

async function createThumbnailBlob(image: LoadedFullImage): Promise<Blob> {
  const maxEdge = 320;
  const scale = Math.min(1, maxEdge / Math.max(image.size.width, image.size.height));
  const width = Math.max(1, Math.round(image.size.width * scale));
  const height = Math.max(1, Math.round(image.size.height * scale));
  const canvas = createCanvas(width, height);
  const context = getCanvasContext(canvas);
  context.drawImage(image.canvas, 0, 0, width, height);
  return canvasToPngBlob(canvas);
}

function cropPixelsFromFullImage(image: LoadedFullImage, rect: Rect): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(rect.width * rect.height * 4);
  const sourceLeft = Math.max(0, rect.left);
  const sourceTop = Math.max(0, rect.top);
  const sourceRight = Math.min(image.size.width, rect.left + rect.width);
  const sourceBottom = Math.min(image.size.height, rect.top + rect.height);
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  if (sourceWidth <= 0 || sourceHeight <= 0) return pixels;

  const destinationLeft = sourceLeft - rect.left;
  const destinationTop = sourceTop - rect.top;
  for (let y = 0; y < sourceHeight; y += 1) {
    const sourceStart = ((sourceTop + y) * image.size.width + sourceLeft) * 4;
    const sourceEnd = sourceStart + sourceWidth * 4;
    const destinationStart = ((destinationTop + y) * rect.width + destinationLeft) * 4;
    pixels.set(image.pixels.subarray(sourceStart, sourceEnd), destinationStart);
  }

  return pixels;
}

function cropRectToCanvas(image: LoadedFullImage, rect: Rect): ReturnType<typeof createCanvas> {
  const canvas = createCanvas(rect.width, rect.height);
  const context = getCanvasContext(canvas, { willReadFrequently: true });
  context.fillStyle = "#000";
  context.fillRect(0, 0, rect.width, rect.height);
  const sourceLeft = Math.max(0, rect.left);
  const sourceTop = Math.max(0, rect.top);
  const sourceRight = Math.min(image.size.width, rect.left + rect.width);
  const sourceBottom = Math.min(image.size.height, rect.top + rect.height);
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  if (sourceWidth > 0 && sourceHeight > 0) {
    const source = image.context.getImageData(sourceLeft, sourceTop, sourceWidth, sourceHeight);
    context.putImageData(source, sourceLeft - rect.left, sourceTop - rect.top);
  }
  return canvas;
}

async function waitForMissingActiveSliceOcr(session: Session, options: { fallbackToStoredPng: boolean; recognitionMode: RecognitionMode }): Promise<Session> {
  const acceptedSlices = activeAcceptedSlices(session);
  const acceptedSliceIds = new Set(acceptedSlices.map((slice) => slice.id));
  const existingResults = session.ocrResults.filter((result) => result.status !== "failed" && result.recognitionMode === options.recognitionMode && acceptedSliceIds.has(result.sliceId));
  const existingResultIds = new Set(existingResults.map((result) => result.sliceId));
  clearCurrentModeSliceRuntimeState(existingResultIds, options.recognitionMode);

  const missingSlices = acceptedSlices.filter((slice) => !existingResultIds.has(slice.id));
  if (missingSlices.length === 0) return { ...session, ocrResults: existingResults };

  const resolved = await Promise.all(missingSlices.map((slice) => getOrCreateSliceOcrPromise(session, slice, options)));
  const newResults = resolved.filter((result): result is OcrResult => result !== null && result.recognitionMode === options.recognitionMode);
  for (const slice of missingSlices) sliceOcrPromises.delete(sliceOcrPromiseKey(slice.id, options.recognitionMode));
  if (newResults.length === 0) return { ...session, ocrResults: existingResults };

  return {
    ...session,
    ocrResults: mergeOcrResults(existingResults, newResults),
  };
}

function getOrCreateSliceOcrPromise(
  session: Session,
  slice: SliceAsset,
  options: { fallbackToStoredPng: boolean; recognitionMode: RecognitionMode },
): Promise<OcrResult | null> {
  const key = sliceOcrPromiseKey(slice.id, options.recognitionMode);
  const existing = sliceOcrPromises.get(key);
  if (existing) return existing;

  const promise = recognizeSlice(session, slice, options).catch(() => null);
  sliceOcrPromises.set(key, promise);
  return promise;
}

async function recognizeSlice(
  session: Session,
  slice: SliceAsset,
  options: { fallbackToStoredPng: boolean; recognitionMode: RecognitionMode },
): Promise<OcrResult | null> {
  const input = await toOcrSliceInput(session, slice.id, options.fallbackToStoredPng);
  if (!input) return null;
  if (input === "slice_decode_error") return { sliceId: slice.id, recognitionMode: options.recognitionMode, status: "rejected", rejectionReason: "Could not read image" };

  try {
    return toOcrResult(recognizeAppleOcrSlice(input, {
      ...ocrOptionsForRecognitionMode(options.recognitionMode),
    }), options.recognitionMode);
  } catch {
    return null;
  } finally {
    sliceImageCache.delete(slice.id);
  }
}

function mergeOcrResults(oldResults: OcrResult[], newResults: OcrResult[]): OcrResult[] {
  const ids = new Set(newResults.map((result) => result.sliceId));
  return [...oldResults.filter((result) => !ids.has(result.sliceId)), ...newResults];
}

async function toOcrSliceInput(session: Session, sliceId: SliceAsset["id"], fallbackToStoredPng: boolean): Promise<AppleOcrSliceInput | "slice_decode_error" | null> {
  const cached = sliceImageCache.get(sliceId);
  if (cached) return { id: sliceId, image: cached };
  if (!fallbackToStoredPng) return null;

  const slice = session.slices.find((item) => item.id === sliceId);
  if (!slice) return null;
  let blob: Blob | undefined;
  try {
    blob = await getBlob(slice.blobKey);
  } catch {
    return null;
  }
  if (!blob) return null;
  try {
    return { id: sliceId, image: await blobToRgbaImage(blob) };
  } catch {
    return "slice_decode_error";
  }
}

function clearInactiveSliceRuntimeState(session: Session): Session {
  const activeSliceIds = new Set(activeAcceptedSlices(session).map((slice) => slice.id));
  const inactiveSliceIds = session.slices.filter((slice) => !activeSliceIds.has(slice.id)).map((slice) => slice.id);
  clearSliceRuntimeState(inactiveSliceIds);
  return session;
}

function clearSliceRuntimeState(sliceIds: Iterable<SliceAsset["id"]>): void {
  for (const id of sliceIds) {
    sliceImageCache.delete(id);
    for (const mode of recognitionModes()) sliceOcrPromises.delete(sliceOcrPromiseKey(id, mode));
  }
}

function clearCurrentModeSliceRuntimeState(sliceIds: Iterable<SliceAsset["id"]>, recognitionMode: RecognitionMode): void {
  for (const id of sliceIds) {
    sliceImageCache.delete(id);
    sliceOcrPromises.delete(sliceOcrPromiseKey(id, recognitionMode));
  }
}

async function blobToRgbaImage(blob: Blob): Promise<RgbaImage> {
  let bitmap: ImageBitmap | HTMLImageElement | undefined;
  try {
    bitmap = await loadBlobBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = createCanvas(width, height);
    const context = getCanvasContext(canvas, { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } finally {
    closeBitmap(bitmap);
  }
}

async function loadBlobBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
    } catch {
      throw new Error("Could not decode PNG image");
    }
  }

  if (typeof Image === "function") return loadBlobImageElement(blob);
  throw new Error("Could not decode PNG image");
}

function loadBlobImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.addEventListener(
      "load",
      () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not decode PNG image"));
      },
      { once: true },
    );

    image.src = objectUrl;
  });
}

function toOcrResult(item: AppleOcrResult, recognitionMode: RecognitionMode): OcrResult {
  const sliceId = item.id as SliceAsset["id"];
  if (!item.ok) return { sliceId: sliceId as SliceAsset["id"], recognitionMode, status: "rejected", rejectionReason: mapOcrReject(item.reason) };
  const timestamp = normalizeTimestamp(item.time ?? "");
  const player = item.player ?? "";
  const itemName = item.item ?? "";
  if (!timestamp) return { sliceId: sliceId as SliceAsset["id"], recognitionMode, status: "rejected", rejectionReason: mapOcrReject("bad_timestamp") };
  if (!player) return { sliceId: sliceId as SliceAsset["id"], recognitionMode, status: "rejected", rejectionReason: mapOcrReject("bad_player_name") };
  if (!itemName) return { sliceId: sliceId as SliceAsset["id"], recognitionMode, status: "rejected", rejectionReason: mapOcrReject("bad_item_name") };
  const record: AuditRecord = { id: `record_${sliceId}`, sourceSliceId: sliceId as SliceAsset["id"], timestamp, player, item: itemName, source: "ocr" };
  return { sliceId: sliceId as SliceAsset["id"], recognitionMode, status: "accepted", record };
}

function importRecognitionMode(session: Session): RecognitionMode {
  return session.importSettings?.recognitionMode ?? "balanced";
}

function ocrOptionsForRecognitionMode(recognitionMode: RecognitionMode): AppleOcrOptions {
  return { evidenceMode: RECOGNITION_EVIDENCE_MODES[recognitionMode] };
}

function sliceOcrPromiseKey(sliceId: SliceAsset["id"], recognitionMode: RecognitionMode): string {
  return `${sliceId}:${recognitionMode}`;
}

function recognitionModes(): RecognitionMode[] {
  return ["fast", "balanced", "best"];
}

function normalizeTimestamp(value: string): string {
  const match = value.match(/(\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (!match) return "";
  return `[${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}:${match[3].padStart(2, "0")}]`;
}

function mapOcrReject(reason: string | undefined): UserFacingRejectionReason {
  if (reason === "bad_timestamp") return "Could not read timestamp";
  if (reason === "bad_player_name") return "Could not read player name";
  if (reason === "bad_item_name") return "Could not read item name";
  if (reason === "not_apple_log") return "No buff log detected";
  return "Could not read text";
}

export function pruneRecordState(session: Session): Session {
  const baseIds = new Set(baseRecords(session).map((record) => record.id));
  return {
    ...session,
    recordEdits: Object.fromEntries(Object.entries(session.recordEdits).filter(([id]) => baseIds.has(id))),
    recordDrafts: Object.fromEntries(Object.entries(session.recordDrafts).filter(([id]) => baseIds.has(id))),
    deletedRecordIds: session.deletedRecordIds.filter((id) => baseIds.has(id)),
    manualRecords: session.manualRecords.filter(isRecordComplete),
  };
}
