import { useEffect, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { useSession } from "../session/useSession";
import { exportFileName, exportMime, serializeDiscordMessages, serializeRecords } from "../lib/exporters";
import type { ExportFormat } from "../types";

const formats: { id: ExportFormat; label: string }[] = [
  { id: "plain", label: "Text" },
  { id: "discord", label: "Discord" },
  { id: "csv", label: "CSV" },
  { id: "json", label: "JSON" },
];

export function ExportPage() {
  const { session, updateSession } = useSession();
  const [downloadActive, setDownloadActive] = useState(false);
  const [copyActive, setCopyActive] = useState(false);
  const [selectedDiscordMessage, setSelectedDiscordMessage] = useState(0);
  const downloadTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (downloadTimer.current !== null) window.clearTimeout(downloadTimer.current);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);
  if (!session) return null;
  const format = session.exportFormat;
  const createdAt = session.createdAt;
  const records = session.resultsRecords;
  const effectiveAppleMode = session.effectiveAppleMode ?? "cutoff";
  const preview = serializeRecords(records, format, session.slices, effectiveAppleMode);
  const discordMessages = format === "discord" ? serializeDiscordMessages(records, effectiveAppleMode) : [];
  const selectedMessageIndex = Math.min(selectedDiscordMessage, Math.max(0, discordMessages.length - 1));
  const exportContent = format === "discord" ? discordMessages[selectedMessageIndex] ?? preview : preview;
  function pulse(setActive: (active: boolean) => void, timer: { current: number | null }) {
    setActive(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setActive(false);
      timer.current = null;
    }, 1400);
  }
  function selectFormat(nextFormat: ExportFormat) {
    setSelectedDiscordMessage(0);
    void updateSession((current) => ({ ...current, exportFormat: nextFormat }));
  }
  function download() {
    const blob = new Blob([exportContent], { type: exportMime(format) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedExportFileName(format, createdAt, selectedMessageIndex);
    a.click();
    URL.revokeObjectURL(url);
    pulse(setDownloadActive, downloadTimer);
  }
  async function copy() {
    pulse(setCopyActive, copyTimer);
    try {
      await copyToClipboard(exportContent);
    } catch {
      // Keep the click feedback even if the browser blocks clipboard access.
    }
  }
  return <Layout title="Export" description="Preview and export the final logs in your preferred format." stage="export">
    <div className="export-toolbar"><div className="format-buttons">{formats.map((item) => <button key={item.id} className={format === item.id ? "primary" : "secondary"} onClick={() => selectFormat(item.id)}>{item.label}</button>)}</div><div className="export-actions"><button type="button" className={copyActive ? "primary" : "secondary"} onClick={() => { void copy(); }}>{copyActive ? "Copied" : "Copy"}</button><button type="button" className={`export-save-button ${downloadActive ? "primary" : "secondary"}`} onClick={download}>Save</button></div></div>
    {format === "discord"
      ? <div className="export-message-list">{discordMessages.map((message, index) => <article key={index} className={`export-message-card ${selectedMessageIndex === index ? "selected" : ""}`} role="button" tabIndex={0} onClick={() => setSelectedDiscordMessage(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedDiscordMessage(index); } }}><div className="export-message-title"><span>Message {index + 1}</span><span>{message.length} chars</span></div><pre>{message}</pre></article>)}</div>
      : <pre className="export-preview">{preview}</pre>}
  </Layout>;
}

function selectedExportFileName(format: ExportFormat, createdAt: string, selectedMessageIndex: number): string {
  const fileName = exportFileName(format, createdAt);
  if (format !== "discord") return fileName;
  return fileName.replace(/\.txt$/, `-message-${selectedMessageIndex + 1}.txt`);
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
