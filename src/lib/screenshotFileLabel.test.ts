import { describe, expect, it } from "vitest";
import { formatScreenshotFileLabel } from "./screenshotFileLabel";

describe("formatScreenshotFileLabel", () => {
  it("formats canonical MapleLegends screenshot filenames", () => {
    expect(formatScreenshotFileLabel("MapleLegends 26-04-2026 05-58-57.png")).toBe("26 Apr 2026 · 05:58:57");
  });

  it("keeps non-matching filenames unchanged", () => {
    expect(formatScreenshotFileLabel("screenshot.png")).toBe("screenshot.png");
  });

  it("keeps invalid parsed dates and times unchanged", () => {
    expect(formatScreenshotFileLabel("MapleLegends 26-13-2026 05-58-57.png")).toBe("MapleLegends 26-13-2026 05-58-57.png");
    expect(formatScreenshotFileLabel("MapleLegends 26-04-2026 24-58-57.png")).toBe("MapleLegends 26-04-2026 24-58-57.png");
  });

  it("requires two-digit date and time fields", () => {
    expect(formatScreenshotFileLabel("MapleLegends 6-04-2026 05-58-57.png")).toBe("MapleLegends 6-04-2026 05-58-57.png");
    expect(formatScreenshotFileLabel("MapleLegends 06-04-2026 5-58-57.png")).toBe("MapleLegends 06-04-2026 5-58-57.png");
  });
});
