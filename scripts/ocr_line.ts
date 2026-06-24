#!/usr/bin/env tsx
import path from "node:path";
import sharp from "sharp";
import { decodeAppleOcrImage } from "../src/cider/ocr.ts";
import type { AppleOcrResult } from "../src/cider/types.ts";
import type { RgbaImage } from "../src/cider/glyph-decoder/preprocess.ts";

type Options = {
  debug: boolean;
  json: boolean;
  paths: string[];
};

type OutputResult = AppleOcrResult & {
  path: string;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    debug: false,
    json: false,
    paths: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--debug") {
      opts.debug = true;
      continue;
    }
    if (arg === "--json") {
      opts.json = true;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    opts.paths.push(arg);
  }

  if (opts.paths.length === 0) throw new Error("missing input PNG path");
  return opts;
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/ocr_line.ts [--json] [--debug] <line.png>...

Decode one or more Maple line PNG slices with the Apple OCR pipeline.

Examples:
  tsx scripts/ocr_line.ts data/tests/examples/apple.png
  tsx scripts/ocr_line.ts data/tests/cleartype-bgr/line-03.png data/tests/cleartype-bgr/line-04.png
  tsx scripts/ocr_line.ts --json data/tests/examples/apple.png`);
}

async function readPngRgba(imagePath: string): Promise<RgbaImage> {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data,
  };
}

function printTextResult(result: OutputResult): void {
  if (result.ok) {
    console.log(result.text);
    return;
  }

  const suffix = result.text ? `: ${result.text}` : "";
  console.error(`${result.path}: rejected: ${result.reason}${suffix}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const results: OutputResult[] = [];
  let failed = false;

  for (const inputPath of opts.paths) {
    const imagePath = path.resolve(inputPath);
    try {
      const image = await readPngRgba(imagePath);
      const result = decodeAppleOcrImage(inputPath, image, { debug: opts.debug });
      results.push({ ...result, path: inputPath });
      if (!result.ok) failed = true;
      if (!opts.json) printTextResult({ ...result, path: inputPath });
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      if (opts.json) {
        results.push({
          id: inputPath,
          path: inputPath,
          ok: false,
          reason: "ocr_error",
          text: message,
        });
      } else {
        console.error(`${inputPath}: ${message}`);
      }
    }
  }

  if (opts.json) console.log(JSON.stringify(results, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
