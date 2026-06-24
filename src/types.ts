import type { ClientFrame, Rect } from "./cider";

export type StageId = "import" | "issues" | "cleanup" | "results" | "export";
export type ExportFormat = "json" | "csv" | "plain" | "discord";
export type RecognitionMode = "fast" | "balanced" | "best";
export type EffectiveAppleMode = "cutoff" | "scaled";

export type ImportSettings = {
  recognitionMode: RecognitionMode;
};

export type UserFacingRejectionReason =
  | "Unsupported file type"
  | "Image is too large"
  | "Could not read image"
  | "Not a Maple screenshot"
  | "Duplicate screenshot"
  | "Could not read timestamp"
  | "Could not read player name"
  | "Could not read item name"
  | "No buff log detected"
  | "Could not read text";

type BaseImageAsset = {
  fileName: string;
  createdAt: string;
  url?: string;
  width: number;
  height: number;
  sizeBytes: number;
  frame?: ClientFrame | null;
};

export type AcceptedImageAsset = BaseImageAsset & {
  status: "accepted";
  id: number;
  lifecycle: "active" | "removed";
  thumbnailBlobKey?: string;
  checksumSha256: string;
  rejectionReason?: never;
};

export type RejectedImageAsset = BaseImageAsset & {
  status: "rejected";
  rejectionReason: UserFacingRejectionReason;
  id?: never;
  lifecycle?: never;
  thumbnailBlobKey?: never;
  checksumSha256?: never;
};

export type ImageAsset = AcceptedImageAsset | RejectedImageAsset;

export type SliceAsset = {
  id: `${number}-${number}`;
  imageId: number;
  imageFileName: string;
  index: number;
  displayId: number;
  blobKey: string;
  url?: string;
  crop: Rect;
  width: number;
  height: number;
  prefilterStatus: "accepted" | "rejected";
  rejectionReason?: UserFacingRejectionReason;
};

export type OcrResult = {
  sliceId: SliceAsset["id"];
  recognitionMode: RecognitionMode;
  status: "accepted" | "rejected" | "failed";
  rejectionReason?: UserFacingRejectionReason;
  record?: AuditRecord;
};

export type AuditRecord = {
  id: string;
  sourceSliceId: SliceAsset["id"];
  timestamp: string;
  player: string;
  item: string;
  source: "ocr" | "manual";
};

export type Session = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentStage: StageId;
  stageInitialHashes: Partial<Record<StageId, string>>;
  stageOutputHashes: Partial<Record<StageId, string>>;
  nextImageId: number;
  images: ImageAsset[];
  slices: SliceAsset[];
  ocrResults: OcrResult[];
  importSettings: ImportSettings;
  manualRecords: AuditRecord[];
  manualDrafts: Record<string, AuditRecord>;
  recordEdits: Record<string, AuditRecord>;
  recordDrafts: Record<string, AuditRecord>;
  deletedRecordIds: string[];
  resultsRecords: AuditRecord[];
  effectiveAppleMode: EffectiveAppleMode;
  exportFormat: ExportFormat;
};

export type RuntimeSession = Session;
