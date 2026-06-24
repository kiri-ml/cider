import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { RgbaImage } from "./glyph-decoder/preprocess";
import { imageFromTintedAtlasText } from "./glyph-decoder/test-utils";
import { decodeAppleOcrImage, recognizeAppleOcr } from "./ocr";

describe("decodeAppleOcrImage", () => {
  const examples = [
    {
      file: "apple.png",
      expected: "[14:13:21]Shedinja used Onyx Apple",
      time: "14:13:21",
      player: "Shedinja",
      item: "Onyx Apple",
    },
    {
      file: "choco.png",
      expected: "[14:14:09]Peke used Gelt Chocolate",
      time: "14:14:09",
      player: "Peke",
      item: "Gelt Chocolate",
    },
    {
      file: "cheese.png",
      expected: "[14:35:00]qwertylL used Ssiws Cheese",
      time: "14:35:00",
      player: "qwertylL",
      item: "Ssiws Cheese",
    },
    {
      file: "apple_noisy.png",
      expected: "[14:54:40]JoJoni used Onyx Apple",
      time: "14:54:40",
      player: "JoJoni",
      item: "Onyx Apple",
    },
    {
      file: "apple_digit.png",
      expected: "[14:24:16]Legoshi420 used Onyx Apple",
      time: "14:24:16",
      player: "Legoshi420",
      item: "Onyx Apple",
    },
  ];

  it.each(examples)("decodes example OCR fixture $file", async ({ file, expected, time, player, item }) => {
    const result = decodeAppleOcrImage("line-1", await readPngRgba(`data/tests/examples/${file}`), { debug: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ${file} to decode, got ${result.reason}`);
    expect(result).toMatchObject({
      id: "line-1",
      time,
      player,
      item,
    });
    expect(result.text).toBe(expected);
    expect(result.debug).toMatchObject({
      ts: `[${time}]`,
      msg: `${player} used ${item}`,
    });
  });

  it.each([
    {
      file: "line-03.png",
      expected: "[01:06:14]Dill used Onyx Apple",
      time: "01:06:14",
      player: "Dill",
      item: "Onyx Apple",
    },
    {
      file: "line-04.png",
      expected: "[01:06:14]Regretful used Onyx Apple",
      time: "01:06:14",
      player: "Regretful",
      item: "Onyx Apple",
    },
    {
      file: "line-05.png",
      expected: "[01:06:15]mellovv used Onyx Apple",
      time: "01:06:15",
      player: "mellovv",
      item: "Onyx Apple",
    },
    {
      file: "line-07.png",
      expected: "[01:06:16]FF12 used Onyx Apple",
      time: "01:06:16",
      player: "FF12",
      item: "Onyx Apple",
    },
    {
      file: "line-18.png",
      expected: "[01:06:33]Vivachel used Onyx Apple",
      time: "01:06:33",
      player: "Vivachel",
      item: "Onyx Apple",
    },
  ])("auto-detects and decodes ClearType BGR OCR fixture $file", async ({ file, expected, time, player, item }) => {
    const result = decodeAppleOcrImage(file, await readPngRgba(`data/tests/cleartype-bgr/${file}`), { debug: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ${file} to decode, got ${result.reason}`);
    expect(result).toMatchObject({
      id: file,
      time,
      player,
      item,
      text: expected,
    });
    expect(result.debug).toMatchObject({
      ts: `[${time}]`,
      msg: `${player} used ${item}`,
    });
  });

  it.each([
    {
      file: "light-1.png",
      expected: "[15:01:19]Beizhuanz used Onyx Apple",
      time: "15:01:19",
      player: "Beizhuanz",
      item: "Onyx Apple",
    },
    {
      file: "light-2.png",
      expected: "[14:45:42]Socoli used Onyx Apple",
      time: "14:45:42",
      player: "Socoli",
      item: "Onyx Apple",
    },
    {
      file: "light-3.png",
      expected: "[14:28:04]PalyChi used Onyx Apple",
      time: "14:28:04",
      player: "PalyChi",
      item: "Onyx Apple",
    },
    {
      file: "light-4.png",
      expected: "[14:04:41]Hali used Onyx Apple",
      time: "14:04:41",
      player: "Hali",
      item: "Onyx Apple",
    },
    {
      file: "light-5.png",
      expected: "[14:37:47]Viona used Gelt Chocolate",
      time: "14:37:47",
      player: "Viona",
      item: "Gelt Chocolate",
    },
    {
      file: "light-6.png",
      expected: "[14:46:43]qwertylL used Ssiws Cheese",
      time: "14:46:43",
      player: "qwertylL",
      item: "Ssiws Cheese",
    },
    {
      file: "light-7.png",
      expected: "[14:04:45]Peke used Onyx Apple",
      time: "14:04:45",
      player: "Peke",
      item: "Onyx Apple",
    },
    {
      file: "light-8.png",
      expected: "[14:04:41]Riro used Onyx Apple",
      time: "14:04:41",
      player: "Riro",
      item: "Onyx Apple",
    },
    {
      file: "light-9.png",
      expected: "[14:35:22]Socoli used Onyx Apple",
      time: "14:35:22",
      player: "Socoli",
      item: "Onyx Apple",
    },
    {
      file: "light-10.png",
      expected: "[14:42:42]Riro used Onyx Apple",
      time: "14:42:42",
      player: "Riro",
      item: "Onyx Apple",
    },
    {
      file: "light-11.png",
      expected: "[16:08:02]FF10 used Onyx Apple",
      time: "16:08:02",
      player: "FF10",
      item: "Onyx Apple",
    },
    {
      file: "light-12.png",
      expected: "[16:06:17]Sexiest used Onyx Apple",
      time: "16:06:17",
      player: "Sexiest",
      item: "Onyx Apple",
    },
    {
      file: "light-13.png",
      expected: "[16:20:33]Vooyager used Onyx Apple",
      time: "16:20:33",
      player: "Vooyager",
      item: "Onyx Apple",
    },
    {
      file: "light-14.png",
      expected: "[00:44:12]Single used Onyx Apple",
      time: "00:44:12",
      player: "Single",
      item: "Onyx Apple",
    },
    {
      file: "light-15.png",
      expected: "[01:00:52]Narelion used Ssiws Cheese",
      time: "01:00:52",
      player: "Narelion",
      item: "Ssiws Cheese",
    },
    {
      file: "light-16.png",
      expected: "[01:09:44]Narelion used Ssiws Cheese",
      time: "01:09:44",
      player: "Narelion",
      item: "Ssiws Cheese",
    },
    {
      file: "light-17.png",
      expected: "[00:16:23]Goth used Onyx Apple",
      time: "00:16:23",
      player: "Goth",
      item: "Onyx Apple",
    },
    {
      file: "light-18.png",
      expected: "[00:36:24]Goth used Onyx Apple",
      time: "00:36:24",
      player: "Goth",
      item: "Onyx Apple",
    },
  ])("decodes light OCR fixture $file", async ({ file, expected, time, player, item }) => {
    const result = decodeAppleOcrImage(file, await readPngRgba(`data/tests/light/${file}`), { debug: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ${file} to decode, got ${result.reason}`);
    expect(result).toMatchObject({
      id: file,
      time,
      player,
      item,
      text: expected,
    });
    expect(result.debug).toMatchObject({
      ts: `[${time}]`,
      msg: `${player} used ${item}`,
    });
  });

  it("rejects non-apple job advancement fixture", async () => {
    const result = decodeAppleOcrImage("line-1", await readPngRgba("data/tests/examples/job.png"));

    expect(result).toMatchObject({
      id: "line-1",
      ok: false,
      reason: "bad_timestamp",
    });
  });

  it("rejects invalid timestamp ranges", () => {
    const result = decodeAppleOcrImage("line-1", imageFromTintedAtlasText("[24:02:03]Alice used Onyx Apple"));

    expect(result).toMatchObject({
      id: "line-1",
      ok: false,
      reason: "bad_timestamp",
      text: "[24:02:03]",
    });
  });

  it("rejects decoded body text without the used anchor", () => {
    const result = decodeAppleOcrImage("line-1", imageFromTintedAtlasText("[01:02:03]123456"));

    expect(result).toMatchObject({
      id: "line-1",
      ok: false,
      reason: "not_apple_log",
      time: "01:02:03",
      text: "[01:02:03]12345",
    });
  });

  it("decodes player text through the buff message decoder", () => {
    // Real buff logs are structured: valid player names are single words, so
    // the buff decoder optimistically treats the first " used " token as the boundary.
    const result = decodeAppleOcrImage(
      "line-1",
      imageFromTintedAtlasText("[01:02:03]Alice Bob used Onyx Apple"),
    );

    expect(result).toMatchObject({
      id: "line-1",
      ok: true,
      time: "01:02:03",
      item: "Onyx Apple",
    });
  });

  it("decodes Grandma's Pumpkin Pie from the default buff item tokens", () => {
    const result = decodeAppleOcrImage(
      "line-1",
      imageFromTintedAtlasText("[01:02:03]Alice used Grandma's Pumpkin Pie"),
      { debug: true },
    );

    expect(result).toMatchObject({
      id: "line-1",
      ok: true,
      time: "01:02:03",
      player: "Alice",
      item: "Grandma's Pumpkin Pie",
      text: "[01:02:03]Alice used Grandma's Pumpkin Pie",
    });
    expect(result.debug).toMatchObject({
      ts: "[01:02:03]",
      msg: "Alice used Grandma's Pumpkin Pie",
    });
  });

  it("rejects apple body text with an empty item name", () => {
    const result = decodeAppleOcrImage("line-1", imageFromTintedAtlasText("[01:02:03]Alice used"));

    expect(result).toMatchObject({
      id: "line-1",
      ok: false,
      reason: "bad_item_name",
      time: "01:02:03",
    });
  });

  it("maps malformed images to OCR errors", () => {
    const result = decodeAppleOcrImage("line-1", { width: 20, height: 6, data: new Uint8ClampedArray(20 * 6 * 4) });

    expect(result).toMatchObject({
      id: "line-1",
      ok: false,
      reason: "ocr_error",
    });
  });

  it("recognizes in-memory slices in input order", () => {
    const image = imageFromTintedAtlasText("[01:02:03]Alice used Onyx Apple");
    const response = recognizeAppleOcr([
      { id: "line-1", image },
      { id: "line-2", image },
    ]);

    expect(response.results.map((result) => result.id)).toEqual(["line-1", "line-2"]);
    expect(response.summary).toEqual({ total: 2, ok: 2, rejected: 0, errors: 0 });
  });
});

async function readPngRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data,
  };
}
