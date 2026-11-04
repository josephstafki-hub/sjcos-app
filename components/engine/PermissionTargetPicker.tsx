"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { searchPermissionRecords, type PermissionRecord } from "@/lib/actions/permission-records";

export function PermissionTargetPicker({ action, onPick }: { action: string; onPick: (record: PermissionRecord | null) => void }) {
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<PermissionRecord[]>([]);
  const [selected, setSelected] = useState<PermissionRecord | null>(null);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();
  return <div className="@xl/page:col-span-2">
    <label htmlFor="permission-search" className="text-label font-medium text-ink-2">Choose a record or recipient</label>
    <div className="mt-1 flex gap-2">
      <input id="permission-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, project, recipient or title" className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-2 text-body" onKeyDown={(e) => { if(e.key === 'Enter') {e.preventDefault(); e.currentTarget.form?.querySelector<HTMLButtonElement>('[data-record-search]')?.click();} }} />
      <Button type="button" variant="secondary" data-record-search disabled={pending} onClick={() => start(async () => {
        const result = await searchPermissionRecords(action, search);
        setRecords(result.records); setError(result.error ?? ""); setSearched(true);
      })}>{pending ? "Searching…" : "Search"}</Button>
    </div>
    <p className="mt-1 text-meta text-ink-2">Search with no text to browse up to 40 records. Refine the search to find more.</p>
    {error && <p role="alert" className="mt-2 text-body text-flag">{error}</p>}
    {searched && !error && !records.length && <p className="mt-2 text-body text-ink-2">No matching records. Try a different name or create the record first.</p>}
    <div className="mt-2 max-h-60 overflow-y-auto divide-y divide-rule-soft">
      {records.map((record) => <label key={`${record.id}:${record.label}`} className={`flex cursor-pointer items-start gap-2 rounded-md p-2 text-body ${selected?.id === record.id ? 'bg-selected' : 'hover:bg-hover'}`}>
        <input type="radio" name="permission_record" checked={selected?.id === record.id && selected?.label === record.label} onChange={() => {setSelected(record); onPick(record);}} className="mt-1" />
        <span className="min-w-0 break-words">{record.label}</span>
      </label>)}
    </div>
    <input type="hidden" name="target_id" value={selected?.id ?? ""} />
  </div>;
}
