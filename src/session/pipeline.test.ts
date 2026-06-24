import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppleOcrSliceInput } from "../cider";
import type { AcceptedImageAsset, Session, SliceAsset } from "../types";
import { createNewSession, loadSessionMetadata, saveSession } from "./session";

const blobs = vi.hoisted(() => new Map<string, Blob>());
const readFullImageMock = vi.hoisted(() => vi.fn());
const appleTimestampBracketPrefilterMock = vi.hoisted(() => vi.fn(() => ({ ok: true })));

vi.mock("./indexedDb", () => ({
  deleteBlob: vi.fn(async (key: string) => { blobs.delete(key); }),
  getBlob: vi.fn(async (key: string) => blobs.get(key)),
  putBlob: vi.fn(async (key: string, blob: Blob) => { blobs.set(key, blob); }),
  putBlobs: vi.fn(async (entries: readonly { key: string; blob: Blob }[]) => {
    for (const entry of entries) blobs.set(entry.key, entry.blob);
  }),
}));

vi.mock("../cider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cider")>();
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn((_left: number, _top: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  };
  return {
    ...actual,
    appleTimestampBracketPrefilter: appleTimestampBracketPrefilterMock,
    canvasToPngBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    createCanvas: vi.fn(() => ({ width: 0, height: 0 })),
    getCanvasContext: vi.fn(() => context),
    readFullImage: readFullImageMock,
    recognizeAppleOcrSlice: vi.fn((slice: AppleOcrSliceInput) => ({
      id: slice.id,
      ok: true,
      time: "01:02:03",
      player: "Alice",
      item: "Onyx Apple",
    })),
    recognizeAppleOcr: vi.fn((slices: readonly AppleOcrSliceInput[]) => ({
      v: 1,
      results: slices.map((slice) => ({
        id: slice.id,
        ok: true,
        time: "01:02:03",
        player: "Alice",
        item: "Onyx Apple",
      })),
    })),
  };
});

import { canvasToPngBlob, createCanvas, recognizeAppleOcrSlice } from "../cider";
import { putBlob, putBlobs } from "./indexedDb";
import { addFilesToSession, buildSlicesAndRunOcr, deleteImageFromSession, garbageCollectInactiveImportImages, sha256File } from "./pipeline";

describe("pipeline", () => {
  beforeEach(() => {
    blobs.clear();
    readFullImageMock.mockReset();
    appleTimestampBracketPrefilterMock.mockReturnValue({ ok: true });
    vi.mocked(recognizeAppleOcrSlice).mockClear();
    vi.mocked(canvasToPngBlob).mockClear();
    vi.mocked(createCanvas).mockClear();
    vi.mocked(putBlob).mockClear();
    vi.mocked(putBlobs).mockClear();
    installLocalStorage();
    installObjectUrlMock();
    installBitmapMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("runs OCR from stored slices without an original image blob", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [{
        id: 1,
        fileName: "screen.png",
        createdAt: "2026-05-03T00:00:00.000Z",
        thumbnailBlobKey: "session_test/thumbnail/1",
        checksumSha256: "abc123",
        width: 1280,
        height: 720,
        sizeBytes: 1024,
        lifecycle: "active",
        status: "accepted",
      }],
      slices: [slice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(result.slices).toEqual([slice]);
    expect(result.ocrResults).toEqual([{
      sliceId: "1-1",
      recognitionMode: "balanced",
      status: "accepted",
      record: {
        id: "record_1-1",
        sourceSliceId: "1-1",
        timestamp: "[01:02:03]",
        player: "Alice",
        item: "Onyx Apple",
        source: "ocr",
      },
    }]);
  });

  it("records a rejected OCR result when stored slice fallback cannot be decoded", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["not-png"], { type: "image/png" }));
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(result.ocrResults).toEqual([{ sliceId: "1-1", recognitionMode: "balanced", status: "rejected", rejectionReason: "Could not read image" }]);
    expect(vi.mocked(recognizeAppleOcrSlice)).not.toHaveBeenCalled();
  });

  it("ignores slices that do not belong to active accepted images", async () => {
    const acceptedSlice = sliceAsset("1-1", "session_test/slice/1-1");
    const orphanSlice = { ...sliceAsset("2-1", "session_test/slice/2-1"), imageId: 2 };
    blobs.set(acceptedSlice.blobKey, new Blob(["accepted"], { type: "image/png" }));
    blobs.set(orphanSlice.blobKey, new Blob(["orphan"], { type: "image/png" }));
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [
        {
          id: 1,
          fileName: "accepted.png",
          createdAt: "2026-05-03T00:00:00.000Z",
          thumbnailBlobKey: "session_test/thumbnail/1",
          checksumSha256: "abc123",
          width: 1280,
          height: 720,
          sizeBytes: 1024,
          lifecycle: "active",
          status: "accepted",
        },
      ],
      slices: [acceptedSlice, orphanSlice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(result.slices).toEqual([acceptedSlice, orphanSlice]);
    expect(result.ocrResults.map((result) => result.sliceId)).toEqual(["1-1"]);
  });


  it("rejects a duplicate of an existing accepted image before decoding", async () => {
    const file = pngFile("same-bytes");
    const checksumSha256 = await sha256File(file);
    const session: Session = {
      ...createNewSession(),
      images: [{
        id: 1,
        fileName: "existing.png",
        createdAt: "2026-05-03T00:00:00.000Z",
        thumbnailBlobKey: "session_test/thumbnail/1",
        checksumSha256,
        width: 1280,
        height: 720,
        sizeBytes: file.size,
        lifecycle: "active",
        status: "accepted",
      }],
      nextImageId: 2,
    };

    const result = await addFilesToSession(session, [file]);

    expect(readFullImageMock).not.toHaveBeenCalled();
    expect(result.images.at(-1)?.status).toBe("rejected");
    expect(result.images.at(-1)?.rejectionReason).toBe("Duplicate screenshot");
    expect(result.images.at(-1)?.url).toBe("blob:screen.png");
    expect(result.nextImageId).toBe(2);
  });

  it("drops same-batch duplicates after the first checksum owner", async () => {
    readFullImageMock.mockImplementation((file: File, options: { id: string }) => loadedImage(file, options.id));
    const first = pngFile("same-bytes", "first.png");
    const second = pngFile("same-bytes", "second.png");

    const result = await addFilesToSession(createNewSession(), [first, second]);

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ status: "accepted" });
    expect(result.images[0].checksumSha256).toBe(await sha256File(first));
    expect(readFullImageMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid files before hashing or decoding", async () => {
    const file = new File(["same-bytes"], "screen.jpg", { type: "image/jpeg" });
    const arrayBufferSpy = vi.spyOn(file, "arrayBuffer");

    const result = await addFilesToSession(createNewSession(), [file]);

    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(readFullImageMock).not.toHaveBeenCalled();
    expect(result.images[0].rejectionReason).toBe("Unsupported file type");
  });

  it("drops same-batch duplicates even when the checksum owner is rejected", async () => {
    readFullImageMock.mockImplementation((file: File, options: { id: string }) => loadedImage(file, options.id));
    appleTimestampBracketPrefilterMock.mockReturnValue({ ok: false });
    const first = pngFile("same-bytes", "first.png");
    const second = pngFile("same-bytes", "second.png");

    const result = await addFilesToSession(createNewSession(), [first, second]);

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ status: "rejected", rejectionReason: "No buff log detected" });
    expect(result.images[0].url).toMatch(/^blob:(first|second)\.png$/);
    expect(readFullImageMock).toHaveBeenCalledTimes(1);
  });

  it("does not allocate image ids for rejected files", async () => {
    const result = await addFilesToSession(createNewSession(), [new File(["same-bytes"], "screen.jpg", { type: "image/jpeg" })]);

    expect(result.nextImageId).toBe(1);
    expect(result.images[0]).toMatchObject({ status: "rejected", rejectionReason: "Unsupported file type" });
    expect("id" in result.images[0]).toBe(false);
  });

  it("batches slice IndexedDB writes once per import", async () => {
    readFullImageMock.mockImplementation((file: File, options: { id: string }) => loadedImage(file, options.id));
    const session = { ...createNewSession(), id: "session_test" };

    const imported = await addFilesToSession(session, [
      pngFile("first-bytes", "first.png"),
      pngFile("second-bytes", "second.png"),
    ]);
    await buildSlicesAndRunOcr(imported);

    expect(putBlobs).toHaveBeenCalledTimes(1);
    expect(putBlobs).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: expect.stringMatching(/\/slice\/1-1$/), blob: expect.any(Blob) }),
      expect.objectContaining({ key: expect.stringMatching(/\/slice\/2-1$/), blob: expect.any(Blob) }),
    ]));
    expect(vi.mocked(putBlobs).mock.calls[0][0]).toHaveLength(2);
    expect(putBlob).toHaveBeenCalledTimes(2);
    expect(putBlob).toHaveBeenCalledWith("session_test/thumbnail/1", expect.any(Blob));
    expect(putBlob).toHaveBeenCalledWith("session_test/thumbnail/2", expect.any(Blob));
    expect(blobs.has("session_test/slice/1-1")).toBe(true);
    expect(blobs.has("session_test/slice/2-1")).toBe(true);
  });

  it("does not wait for slice encode/store or thumbnail creation before returning imported images", async () => {
    readFullImageMock.mockImplementation((file: File, options: { id: string }) => loadedImage(file, options.id));
    const sliceEncode = deferred<Blob>();
    const thumbnailEncode = deferred<Blob>();
    let encodeCall = 0;
    vi.mocked(canvasToPngBlob).mockImplementation(() => {
      encodeCall += 1;
      if (encodeCall === 1) return thumbnailEncode.promise;
      if (encodeCall === 2) return sliceEncode.promise;
      return Promise.resolve(new Blob(["png"], { type: "image/png" }));
    });

    const imported = await addFilesToSession({ ...createNewSession(), id: "session_test" }, [pngFile("same-bytes", "accepted.png")]);
    await Promise.resolve();

    expect(imported.images[0]).toMatchObject({ status: "accepted", fileName: "accepted.png", url: "blob:accepted.png" });
    expect(imported.slices[0]).toMatchObject({ id: "1-1", blobKey: "session_test/slice/1-1" });
    expect(imported.slices[0].url).toBeUndefined();
    expect(imported.ocrResults.map((result) => result.sliceId)).toEqual(["1-1"]);
    expect(vi.mocked(canvasToPngBlob)).toHaveBeenCalledTimes(2);
    expect(putBlob).not.toHaveBeenCalledWith("session_test/thumbnail/1", expect.any(Blob));
    expect(putBlobs).not.toHaveBeenCalled();

    thumbnailEncode.resolve(new Blob(["thumb"], { type: "image/png" }));
    sliceEncode.resolve(new Blob(["slice"], { type: "image/png" }));
    const withOcr = await buildSlicesAndRunOcr(imported);

    expect(putBlob).toHaveBeenCalledWith("session_test/thumbnail/1", expect.any(Blob));
    expect(putBlobs).toHaveBeenCalledWith([
      expect.objectContaining({ key: "session_test/slice/1-1", blob: expect.any(Blob) }),
    ]);
    expect(withOcr.slices[0].url).toBe("blob:undefined");
  });

  it("does not PNG encode candidate slices rejected by prefilter", async () => {
    readFullImageMock.mockImplementation((file: File, options: { id: string }) => loadedImage(file, options.id));
    appleTimestampBracketPrefilterMock.mockReturnValue({ ok: false });

    const result = await addFilesToSession(createNewSession(), [pngFile("same-bytes", "rejected.png")]);

    expect(result.images[0]).toMatchObject({ status: "rejected", rejectionReason: "No buff log detected" });
    expect(blobs.size).toBe(0);
    expect(vi.mocked(createCanvas)).not.toHaveBeenCalled();
    expect(vi.mocked(canvasToPngBlob)).not.toHaveBeenCalled();
    expect(putBlobs).not.toHaveBeenCalled();
  });

  it("does not persist rejected import entries or their slices", () => {
    const acceptedSlice = sliceAsset("1-1", "session_test/slice/1-1");
    const rejectedSlice = { ...sliceAsset("2-1", "session_test/slice/2-1"), imageId: 2 };
    const session: Session = {
      ...createNewSession(),
      images: [
        {
          id: 1,
          fileName: "accepted.png",
          createdAt: "2026-05-03T00:00:00.000Z",
          thumbnailBlobKey: "session_test/thumbnail/1",
          checksumSha256: "abc123",
          width: 1280,
          height: 720,
          sizeBytes: 1024,
          lifecycle: "active",
          status: "accepted",
        },
        {
          fileName: "duplicate.png",
          createdAt: "2026-05-03T00:00:00.000Z",
          width: 0,
          height: 0,
          sizeBytes: 1024,
          status: "rejected",
          rejectionReason: "Duplicate screenshot",
        },
      ],
      slices: [acceptedSlice, rejectedSlice],
    };

    saveSession(session);

    const restored = loadSessionMetadata();
    expect(restored?.images.map((image) => image.fileName)).toEqual(["accepted.png"]);
    expect(restored?.slices.map((slice) => slice.id)).toEqual(["1-1"]);
  });

  it("defaults new and legacy sessions to balanced import recognition and cutoff apple mode", () => {
    const created = createNewSession();
    expect(created.importSettings.recognitionMode).toBe("balanced");
    expect(created.effectiveAppleMode).toBe("cutoff");

    localStorage.setItem("cider-production-session-v1", JSON.stringify({ id: "legacy_session" }));
    const restored = loadSessionMetadata();

    expect(restored?.importSettings.recognitionMode).toBe("balanced");
    expect(restored?.effectiveAppleMode).toBe("cutoff");
  });

  it("marks accepted images removed and reactivates the same checksum before leaving import", async () => {
    const file = pngFile("same-bytes", "restored.png");
    const checksumSha256 = await sha256File(file);
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    const ocrResult = {
      sliceId: "1-1" as const,
      recognitionMode: "balanced" as const,
      status: "accepted" as const,
      record: { id: "record_1-1", sourceSliceId: "1-1" as const, timestamp: "[01:02:03]", player: "Alice", item: "Onyx Apple", source: "ocr" as const },
    };
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage({ checksumSha256 })],
      slices: [slice],
      ocrResults: [ocrResult],
      nextImageId: 2,
    };

    const removed = await deleteImageFromSession(session, session.images[0]);
    const restored = await addFilesToSession(removed, [file]);

    expect(removed.images[0].lifecycle).toBe("removed");
    expect(restored.images).toHaveLength(1);
    expect(restored.images[0]).toMatchObject({ id: 1, fileName: "restored.png", lifecycle: "active" });
    expect(restored.slices).toEqual([slice]);
    expect(restored.ocrResults).toEqual([ocrResult]);
    expect(restored.nextImageId).toBe(2);
    expect(readFullImageMock).not.toHaveBeenCalled();
  });

  it("garbage collects removed accepted artifacts and rejected image metadata", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set("session_test/thumbnail/1", new Blob(["thumb"], { type: "image/png" }));
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [
        acceptedImage({ lifecycle: "removed" }),
        {
          fileName: "duplicate.png",
          createdAt: "2026-05-03T00:00:00.000Z",
          width: 0,
          height: 0,
          sizeBytes: 1024,
          status: "rejected",
          rejectionReason: "Duplicate screenshot",
        },
      ],
      slices: [slice],
      ocrResults: [{ sliceId: "1-1", recognitionMode: "balanced", status: "rejected", rejectionReason: "Could not read text" }],
    };

    const collected = await garbageCollectInactiveImportImages(session);

    expect(collected.images).toEqual([]);
    expect(collected.slices).toEqual([]);
    expect(collected.ocrResults).toEqual([]);
    expect(blobs.has("session_test/thumbnail/1")).toBe(false);
    expect(blobs.has(slice.blobKey)).toBe(false);
  });

  it("runs OCR only for active accepted slices without existing results", async () => {
    const existingSlice = sliceAsset("1-1", "session_test/slice/1-1");
    const newSlice = { ...sliceAsset("2-1", "session_test/slice/2-1"), imageId: 2 };
    blobs.set(existingSlice.blobKey, new Blob(["existing"], { type: "image/png" }));
    blobs.set(newSlice.blobKey, new Blob(["new"], { type: "image/png" }));
    const existingResult = {
      sliceId: "1-1" as const,
      recognitionMode: "balanced" as const,
      status: "accepted" as const,
      record: { id: "record_1-1", sourceSliceId: "1-1" as const, timestamp: "[01:02:03]", player: "Alice", item: "Onyx Apple", source: "ocr" as const },
    };
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage(), acceptedImage({ id: 2, checksumSha256: "def456" })],
      slices: [existingSlice, newSlice],
      ocrResults: [existingResult],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(vi.mocked(recognizeAppleOcrSlice).mock.calls).toHaveLength(1);
    expect(vi.mocked(recognizeAppleOcrSlice).mock.calls[0][0].id).toBe("2-1");
    expect(result.ocrResults.map((item) => item.sliceId)).toEqual(["1-1", "2-1"]);
  });

  it("uses the current import recognition mode for OCR and stamps the result", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      importSettings: { recognitionMode: "best" },
      images: [acceptedImage()],
      slices: [slice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(vi.mocked(recognizeAppleOcrSlice).mock.calls[0][1]).toMatchObject({ evidenceMode: "bg-alpha-accurate" });
    expect(result.ocrResults[0].recognitionMode).toBe("best");
  });

  it("recomputes active OCR when the stored result mode is stale", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const staleResult = {
      sliceId: "1-1" as const,
      recognitionMode: "fast" as const,
      status: "accepted" as const,
      record: { id: "record_1-1", sourceSliceId: "1-1" as const, timestamp: "[01:02:03]", player: "Alice", item: "Onyx Apple", source: "ocr" as const },
    };
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      importSettings: { recognitionMode: "balanced" },
      images: [acceptedImage()],
      slices: [slice],
      ocrResults: [staleResult],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(vi.mocked(recognizeAppleOcrSlice)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recognizeAppleOcrSlice).mock.calls[0][1]).toMatchObject({ evidenceMode: "bg-alpha-fast" });
    expect(result.ocrResults).toHaveLength(1);
    expect(result.ocrResults[0].recognitionMode).toBe("balanced");
  });

  it("treats old OCR results without recognition provenance as stale", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const legacyResult = {
      sliceId: "1-1" as const,
      status: "rejected" as const,
      rejectionReason: "Could not read text" as const,
    } as Omit<Session["ocrResults"][number], "recognitionMode"> as Session["ocrResults"][number];
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
      ocrResults: [legacyResult],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(vi.mocked(recognizeAppleOcrSlice)).toHaveBeenCalledTimes(1);
    expect(result.ocrResults[0].recognitionMode).toBe("balanced");
  });

  it("reuses one OCR promise for concurrent requests for the same missing active slice", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
    };

    const [first, second] = await Promise.all([buildSlicesAndRunOcr(session), buildSlicesAndRunOcr(session)]);

    expect(vi.mocked(recognizeAppleOcrSlice)).toHaveBeenCalledTimes(1);
    expect(first.ocrResults).toEqual(second.ocrResults);
    expect(first.ocrResults.map((result) => result.sliceId)).toEqual(["1-1"]);
  });

  it("does not reuse an in-flight OCR promise across recognition modes", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const bitmap = deferred<ImageBitmap>();
    vi.mocked(createImageBitmap).mockReturnValueOnce(bitmap.promise);
    const fastSession: Session = {
      ...createNewSession(),
      id: "session_test",
      importSettings: { recognitionMode: "fast" },
      images: [acceptedImage()],
      slices: [slice],
    };
    const bestSession: Session = {
      ...fastSession,
      importSettings: { recognitionMode: "best" },
    };

    const fast = buildSlicesAndRunOcr(fastSession);
    await Promise.resolve();
    await Promise.resolve();
    const best = await buildSlicesAndRunOcr(bestSession);
    bitmap.resolve({ width: 100, height: 20, close: vi.fn() } as unknown as ImageBitmap);
    const resolvedFast = await fast;

    expect(vi.mocked(recognizeAppleOcrSlice)).toHaveBeenCalledTimes(2);
    expect(best.ocrResults[0].recognitionMode).toBe("best");
    expect(resolvedFast.ocrResults[0].recognitionMode).toBe("fast");
  });

  it("does not create OCR promises for slices with existing rejected OCR results", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    const existingResult = { sliceId: "1-1" as const, recognitionMode: "balanced" as const, status: "rejected" as const, rejectionReason: "Could not read text" as const };
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
      ocrResults: [existingResult],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(vi.mocked(recognizeAppleOcrSlice)).not.toHaveBeenCalled();
    expect(result.ocrResults).toEqual([existingResult]);
  });

  it("does not persist failed OCR results when recognition throws", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    vi.mocked(recognizeAppleOcrSlice).mockImplementationOnce(() => {
      throw new Error("recognition failed");
    });
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(result.ocrResults).toEqual([]);
  });

  it("persists recognized OCR rejections for issues review", async () => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    vi.mocked(recognizeAppleOcrSlice).mockReturnValueOnce({ id: "1-1", ok: false, reason: "ocr_error" });
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(result.ocrResults).toEqual([{ sliceId: "1-1", recognitionMode: "balanced", status: "rejected", rejectionReason: "Could not read text" }]);
  });

  it.each([
    ["bad_timestamp", "Could not read timestamp"],
    ["bad_player_name", "Could not read player name"],
    ["bad_item_name", "Could not read item name"],
    ["not_apple_log", "No buff log detected"],
    [undefined, "Could not read text"],
  ] as const)("maps OCR reason %s to %s", async (reason, rejectionReason) => {
    const slice = sliceAsset("1-1", "session_test/slice/1-1");
    blobs.set(slice.blobKey, new Blob(["slice"], { type: "image/png" }));
    vi.mocked(recognizeAppleOcrSlice).mockReturnValueOnce({ id: "1-1", ok: false, reason });
    const session: Session = {
      ...createNewSession(),
      id: "session_test",
      images: [acceptedImage()],
      slices: [slice],
    };

    const result = await buildSlicesAndRunOcr(session);

    expect(result.ocrResults).toEqual([{ sliceId: "1-1", recognitionMode: "balanced", status: "rejected", rejectionReason }]);
  });
});

function acceptedImage(overrides: Partial<AcceptedImageAsset> = {}): AcceptedImageAsset {
  return {
    id: 1,
    fileName: "accepted.png",
    createdAt: "2026-05-03T00:00:00.000Z",
    lifecycle: "active",
    thumbnailBlobKey: "session_test/thumbnail/1",
    checksumSha256: "abc123",
    width: 1280,
    height: 720,
    sizeBytes: 1024,
    status: "accepted",
    ...overrides,
  };
}

function sliceAsset(id: SliceAsset["id"], blobKey: string): SliceAsset {
  return {
    id,
    imageId: 1,
    imageFileName: "screen.png",
    index: 1,
    displayId: 39,
    blobKey,
    crop: { left: 0, top: 0, width: 100, height: 20 },
    width: 100,
    height: 20,
    prefilterStatus: "accepted",
  };
}

function pngFile(content: string, name = "screen.png"): File {
  return new File([content], name, { type: "image/png" });
}

function loadedImage(file: File, id: string) {
  const context = {
    getImageData: vi.fn((_left: number, _top: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  };
  const width = 1280;
  const height = 720;
  const pixels = new Uint8ClampedArray(width * height * 4);
  paintPrefilterMatch(pixels, width, 10, 10);
  return {
    id,
    name: file.name,
    size: { width, height },
    ok: true,
    frame: { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, adjustment: 0, clientSize: "1280x720" },
    lineRects: [{ index: 0, left: 10, top: 10, width: 100, height: 20 }],
    file,
    canvas: { width, height },
    context,
    pixels,
  };
}

function paintPrefilterMatch(pixels: Uint8ClampedArray, imageWidth: number, cropLeft: number, cropTop: number): void {
  const cyan = [0x66, 0xcc, 0xff] as const;
  for (let y = 1; y <= 11; y += 1) {
    const index = ((cropTop + y) * imageWidth + cropLeft + 55) * 4;
    pixels[index] = cyan[0];
    pixels[index + 1] = cyan[1];
    pixels[index + 2] = cyan[2];
  }
  for (const y of [1, 11]) {
    for (const x of [54, 4]) {
      const index = ((cropTop + y) * imageWidth + cropLeft + x) * 4;
      pixels[index] = cyan[0];
      pixels[index + 1] = cyan[1];
      pixels[index + 2] = cyan[2];
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
      removeItem: vi.fn((key: string) => { store.delete(key); }),
    },
  });
}

function installObjectUrlMock(): void {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((file: File) => `blob:${file.name}`),
  });
}

function installBitmapMock(): void {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: vi.fn(async () => ({ width: 100, height: 20, close: vi.fn() })),
  });
}
