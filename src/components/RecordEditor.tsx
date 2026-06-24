import { useRef } from "react";
import { SUGGESTED_BUFF_ITEM_NAMES } from "../cider";
import type { AuditRecord } from "../types";
import { TimestampInput } from "./TimestampInput";

type Props = { record: AuditRecord; onChange: (record: AuditRecord) => void; playerSuggestions: string[] };

export function RecordEditor({ record, onChange, playerSuggestions }: Props) {
  const datalistId = `players-${record.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const itemDatalistId = `items-${record.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const itemBeforeFocus = useRef(record.item);
  return <div className="record-editor">
    <label><span>Time</span><TimestampInput value={record.timestamp} onChange={(timestamp) => onChange({ ...record, timestamp })} /></label>
    <label><span>Player / IGN</span><input list={datalistId} value={record.player} onChange={(e) => onChange({ ...record, player: e.target.value })} /><datalist id={datalistId}>{playerSuggestions.map((name) => <option key={name} value={name} />)}</datalist></label>
    <label><span>Item</span><input list={itemDatalistId} value={record.item} onFocus={() => { itemBeforeFocus.current = record.item; onChange({ ...record, item: "" }); }} onBlur={() => { if (!record.item) onChange({ ...record, item: itemBeforeFocus.current }); }} onChange={(e) => onChange({ ...record, item: e.target.value })} /><datalist id={itemDatalistId}>{SUGGESTED_BUFF_ITEM_NAMES.map((item) => <option key={item} value={item} />)}</datalist></label>
  </div>;
}
