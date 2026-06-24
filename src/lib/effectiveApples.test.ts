import { describe, expect, it } from "vitest";
import type { AuditRecord } from "../types";
import { formatEffectiveApples, itemEffectiveAppleWeight, summarizeEffectiveApples, summarizeEffectiveApplesForView } from "./effectiveApples";

function record(timestamp: string, item: string): AuditRecord {
  return {
    id: `${timestamp}-${item}`,
    sourceSliceId: "1-1",
    timestamp: `[${timestamp}]`,
    player: "Alice",
    item,
    source: "manual",
  };
}

describe("effective apple usage", () => {
  it("deducts overwritten apple duration", () => {
    const summary = summarizeEffectiveApples([
      record("00:00:00", "Onyx Apple"),
      record("00:05:00", "Onyx Apple"),
    ]);

    expect(formatEffectiveApples(summary.effectiveApples)).toBe("1.50");
    expect(formatEffectiveApples(summary.loggedValue)).toBe("2.00");
    expect(formatEffectiveApples(summary.overlapLoss)).toBe("0.50");
  });

  it("counts 100+ attack potions as one apple and lower attack potions as zero", () => {
    expect(itemEffectiveAppleWeight("Onyx Apple")).toBe(1);
    expect(itemEffectiveAppleWeight("Gelt Chocolate")).toBe(1);
    expect(itemEffectiveAppleWeight("Naricain's Demon Elixir")).toBe(1);
    expect(itemEffectiveAppleWeight("Heartstopper")).toBe(0);
    expect(formatEffectiveApples(summarizeEffectiveApples([record("00:00:00", "Gelt Chocolate")]).effectiveApples)).toBe("1.00");
  });

  it("scales attack potions relative to cider and apple WATT", () => {
    expect(itemEffectiveAppleWeight("Onyx Apple", "scaled")).toBe(1);
    expect(itemEffectiveAppleWeight("Gelt Chocolate", "scaled")).toBe(1.25);
    expect(itemEffectiveAppleWeight("Heartstopper", "scaled")).toBe(0.5);
    expect(itemEffectiveAppleWeight("Ssiws Cheese", "scaled")).toBe(0);
    expect(formatEffectiveApples(summarizeEffectiveApples([record("00:00:00", "Gelt Chocolate")], "scaled").effectiveApples)).toBe("1.25");
  });

  it("uses scaled weights when summarizing overlap loss", () => {
    const summary = summarizeEffectiveApples([
      record("00:00:00", "Onyx Apple"),
      record("00:05:00", "Gelt Chocolate"),
    ], "scaled");

    expect(formatEffectiveApples(summary.effectiveApples)).toBe("1.75");
    expect(formatEffectiveApples(summary.loggedValue)).toBe("2.25");
    expect(formatEffectiveApples(summary.overlapLoss)).toBe("0.50");
  });

  it("keeps hidden overwritten records in the timeline when filtering by item", () => {
    const summary = summarizeEffectiveApplesForView([
      record("00:00:00", "Onyx Apple"),
      record("00:05:00", "Gelt Chocolate"),
    ], (candidate) => candidate.item === "Onyx Apple");

    expect(formatEffectiveApples(summary.effectiveApples)).toBe("0.50");
    expect(formatEffectiveApples(summary.loggedValue)).toBe("1.00");
    expect(formatEffectiveApples(summary.overlapLoss)).toBe("0.50");
  });

  it("does not let zero-WATT items overwrite an active apple", () => {
    const summary = summarizeEffectiveApples([
      record("00:00:00", "Onyx Apple"),
      record("00:05:00", "Ssiws Cheese"),
    ]);

    expect(formatEffectiveApples(summary.effectiveApples)).toBe("1.00");
    expect(formatEffectiveApples(summary.loggedValue)).toBe("1.00");
    expect(formatEffectiveApples(summary.overlapLoss)).toBe("0.00");
    expect(summary.segments[0].activeSeconds).toBe(600);
  });

  it("ignores zero-WATT items when finding the next attack overwrite", () => {
    const summary = summarizeEffectiveApples([
      record("00:00:00", "Onyx Apple"),
      record("00:03:00", "Ssiws Cheese"),
      record("00:08:00", "Gelt Chocolate"),
    ]);

    expect(formatEffectiveApples(summary.effectiveApples)).toBe("1.80");
    expect(formatEffectiveApples(summary.loggedValue)).toBe("2.00");
    expect(formatEffectiveApples(summary.overlapLoss)).toBe("0.20");
    expect(summary.segments[0].activeSeconds).toBe(480);
  });

  it("handles midnight wrapped logs", () => {
    const summary = summarizeEffectiveApples([
      record("23:58:00", "Onyx Apple"),
      record("00:03:00", "Onyx Apple"),
    ]);

    expect(formatEffectiveApples(summary.effectiveApples)).toBe("1.50");
    expect(summary.segments[0].activeSeconds).toBe(300);
    expect(summary.segments[1].activeSeconds).toBe(600);
  });
});
