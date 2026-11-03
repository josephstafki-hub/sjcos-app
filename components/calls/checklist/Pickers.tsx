"use client";

import { useEffect, useId, useState } from "react";
import { checklistLeadSearch, checklistRecentCalls, type ChecklistCallOption, type ChecklistLead } from "@/lib/actions/discovery-checklist-ui";
import { formatUsPhone } from "@/lib/comms/phone";
import { Btn, Sheet } from "./Sheet";
import { chicagoWhen } from "./time";

/** Find a lead, then confirm the link (plan §4.2 step 2). */
export function LeadPicker({ onPick, onClose, busy, error, confirmWord = "Link" }: {
  onPick: (lead: ChecklistLead) => void; onClose: () => void; busy?: boolean; error?: string | null; confirmWord?: string;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<ChecklistLead[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<ChecklistLead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inputId = useId();

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      checklistLeadSearch(text).then((r) => { if (live) { setResults(r); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    }, text ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [text, attempt]);

  if (chosen) {
    return (
      <Sheet layout="dialog" title="Link to a lead" onClose={onClose}
        footer={<><Btn onClick={() => setChosen(null)} disabled={busy}>Cancel</Btn><Btn kind="primary" className="ml-auto" disabled={busy} onClick={() => onPick(chosen)}>{busy ? "Linking…" : confirmWord}</Btn></>}>
        <p>Link to {chosen.name}? Facts from this checklist will be saved to that lead.</p>
        {error && <p role="alert" className="mt-3 text-[15px] text-flag">{error}</p>}
      </Sheet>
    );
  }

  return (
    <Sheet layout="dialog" title="Link to a lead" onClose={onClose} initialFocus="input">
      <label htmlFor={inputId} className="text-[15px] font-semibold">Name, project or phone</label>
      <input id={inputId} type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
        className="mt-1 block min-h-12 w-full rounded-md border border-rule bg-paper px-3 text-[16px] focus-visible:outline-2 focus-visible:outline-focus" />
      <div className="mt-3" aria-live="polite">
        {failed ? <p className="text-[15px] text-flag">Couldn&apos;t load leads. <button type="button" className="min-h-12 underline" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>
          : results === null ? <p className="text-[15px] text-ink-3">Loading leads…</p>
          : results.length === 0 ? <p className="text-[15px] text-ink-3">No leads match.</p>
          : (
            <ul className="divide-y divide-rule-soft rounded-md border border-rule-soft">
              {results.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => setChosen(l)} className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                    <span className="text-[16px] font-semibold text-ink">{l.name}</span>
                    <span className="text-[14px] text-ink-3">{[l.scope, l.phone ? formatUsPhone(l.phone) : null].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Sheet>
  );
}

/** Pick one of the recent calls to tie a hand-ticked checklist to. */
export function CallPicker({ onPick, onClose, busy, error }: { onPick: (call: ChecklistCallOption) => void; onClose: () => void; busy?: boolean; error?: string | null }) {
  const [calls, setCalls] = useState<ChecklistCallOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    checklistRecentCalls().then((c) => { if (live) { setCalls(c); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);
  return (
    <Sheet layout="dialog" title="Link to a call" onClose={onClose}>
      {error && <p role="alert" className="mb-3 text-[15px] text-flag">{error}</p>}
      {failed ? <p className="text-[15px] text-flag">Couldn&apos;t load calls. <button type="button" className="min-h-12 underline" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>
        : calls === null ? <p className="text-[15px] text-ink-3">Loading calls…</p>
        : calls.length === 0 ? <p className="text-[15px] text-ink-3">No calls in the last two weeks.</p>
        : (
          <ul className="divide-y divide-rule-soft rounded-md border border-rule-soft">
            {calls.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={busy} onClick={() => onPick(c)} className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
                  <span className="text-[16px] font-semibold text-ink">{c.label === c.number ? formatUsPhone(c.number) : c.label}</span>
                  <span className="text-[14px] text-ink-3">{c.direction === "inbound" ? "Incoming" : "Outgoing"} · {chicagoWhen(c.started_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Sheet>
  );
}
