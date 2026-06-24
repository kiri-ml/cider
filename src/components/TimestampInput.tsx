import { forwardRef, useMemo, useRef } from "react";

type Props = { value: string; onChange: (value: string) => void };

export function TimestampInput({ value, onChange }: Props) {
  const hhRef = useRef<HTMLInputElement | null>(null);
  const mmRef = useRef<HTMLInputElement | null>(null);
  const ssRef = useRef<HTMLInputElement | null>(null);
  const parts = useMemo(() => parseTimestamp(value), [value]);

  function emit(next: { hh: string; mm: string; ss: string }) { onChange(`[${next.hh}:${next.mm}:${next.ss}]`); }
  function update(part: "hh" | "mm" | "ss", raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    const next = { ...parts, [part]: digits };
    emit(next);
    if (digits.length === 2) {
      if (part === "hh") mmRef.current?.select();
      if (part === "mm") ssRef.current?.select();
    }
  }
  function handlePaste(raw: string) {
    const groups = raw.match(/\d{1,2}/g);
    if (!groups || groups.length < 3) return false;
    emit({ hh: groups[0].slice(0, 2).padStart(2, "0"), mm: groups[1].slice(0, 2).padStart(2, "0"), ss: groups[2].slice(0, 2).padStart(2, "0") });
    return true;
  }

  return <div className="timestamp-input">
    <TimePart ref={hhRef} value={parts.hh} placeholder="hh" max={23} onChange={(v) => update("hh", v)} onPasteText={handlePaste} />
    <span>:</span>
    <TimePart ref={mmRef} value={parts.mm} placeholder="mm" max={59} onChange={(v) => update("mm", v)} onPasteText={handlePaste} />
    <span>:</span>
    <TimePart ref={ssRef} value={parts.ss} placeholder="ss" max={59} onChange={(v) => update("ss", v)} onPasteText={handlePaste} />
  </div>;
}

type PartProps = { value: string; placeholder: string; max: number; onChange: (value: string) => void; onPasteText: (text: string) => boolean };
const TimePart = forwardRef<HTMLInputElement, PartProps>(({ value, placeholder, max, onChange, onPasteText }, ref) => {
  const invalid = value.length === 2 && Number(value) > max;
  return <input
    ref={ref}
    className={invalid ? "invalid" : ""}
    inputMode="numeric"
    maxLength={2}
    value={value}
    placeholder={placeholder}
    onChange={(event) => onChange(event.target.value)}
    onFocus={(event) => event.target.select()}
    onPaste={(event) => {
      const text = event.clipboardData.getData("text");
      if (onPasteText(text)) event.preventDefault();
    }}
  />;
});
TimePart.displayName = "TimePart";

function parseTimestamp(value: string): { hh: string; mm: string; ss: string } {
  const match = value.match(/\[?(\d{0,2}):(\d{0,2}):(\d{0,2})\]?/);
  return { hh: match?.[1] ?? "", mm: match?.[2] ?? "", ss: match?.[3] ?? "" };
}
