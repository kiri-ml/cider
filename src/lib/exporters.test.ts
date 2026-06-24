import { describe, expect, it } from "vitest";
import type { AuditRecord, SliceAsset } from "../types";
import { exportFileName, serializeDiscordMessages, serializeRecords } from "./exporters";

describe("serializeRecords", () => {
  it("groups plain text records by player in case-insensitive alphabetical order", () => {
    const records = [
      record("1", "bravo", "[01:00:00]", "Onyx Apple"),
      record("2", "Alice", "[01:01:00]", "Gelt Chocolate"),
      record("3", "bravo", "[01:02:00]", "Heartstopper"),
      record("4", "charlie", "[01:03:00]", "Naricain's Demon Elixir"),
    ];

    expect(serializeRecords(records, "plain")).toBe([
      "CIDER Buff Log Summary",
      "3 players · 4 items used",
      "",
      "Items used",
      "Gelt Chocolate           1",
      "Heartstopper             1",
      "Naricain's Demon Elixir  1",
      "Onyx Apple               1",
      "",
      "Effective Apples (Cutoff)",
      "Player   Uses  Apples",
      "───────  ────  ──────",
      "Alice    1     (1.00)",
      "charlie  1     (0.80)",
      "bravo    1+1   (0.20)",
      "",
      "Alice · 1 use (1.00)",
      "01:01:00 Gelt Chocolate",
      "",
      "bravo · 2 uses (0.20)",
      "01:00:00 Onyx Apple",
      "01:02:00 Heartstopper",
      "",
      "charlie · 1 use (0.80)",
      "01:03:00 Naricain's Demon Elixir",
    ].join("\n"));
  });

  it("groups Discord records with a buff log title", () => {
    const records = [
      record("1", "zed", "[01:00:00]", "Onyx Apple"),
      record("2", "Alpha", "[01:01:00]", "Gelt Chocolate"),
      record("3", "zed", "[01:02:00]", "Heartstopper"),
    ];

    const messages = [
      [
        "# [CIDER Buff Log Summary](https://cider.pages.dev)",
        "-# 2 players · 3 items used",
        "### Items used",
        "```text",
        "Gelt Chocolate  1",
        "Heartstopper    1",
        "Onyx Apple      1",
        "```",
        "### Effective Apples",
        "-# 100+ attack only; overlaps removed",
        "```text",
        "Player  Uses  Apples",
        "──────  ────  ──────",
        "Alpha   1     (1.00)",
        "zed     1+1   (0.20)",
        "```",
      ].join("\n"),
      [
        "### Alpha · 1 use (1.00)",
        "`01:01:00` Gelt Chocolate",
        "### zed · 2 uses (0.20)",
        "`01:00:00` Onyx Apple",
        "`01:02:00` Heartstopper",
      ].join("\n"),
    ];

    expect(serializeDiscordMessages(records)).toEqual(messages);
    expect(serializeRecords(records, "discord")).toBe(messages.join("\n\n"));
  });

  it("packs Discord player details into message-sized chunks", () => {
    const records = Array.from({ length: 120 }, (_, index) => record(
      String(index + 1),
      "Alice",
      "[01:00:00]",
      "Onyx Apple",
    ));

    const messages = serializeDiscordMessages(records);

    expect(messages.length).toBeGreaterThan(2);
    expect(messages[0]).toContain("# [CIDER Buff Log Summary](https://cider.pages.dev)");
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(2000);
    expect(messages.slice(1).join("\n")).not.toContain("`01:00:00` Onyx Apple\n\n###");
  });

  it("keeps empty text and Discord exports unchanged", () => {
    expect(serializeRecords([], "plain")).toBe("No buff logs found.");
    expect(serializeRecords([], "discord")).toBe("No buff logs found.");
  });

  it("counts unique records in the export summary", () => {
    const records = [
      record("1", "Alice", "[01:00:00]", "Onyx Apple"),
      record("2", "Alice", "[01:00:00]", "Onyx Apple"),
      record("3", "Bob", "[01:01:00]", "Gelt Chocolate"),
    ];

    expect(serializeRecords(records, "plain").split("\n").slice(0, 13)).toEqual([
      "CIDER Buff Log Summary",
      "2 players · 2 items used",
      "",
      "Items used",
      "Gelt Chocolate  1",
      "Onyx Apple      1",
      "",
      "Effective Apples (Cutoff)",
      "Player  Uses  Apples",
      "──────  ────  ──────",
      "Alice   2     (1.00)",
      "Bob     1     (1.00)",
      "",
    ]);
  });

  it("exports effective apples with scaled weighting when selected", () => {
    const records = [
      record("1", "Alice", "[01:00:00]", "Gelt Chocolate"),
      record("2", "Bob", "[01:01:00]", "Heartstopper"),
    ];

    expect(serializeRecords(records, "plain", [], "scaled")).toContain([
      "Effective Apples (Scaled)",
      "Player  Uses  Apples",
      "──────  ────  ──────",
      "Alice   1     (1.25)",
      "Bob     0+1   (0.05)",
    ].join("\n"));
  });

  it("splits effective apple uses into 100+ attack items and other items", () => {
    const records = [
      ...Array.from({ length: 3 }, (_, index) => record(`mixed-onyx-${index}`, "Mixed", `[01:${String(index).padStart(2, "0")}:00]`, "Onyx Apple")),
      ...Array.from({ length: 2 }, (_, index) => record(`mixed-gelt-${index}`, "Mixed", `[02:${String(index).padStart(2, "0")}:00]`, "Gelt Chocolate")),
      ...Array.from({ length: 4 }, (_, index) => record(`mixed-heart-${index}`, "Mixed", `[03:${String(index).padStart(2, "0")}:00]`, "Heartstopper")),
      ...Array.from({ length: 10 }, (_, index) => record(`cheese-${index}`, "CheeseOnly", `[04:${String(index).padStart(2, "0")}:00]`, "Ssiws Cheese")),
      ...Array.from({ length: 3 }, (_, index) => record(`high-onyx-${index}`, "HighOnly", `[05:${String(index).padStart(2, "0")}:00]`, "Onyx Apple")),
      ...Array.from({ length: 3 }, (_, index) => record(`high-gelt-${index}`, "HighOnly", `[06:${String(index).padStart(2, "0")}:00]`, "Gelt Chocolate")),
    ];

    const exportText = serializeRecords(records, "plain");

    expect(exportText).toMatch(/^Mixed\s+5\+4\s+\(/m);
    expect(exportText).toMatch(/^CheeseOnly\s+0\+10\s+\(/m);
    expect(exportText).toMatch(/^HighOnly\s+6\s+\(/m);
  });

  it("sizes the effective apple uses column to long split values", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, index) => record(`high-${index}`, "LongSplit", `[01:${String(index).padStart(2, "0")}:00]`, "Onyx Apple")),
      ...Array.from({ length: 10 }, (_, index) => record(`other-${index}`, "LongSplit", `[02:${String(index).padStart(2, "0")}:00]`, "Heartstopper")),
    ];

    expect(serializeRecords(records, "plain")).toContain([
      "Effective Apples (Cutoff)",
      "Player     Uses   Apples",
      "─────────  ─────  ──────",
      "LongSplit  10+10  (1.90)",
    ].join("\n"));
  });

  it("exports CSV records with source PNG filenames", () => {
    const records = [
      record("1", "Alice", "[01:00:00]", "Onyx Apple"),
      record("2", "Bob", "[01:01:00]", "Gelt Chocolate"),
      { ...record("3", "Charlie", "[01:02:00]", "Heartstopper"), sourceSliceId: "9-9" as const },
    ];
    const slices = [
      slice("1-1", "MapleLegends 26-04-2026 05-58-57.png", 1),
      slice("1-2", "source, with comma.png", 2),
    ];
    records[1] = { ...records[1], sourceSliceId: "1-2" };

    expect(serializeRecords(records, "csv", slices)).toBe([
      "time,player,item,source,line from bottom",
      "01:00:00,Alice,Onyx Apple,MapleLegends 26-04-2026 05-58-57.png,39",
      "01:01:00,Bob,Gelt Chocolate,\"source, with comma.png\",38",
      "01:02:00,Charlie,Heartstopper,unknown.png,",
    ].join("\n"));
  });

  it("exports JSON records with schema and source PNG filenames", () => {
    const records = [
      record("1", "Alice", "[01:00:00]", "Onyx Apple"),
      { ...record("2", "Bob", "[01:01:00]", "Gelt Chocolate"), sourceSliceId: "9-9" as const, source: "manual" as const },
    ];
    const slices = [slice("1-1", "screen.png", 1)];

    const exported = JSON.parse(serializeRecords(records, "json", slices));

    expect(exported).toEqual({
      schema: 1,
      records: [
        { timestamp: "[01:00:00]", player: "Alice", item: "Onyx Apple", source: "screen.png", lineFromBottom: 39 },
        { timestamp: "[01:01:00]", player: "Bob", item: "Gelt Chocolate", source: "unknown.png", lineFromBottom: null },
      ],
    });
    expect(JSON.stringify(exported)).not.toContain("sourceSliceId");
    expect(JSON.stringify(exported)).not.toContain("\"id\"");
    expect(JSON.stringify(exported)).not.toContain("manual");
  });
});

describe("exportFileName", () => {
  it("uses a compact local timestamp and format-specific extension", () => {
    const createdAt = new Date(2026, 4, 8, 13, 20, 0).toISOString();

    expect(exportFileName("plain", createdAt)).toBe("cider-20260508-132000.txt");
    expect(exportFileName("csv", createdAt)).toBe("cider-20260508-132000.csv");
    expect(exportFileName("json", createdAt)).toBe("cider-20260508-132000.json");
  });

  it("adds a discord suffix for Discord text exports", () => {
    const createdAt = new Date(2026, 4, 8, 13, 20, 0).toISOString();

    expect(exportFileName("discord", createdAt)).toBe("cider-20260508-132000-discord.txt");
  });
});

function record(id: string, player: string, timestamp: string, item: string): AuditRecord {
  return {
    id,
    sourceSliceId: "1-1",
    timestamp,
    player,
    item,
    source: "ocr",
  };
}

function slice(id: SliceAsset["id"], imageFileName: string, index: number): SliceAsset {
  return {
    id,
    imageId: 1,
    imageFileName,
    index,
    displayId: 40 - index,
    blobKey: `${id}.png`,
    crop: { left: 0, top: 0, width: 1, height: 1 },
    width: 1,
    height: 1,
    prefilterStatus: "accepted",
  };
}
