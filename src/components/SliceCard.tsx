import type { ReactNode } from "react";
import { ArrowUpFromLine } from "lucide-react";
import type { SliceAsset } from "../types";
import { formatScreenshotFileLabel } from "../lib/screenshotFileLabel";

type Props = { slice: SliceAsset; reason?: string; showReason?: boolean; success?: boolean; warning?: boolean; expanded?: boolean; committedText?: ReactNode; footer?: ReactNode; onClick?: () => void };

export function SliceCard({ slice, reason, showReason = true, success, warning, expanded, committedText, footer, onClick }: Props) {
  const className = ["slice-card", success ? "success" : "", warning ? "warning" : "", expanded ? "expanded" : ""].filter(Boolean).join(" ");
  const imageLabel = formatScreenshotFileLabel(slice.imageFileName);
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.();
  }
  return <article className={className} role="button" tabIndex={0} onClick={onClick} onKeyDown={handleKeyDown}>
    <div className="slice-click-shell">
      <span className="slice-meta-line"><span title={slice.imageFileName}>{imageLabel} <span className="slice-number"><ArrowUpFromLine aria-hidden="true" size={14} />#{slice.displayId}</span></span>{showReason && <span className="slice-reason">{reason ?? slice.rejectionReason}</span>}</span>
      <span className="slice-image-scroll"><img src={slice.url} alt={`${slice.imageFileName} line ${slice.displayId}`} />{committedText && <span className="committed-ocr-text">{committedText}</span>}</span>
    </div>
    {footer && <div className="card-details" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{footer}</div>}
  </article>;
}
