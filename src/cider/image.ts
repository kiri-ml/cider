import { MAX_IMAGE_BYTES } from "./constants";
import { canvasToPngBlob, closeBitmap, createCanvas, getCanvasContext, loadBitmap } from "./canvas";
import { chatLineRects, detectMapleClientFrame } from "./detector";
import type {
  ChatLineCropOptions,
  ChatLineCropResult,
  CiderImageOptions,
  CropSliceOptions,
  CropSliceResult,
  FullImageAnalysis,
  LoadedFullImage,
  Rect,
} from "./types";

export function isPngFile(file: File): boolean {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

export function validatePngFile(file: File, maxBytes = MAX_IMAGE_BYTES): void {
  if (!isPngFile(file)) {
    throw new Error(`${file.name} is not a PNG file`);
  }

  if (file.size > maxBytes) {
    throw new Error(`${file.name} is larger than ${formatBytes(maxBytes)}`);
  }
}

export async function readFullImage(file: File, options: CiderImageOptions = {}): Promise<LoadedFullImage> {
  validatePngFile(file, options.maxBytes);

  let bitmap: ImageBitmap | HTMLImageElement | undefined;
  try {
    bitmap = await loadBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = createCanvas(width, height);
    const context = getCanvasContext(canvas, { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);

    const pixels = context.getImageData(0, 0, width, height).data;
    const frame = detectMapleClientFrame(pixels, width, height);
    const lineRects = frame ? chatLineRects(frame, options.lineCount ?? 10) : [];

    return {
      id: options.id ?? createSourceId(file),
      name: file.name,
      size: { width, height },
      ok: frame !== null,
      frame,
      lineRects,
      reason: frame ? undefined : "no_client_frame",
      file,
      canvas,
      context,
      pixels,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read PNG image";
    throw new Error(message);
  } finally {
    closeBitmap(bitmap);
  }
}

export async function analyzeFullImage(file: File, options: CiderImageOptions = {}): Promise<FullImageAnalysis> {
  try {
    const image = await readFullImage(file, options);
    return stripRuntimeImageFields(image);
  } catch (error) {
    return {
      id: options.id ?? createSourceId(file),
      name: file.name,
      size: { width: 0, height: 0 },
      ok: false,
      frame: null,
      lineRects: [],
      reason: error instanceof Error && error.message.includes("not a PNG") ? "not_png" : "decode_error",
    };
  }
}

export async function cropSlice(
  image: LoadedFullImage,
  rect: Rect,
  options: CropSliceOptions = {},
): Promise<CropSliceResult> {
  const safeRect = normalizeRect(rect);
  const canvas = createCanvas(safeRect.width, safeRect.height);
  const context = getCanvasContext(canvas);

  context.fillStyle = "#000000";
  context.fillRect(0, 0, safeRect.width, safeRect.height);

  const sourceLeft = Math.max(0, safeRect.left);
  const sourceTop = Math.max(0, safeRect.top);
  const sourceRight = Math.min(image.size.width, safeRect.left + safeRect.width);
  const sourceBottom = Math.min(image.size.height, safeRect.top + safeRect.height);
  const sourceCropWidth = sourceRight - sourceLeft;
  const sourceCropHeight = sourceBottom - sourceTop;

  if (sourceCropWidth > 0 && sourceCropHeight > 0) {
    const imageData = image.context.getImageData(sourceLeft, sourceTop, sourceCropWidth, sourceCropHeight);
    context.putImageData(imageData, sourceLeft - safeRect.left, sourceTop - safeRect.top);
  }

  const blob = await canvasToPngBlob(canvas);
  const lineSuffix = options.lineIndex === undefined ? "slice" : `line-${String(options.lineIndex + 1).padStart(2, "0")}`;
  const name = options.name ?? `${stripPngExtension(options.sourceName ?? image.name)}__${lineSuffix}.png`;

  return {
    id: options.id ?? `${image.id}:${lineSuffix}`,
    name,
    blob,
    url: URL.createObjectURL(blob),
    rect: safeRect,
    width: safeRect.width,
    height: safeRect.height,
    sourceName: options.sourceName ?? image.name,
    lineIndex: options.lineIndex,
    selected: true,
  };
}

export async function cropChatLines(file: File, options: ChatLineCropOptions = {}): Promise<ChatLineCropResult> {
  const image = await readFullImage(file, options);
  const slices = await Promise.all(
    image.lineRects.map((rect) =>
      cropSlice(image, rect, {
        id: `${image.id}:${rect.index}`,
        sourceName: options.sourceName ?? file.name,
        lineIndex: rect.index,
      }),
    ),
  );

  return { image, slices };
}

export function revokeSliceUrls(slices: readonly CropSliceResult[]): void {
  for (const slice of slices) {
    URL.revokeObjectURL(slice.url);
  }
}

export function stripRuntimeImageFields(image: LoadedFullImage): FullImageAnalysis {
  return {
    id: image.id,
    name: image.name,
    size: image.size,
    ok: image.ok,
    frame: image.frame,
    lineRects: image.lineRects,
    reason: image.reason,
  };
}

export function createSourceId(file: File): string {
  return `${stripPngExtension(file.name)}:${file.size}:${file.lastModified}`;
}

export function stripPngExtension(name: string): string {
  return name.replace(/\.png$/i, "");
}

function normalizeRect(rect: Rect): Rect {
  return {
    left: Math.trunc(rect.left),
    top: Math.trunc(rect.top),
    width: Math.max(1, Math.trunc(rect.width)),
    height: Math.max(1, Math.trunc(rect.height)),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
