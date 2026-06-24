import { describe, expect, it } from "vitest";
import type { AuditRecord, OcrResult, Session, SliceAsset } from "../types";
import { createNewSession, recordsInitialRecords, reviewRecords } from "./session";
import { enterStage, reachableStageIndex, resetRecordsOutput } from "./stageManagement";

const importAndIssueHashes = { import: "[]", issues: "[]" };

describe("enterStage", () => {
  it("preserves existing import OCR when entering the next stage", async () => {
    const ocrResult = ocrRecord(record("record_1-1", "Alice", "Onyx Apple"));
    const session: Session = {
      ...createNewSession(),
      images: [{
        id: 1,
        fileName: "screen.png",
        createdAt: "2026-05-03T00:00:00.000Z",
        checksumSha256: "abc123",
        width: 1280,
        height: 720,
        sizeBytes: 1024,
        lifecycle: "active",
        status: "accepted",
      }],
      slices: [sliceAsset("1-1")],
      ocrResults: [ocrResult],
    };

    const entered = await enterStage(session, "issues");

    expect(entered.ocrResults).toEqual([ocrResult]);
    expect(entered.stageInitialHashes.import).toBeDefined();
  });

  it("preserves cleanup output when its derived initial is unchanged", async () => {
    const prepared = await enterStage(withRecords([record("record_1", "Alice", "Onyx Apple")]), "cleanup");
    const editedRecord = { ...record("record_1", "Alice", "Onyx Apple"), item: "Gelt Chocolate" };
    const edited = { ...prepared, recordEdits: { record_1: editedRecord } };

    const reentered = await enterStage(edited, "cleanup");

    expect(reentered.recordEdits.record_1).toEqual(editedRecord);
  });

  it("derives cleanup initial from raw OCR and manual records", () => {
    const session = {
      ...withRecords([record("manual_1", "Christ0pher", "Gelt Chocolate")]),
      ocrResults: [ocrRecord(record("record_1-1", "Christ0pher", "Onyx Apple"))],
    };

    expect(recordsInitialRecords(session).map((item) => [item.id, item.player, item.source])).toEqual([
      ["record_1-1", "Christ0pher", "ocr"],
      ["manual_1", "Christ0pher", "manual"],
    ]);
  });

  it("compares cleanup edits against the raw initial", () => {
    const session = {
      ...withRecords([record("record_1", "Christ0pher", "Onyx Apple")]),
      recordEdits: { record_1: record("record_1", "Christopher", "Onyx Apple") },
    };

    expect(reviewRecords(session).map((item) => item.player)).toEqual(["Christopher"]);
  });

  it("computes results output and keeps export settings when export initial is unchanged", async () => {
    const session = withRecords([
      record("record_1", "Alice", "Onyx Apple", "[23:59:58]"),
      record("record_2", "Alice", "Onyx Apple", "[23:59:58]"),
      record("record_3", "Bob", "Gelt Chocolate", "[00:00:02]"),
    ]);
    const summarized = await enterStage(session, "results");
    const exportConfigured = { ...summarized, exportFormat: "csv" as const, effectiveAppleMode: "scaled" as const };

    const reentered = await enterStage(exportConfigured, "export");

    expect(reentered.resultsRecords.map((item) => item.id)).toEqual(["record_1", "record_3"]);
    expect(reentered.exportFormat).toBe("csv");
    expect(reentered.effectiveAppleMode).toBe("scaled");
  });

  it("limits reach to the next stage when a historical output changes", async () => {
    const exported = await enterStage(withRecords([record("record_1", "Alice", "Onyx Apple")]), "export");
    const changedCleanup = { ...exported, recordEdits: { record_1: record("record_1", "Bob", "Onyx Apple") } };

    expect(reachableStageIndex(changedCleanup)).toBe(3);
  });

  it("limits reach when import recognition mode changes after downstream stages were prepared", async () => {
    const exported = await enterStage(withRecords([record("record_1", "Alice", "Onyx Apple")]), "export");
    const changedImportMode = { ...exported, importSettings: { recognitionMode: "best" as const } };

    expect(reachableStageIndex(changedImportMode)).toBe(1);
  });

  it("restores previous reach when a historical output changes back to the saved value", async () => {
    const exported = await enterStage(withRecords([record("record_1", "Alice", "Onyx Apple")]), "export");
    const changedCleanup = { ...exported, recordEdits: { record_1: record("record_1", "Bob", "Onyx Apple") } };
    const restoredCleanup = { ...changedCleanup, recordEdits: exported.recordEdits };

    expect(reachableStageIndex(changedCleanup)).toBe(3);
    expect(reachableStageIndex(restoredCleanup)).toBe(4);
  });

  it("keeps previous reach when editing history without changing stage output", async () => {
    const exported = await enterStage(withRecords([record("record_1", "Alice", "Onyx Apple")]), "export");
    const sameCleanupOutput = { ...exported, recordEdits: { ...exported.recordEdits } };

    expect(reachableStageIndex(sameCleanupOutput)).toBe(4);
  });

  it("revalidates a changed output after entering the next stage and keeps later stale stages blocked", async () => {
    const exported = await enterStage(withRecords([record("record_1", "Alice", "Onyx Apple")]), "export");
    const changedIssues = { ...exported, manualRecords: [record("record_1", "Alice", "Gelt Chocolate")] };

    expect(reachableStageIndex(changedIssues)).toBe(2);

    const reenteredCleanup = await enterStage(changedIssues, "cleanup");

    expect(reenteredCleanup.recordEdits).toEqual({});
    expect(reachableStageIndex(reenteredCleanup)).toBe(3);
  });

  it("resets cleanup output to its initial unedited state", () => {
    const session = {
      ...withRecords([record("record_1", "Alice", "Onyx Apple")]),
      recordEdits: { record_1: record("record_1", "Alicia", "Gelt Chocolate") },
      recordDrafts: { record_1: record("record_1", "Alicia", "") },
      deletedRecordIds: ["record_2"],
    };

    expect(resetRecordsOutput(session)).toMatchObject({
      recordEdits: {},
      recordDrafts: {},
      deletedRecordIds: [],
    });
  });
});

function withRecords(records: AuditRecord[]): Session {
  return {
    ...createNewSession(),
    stageInitialHashes: importAndIssueHashes,
    images: [{
      id: 1,
      fileName: "screen.png",
      createdAt: "2026-05-03T00:00:00.000Z",
      lifecycle: "active",
      checksumSha256: "abc123",
      width: 1280,
      height: 720,
      sizeBytes: 1024,
      status: "accepted",
    }],
    slices: [sliceAsset("1-1")],
    manualRecords: records,
  };
}

function record(id: string, player: string, item: string, timestamp = "[01:00:00]"): AuditRecord {
  return {
    id,
    sourceSliceId: "1-1",
    timestamp,
    player,
    item,
    source: "manual",
  };
}

function ocrRecord(record: AuditRecord): OcrResult {
  return {
    sliceId: record.sourceSliceId,
    recognitionMode: "balanced",
    status: "accepted",
    record: { ...record, source: "ocr" },
  };
}

function sliceAsset(id: SliceAsset["id"]): SliceAsset {
  return {
    id,
    imageId: 1,
    imageFileName: "screen.png",
    index: 1,
    displayId: 39,
    blobKey: `session_test/slice/${id}`,
    crop: { left: 0, top: 0, width: 100, height: 20 },
    width: 100,
    height: 20,
    prefilterStatus: "accepted",
  };
}
