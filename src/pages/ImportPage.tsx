import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, FolderOpen, ImagePlus, Lightbulb } from "lucide-react";
import { Layout } from "../components/Layout";
import { acceptedImages, rejectedImages } from "../session/session";
import { useSession } from "../session/useSession";
import { addFilesToSession, deleteImageFromSession } from "../session/pipeline";
import { formatScreenshotFileLabel } from "../lib/screenshotFileLabel";
import type { ImageAsset, RecognitionMode } from "../types";

export function ImportPage() {
  const { session, updateSession } = useSession();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [focusedImage, setFocusedImage] = useState<string | null>(null);
  if (!session) return null;
  const accepted = acceptedImages(session.images);
  const rejected = rejectedImages(session.images);
  const recognitionMode = session.importSettings.recognitionMode;

  function setProcessing(next: boolean) {
    busyRef.current = next;
    setBusy(next);
  }

  async function addFiles(files: File[]) {
    if (busyRef.current || files.length === 0) return;
    setProcessing(true);
    try {
      await updateSession((current) => addFilesToSession(current, files));
    }
    finally { setProcessing(false); }
  }

  async function deleteImage(image: ImageAsset) {
    if (busyRef.current) return;
    await updateSession((current) => deleteImageFromSession(current, image));
  }

  function toggleImage(imageKey: string) {
    setFocusedImage((current) => current === imageKey ? null : imageKey);
  }

  function toggleImageFromKey(event: React.KeyboardEvent, imageKey: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleImage(imageKey);
  }

  async function setRecognitionMode(mode: RecognitionMode) {
    await updateSession((current) => ({
      ...current,
      importSettings: { ...current.importSettings, recognitionMode: mode },
    }));
  }

  return <Layout title="Import" description="Import your Maple screenshots to start scanning for buff logs." stage="import" nextDisabled={accepted.length === 0 || busy} nextLabel={busy ? "Processing..." : "Next"}>
    <input ref={inputRef} className="hidden" type="file" accept="image/png,.png" multiple disabled={busy} onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
    <section
      className={`import-box ${busy ? "disabled" : ""}`}
      role="button"
      tabIndex={busy ? -1 : 0}
      onClick={() => { if (!busy) inputRef.current?.click(); }}
      onKeyDown={(event) => {
        if (busy || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        inputRef.current?.click();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (!busy) void addFiles(Array.from(e.dataTransfer.files)); }}
    >
      <div className="import-main">
        <span className="import-icon-shell"><ImagePlus aria-hidden="true" size={28} /></span>
        <div className="import-copy">
          <div className="import-picker">Add MapleLegends screenshots</div>
          <p className="import-subtitle">Drop PNG files here or click to browse.</p>
        </div>
      </div>
      <span className="toolbar import-toolbar">
        <span><CircleCheck aria-hidden="true" size={15} />Accepted <strong>{accepted.length}</strong></span>
        <span><CircleAlert aria-hidden="true" size={15} />Rejected <strong>{rejected.length}</strong></span>
      </span>
      <div className="import-detail-row">
        <div className="import-notes">
          <span className="import-hint">Use PNG files saved by in-game <kbd><span>Print</span><span>Screen</span></kbd> in <code><FolderOpen aria-hidden="true" size={15} className="import-hint-icon" />MapleLegends\Screenshots</code>.</span>
          <span className="import-hint"><Lightbulb aria-hidden="true" size={15} className="import-hint-icon" />Enable <code>DarkChat = true</code> in <code>legends.ini</code> for better results.</span>
        </div>
        <div className="import-mode-panel">
          <span className="import-mode-label">Recognition mode</span>
          <div className="segmented-control" role="group" aria-label="Recognition mode" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            {(["fast", "balanced", "best"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={recognitionMode === mode ? "selected" : ""}
                disabled={busy}
                aria-pressed={recognitionMode === mode}
                onClick={() => { void setRecognitionMode(mode); }}
              >
                {mode === "fast" ? "Fast" : mode === "balanced" ? "Balanced" : "Best"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
    <h2>Accepted Screenshots</h2>
    <div className="album-grid">{accepted.map((image) => {
      const label = formatScreenshotFileLabel(image.fileName);
      const imageKey = `accepted:${image.id}`;
      return <article key={imageKey} className={`image-card ${focusedImage === imageKey ? "focused" : ""}`} role="button" tabIndex={0} onClick={() => toggleImage(imageKey)} onKeyDown={(event) => toggleImageFromKey(event, imageKey)}>
      <div className="image-click-shell">
        <span className="image-name" title={image.fileName}>{label}</span>
        {image.url && <img src={image.url} alt={image.fileName} />}
        <span className="muted small">{image.width}×{image.height} · {(image.sizeBytes / 1024).toFixed(0)} KB</span>
      </div>
      {focusedImage === imageKey && <div className="card-details" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button className="secondary danger full" disabled={busy} onClick={() => { void deleteImage(image); }}>Delete</button></div>}
    </article>;
    })}</div>
    {accepted.length === 0 && <p className="empty">Valid Maple screenshots will appear here.</p>}
    {rejected.length > 0 && <><h2>Rejected Screenshots</h2>
    <div className="album-grid">{rejected.map((image, index) => {
      const label = formatScreenshotFileLabel(image.fileName);
      const imageKey = `rejected:${image.createdAt}:${image.fileName}:${image.sizeBytes}:${image.rejectionReason}:${index}`;
      return <article key={imageKey} className={`image-card rejected ${focusedImage === imageKey ? "focused" : ""}`} role="button" tabIndex={0} onClick={() => toggleImage(imageKey)} onKeyDown={(event) => toggleImageFromKey(event, imageKey)}>
      <div className="image-click-shell">
        <span className="image-name" title={image.fileName}>{label}</span>
        {image.url ? <img src={image.url} alt={image.fileName} /> : <span className="image-preview-placeholder">Preview unavailable</span>}
        <span className="reason">{image.rejectionReason}</span><span className="muted small">{image.width > 0 && image.height > 0 ? `${image.width}×${image.height} · ` : ""}{(image.sizeBytes / 1024).toFixed(0)} KB</span>
      </div>
      {focusedImage === imageKey && <div className="card-details" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button className="secondary danger full" disabled={busy} onClick={() => { void deleteImage(image); }}>Delete</button></div>}
    </article>;
    })}</div></>}
  </Layout>;
}
