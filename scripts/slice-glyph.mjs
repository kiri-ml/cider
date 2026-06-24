import { mkdir, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glyphDir = path.join(rootDir, "data/glyphs");
const detectorBundle = path.join(os.tmpdir(), `cider-detector-${process.pid}.mjs`);
const linesPerScreenshot = 32;
const sliceWidth = 100;

function parseArgs(argv) {
  const args = {
    glyphSet: "all",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--glyph-set") {
      const value = argv[++i];
      if (!value) throw new Error("--glyph-set requires a value");
      args.glyphSet = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return args;
}

function glyphSetDirs(glyphSet) {
  const sets = [
    ["rgb", "cleartype-rgb"],
    ["bgr", "cleartype-bgr"],
  ];

  if (glyphSet === "all") return sets.map(([, dirName]) => glyphSetDir(dirName));

  const match = sets.find(([name, dirName]) => glyphSet === name || glyphSet === dirName);
  if (match) return [glyphSetDir(match[1])];

  throw new Error(`unknown glyph set: ${glyphSet}`);
}

function glyphSetDir(dirName) {
  const setDir = path.join(glyphDir, dirName);
  return {
    name: dirName,
    inputDir: path.join(setDir, "screenshots"),
    outputDir: path.join(setDir, "slices"),
  };
}

function asciiBaseFromFileName(fileName) {
  const match = /^glyphs_(\d+)\.png$/i.exec(fileName);
  if (!match) throw new Error(`unexpected glyph screenshot filename: ${fileName}`);
  return Number(match[1]);
}

const { glyphSet } = parseArgs(process.argv.slice(2));
const targets = glyphSetDirs(glyphSet);

await esbuild.build({
  entryPoints: [path.join(rootDir, "src/cider/detector.ts")],
  outfile: detectorBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});

const { chatLineRects, detectMapleClientFrame } = await import(pathToFileURL(detectorBundle).href);
await unlink(detectorBundle).catch((err) => {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return;
  throw err;
});

let written = 0;
let screenshotCount = 0;

for (const { name, inputDir, outputDir } of targets) {
  await mkdir(outputDir, { recursive: true });
  const existingSlices = await readdir(outputDir);

  await Promise.all(
    existingSlices
      .filter((sliceName) => /^glyph_.*\.png$/i.test(sliceName))
      .map((sliceName) => unlink(path.join(outputDir, sliceName))),
  );

  const files = (await readdir(inputDir))
    .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
    .sort((a, b) => asciiBaseFromFileName(a) - asciiBaseFromFileName(b));

  for (const fileName of files) {
    const asciiBase = asciiBaseFromFileName(fileName);
    const inputPath = path.join(inputDir, fileName);
    const image = sharp(inputPath);
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const frame = detectMapleClientFrame(data, info.width, info.height);
    if (!frame) {
      throw new Error(`Could not detect Maple client frame in ${name}/${fileName}`);
    }

    const rects = chatLineRects(frame, linesPerScreenshot);
    if (rects.length !== linesPerScreenshot) {
      throw new Error(`Expected ${linesPerScreenshot} slices in ${name}/${fileName}, found ${rects.length}`);
    }

    for (const rect of rects) {
      const asciiCode = asciiBase + rect.index;
      const outputPath = path.join(outputDir, `glyph_${asciiCode}.png`);
      await sharp(inputPath)
        .extract({
          left: Math.max(0, rect.left),
          top: Math.max(0, rect.top),
          width: sliceWidth,
          height: rect.height,
        })
        .png()
        .toFile(outputPath);
      written += 1;
    }

    screenshotCount += 1;
  }
}

console.log(`Wrote ${written} slices from ${screenshotCount} screenshots`);
