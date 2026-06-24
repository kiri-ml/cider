import type { RgbaImage, SoftEvidenceMode } from "./glyph-decoder/preprocess";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

export interface IndexedRect extends Rect {
  index: number;
}

export interface ClientFrame extends Rect {
  right: number;
  bottom: number;
  adjustment: number;
  clientSize: string;
}

export interface FullImageAnalysis {
  id: string;
  name: string;
  size: Size;
  ok: boolean;
  frame: ClientFrame | null;
  lineRects: IndexedRect[];
  reason?: "not_png" | "too_large" | "decode_error" | "no_client_frame";
}

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface LoadedFullImage extends FullImageAnalysis {
  file: File;
  canvas: AnyCanvas;
  context: AnyCanvasContext;
  pixels: Uint8ClampedArray;
}

export interface CiderImageOptions {
  maxBytes?: number;
  lineCount?: number;
  id?: string;
}

export interface CropSliceOptions {
  id?: string;
  name?: string;
  sourceName?: string;
  lineIndex?: number;
}

export interface CropSliceResult {
  id: string;
  name: string;
  blob: Blob;
  url: string;
  rect: Rect;
  width: number;
  height: number;
  sourceName?: string;
  lineIndex?: number;
  selected: boolean;
}

export interface ChatLineCropOptions extends CiderImageOptions {
  sourceName?: string;
}

export interface ChatLineCropResult {
  image: LoadedFullImage;
  slices: CropSliceResult[];
}

export interface AppleOcrSliceInput {
  id: string;
  image: RgbaImage;
}

export type AppleOcrRejectReason =
  | "not_apple_log"
  | "bad_timestamp"
  | "bad_player_name"
  | "bad_item_name"
  | "ocr_error";

export interface AppleOcrDebug {
  ts?: string;
  msg?: string;
  tsScore?: number;
  msgScore?: number;
  structScore?: number;
  itemScore?: number;
  itemAlt?: string[];
}

export interface AppleOcrResult {
  id: string;
  ok: boolean;
  time?: string;
  player?: string;
  item?: string;
  text?: string;
  score?: number;
  reason?: AppleOcrRejectReason;
  debug?: AppleOcrDebug;
}

export interface AppleOcrResponse {
  v: 1;
  results: AppleOcrResult[];
  summary?: {
    total: number;
    ok: number;
    rejected: number;
    errors: number;
  };
}

export interface AppleOcrOptions {
  debug?: boolean;
  evidenceMode?: SoftEvidenceMode;
}
