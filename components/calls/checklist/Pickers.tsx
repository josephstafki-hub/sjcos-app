"use client";

import { useEffect, useId, useRef, useState } from "react";
import { checklistLeadBySlug, checklistRecentCalls, type ChecklistCallOption, type ChecklistLead, type ChecklistLeadOption } from "@/lib/actions/discovery-checklist-ui";
import { createLeadFromInbox } from "@/lib/actions/leads";
import { formatUsPhone } from "@/lib/comms/phone";
import { Btn, Sheet } from "./Sheet";
import { chicagoWhen } from "./time";

// The picker's lead list comes from a GET route, not a server action: on the
// Calls page server actions run one at a time behind the checklist's own sync,
// and the first page has to be there the moment the picker opens. The empty
// search is fetched ahead (prefetchChecklistLeads) and shown at once; when
// that copy is more than a few seconds old the picker re-reads it behind the
// scenes, and making a lead here drops it, so a lead created a moment ago is
// never missing from Recent leads.
const recent = new Map<string, { at: number; leads: Promise<ChecklistLeadOption[]> }>();
const KEEP_MS = 60_000;
const FRESH_MS = 5_000;

async function fetchLeads(text: string, callNumber: string | null): Promise<ChecklistLeadOption[]> {
  const params = new URLSearchParams({ q: text });
  if (callNumber) params.set("phone", callNumber);
  const res = await fetch(`/api/calls/checklist-leads?${params}`, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`leads ${res.status}`);
  const body = (await res.json()) as { ok: boolean; leads?: ChecklistLeadOption[] };
  if (!body.ok || !body.leads) throw new Error("leads");
  return body.leads;
}

/** Start loading the picker's first page (recent leads, the caller's lead
 *  first) before Joe opens it. Safe to call on every render. */
export function prefetchChecklistLeads(callNumber: string | null, maxAge = KEEP_MS): Promise<ChecklistLeadOption[]> {
  const key = callNumber ?? "";
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.leads;
  const leads = fetchLeads("", callNumber);
  const entry = { at: Date.now(), leads };
  recent.set(key, entry);
  leads.catch(() => { if (recent.get(key) === entry) recent.delete(key); });
  return leads;
}

/** A lead was just made: the next Recent leads is read fresh. */
export function forgetChecklistLeads() {
  recent.clear();
}

/** Find a lead, then confirm the link (plan §4.2 step 2). */
export function LeadPicker({ onPick, onClose, busy, error, confirmWord = "Link", callNumber = null, onNewLead }: {
  onPick: (lead: ChecklistLeadOption) => void; onClose: () => void; busy?: boolean; error?: string | null; confirmWord?: string;
  /** Not in the list: make the lead (prefilled with the call's number) instead. */
  onNewLead?: () => void;
  /** The number on the call this checklist is for: the lead with it comes first. */
  callNumber?: string | null;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<ChecklistLeadOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<ChecklistLeadOption | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // With a mouse and keyboard the next thing Joe does is type a name, so the
  // search gets focus. On touch, focus stays on ✕: an on-screen keyboard
  // popping up would cover Recent leads.
  const [typeFirst] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches);

  useEffect(() => {
    let live = true;
    const show = (r: ChecklistLeadOption[]) => { if (live) { setResults(r); setFailed(false); } };
    const run = () => {
      if (text.trim()) { fetchLeads(text, callNumber).then(show).catch(() => { if (live) setFailed(true); }); return; }
      // The kept copy at once, then a fresh read if it's more than a few seconds old.
      const kept = prefetchChecklistLeads(callNumber);
      const fresh = prefetchChecklistLeads(callNumber, FRESH_MS);
      let freshIn = false;
      kept.then((r) => { if (!freshIn) show(r); }).catch(() => undefined);
      fresh.then((r) => { freshIn = true; show(r); }).catch(() => { if (live) setFailed(true); });
    };
    const t = setTimeout(run, text.trim() ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [text, attempt, callNumber]);

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
    <Sheet layout="dialog" title="Link to a lead" onClose={onClose} initialFocus={typeFirst ? inputRef : undefined}>
      <label htmlFor={inputId} className="text-[15px] font-semibold">Name, project or phone</label>
      <input ref={inputRef} id={inputId} type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
        className="mt-1 block min-h-12 w-full rounded-md border border-rule bg-paper px-3 text-[16px] focus-visible:outline-2 focus-visible:outline-focus" />
      <div className="mt-3" aria-live="polite">
        {failed ? <p className="text-[15px] text-flag">Couldn&apos;t load leads. <button type="button" className="min-h-12 underline" onClick={() => { recent.clear(); setAttempt((n) => n + 1); }}>Retry</button></p>
          : results === null ? <p className="text-[15px] text-ink-3">Loading leads…</p>
          : results.length === 0 ? <p className="text-[15px] text-ink-3">No leads match.</p>
          : (
            <>
              {!text.trim() && <p className="mb-2 text-[15px] text-ink-3">Recent leads</p>}
              <ul className="divide-y divide-rule-soft rounded-md border border-rule-soft">
                {results.map((l) => (
                  <li key={l.id}>
                    <button type="button" aria-label={`Link ${l.name}`} aria-describedby={`${inputId}-${l.id}`} onClick={() => setChosen(l)} className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                      <span className="text-[16px] font-semibold text-ink">{l.name}</span>
                      <span id={`${inputId}-${l.id}`} className="flex flex-wrap items-center gap-x-2 text-[14px] text-ink-3">
                        {l.on_call && <span className="rounded-full border border-ai/40 bg-ai-soft px-2 text-[13px] font-semibold leading-5 text-ai-2">On this call</span>}
                        {[l.scope, l.phone ? formatUsPhone(l.phone) : null].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
      </div>
      {error && <p role="alert" className="mt-3 text-[15px] text-flag">{error}</p>}
      {onNewLead && <Btn onClick={onNewLead} className="mt-3">New lead</Btn>}
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

/** The existing create-lead form, prefilled with the caller's number. The
 *  checklist links to the new lead when it's saved (plan §6.6). */
export function NewLeadSheet({ phone, onClose, onCreated }: { phone: string; onClose: () => void; onCreated: (lead: ChecklistLead) => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "mt-1 block min-h-12 w-full rounded-md border border-rule bg-paper px-3 text-[16px] focus-visible:outline-2 focus-visible:outline-focus";
  async function submit(form: FormData) {
    if (!String(form.get("name") ?? "").trim()) { setError("Add their name."); return; }
    setSaving(true); setError(null);
    try {
      const { slug } = await createLeadFromInbox(form);
      forgetChecklistLeads();
      const lead = slug ? await checklistLeadBySlug(slug) : null;
      if (!lead) throw new Error("no lead");
      await onCreated(lead);
    } catch { setError("Couldn't save the lead. Try again."); setSaving(false); }
  }
  return (
    <Sheet layout="dialog" title="New lead" onClose={onClose} initialFocus="input[name=name]">
      <form id="checklist-new-lead" action={(f) => void submit(f)} className="space-y-3">
        <label className="block"><span className="text-[15px] font-semibold">Name <span aria-hidden className="text-flag">*</span></span><input name="name" required autoComplete="off" className={field} /></label>
        <label className="block"><span className="text-[15px] font-semibold">Scope</span><input name="scope" placeholder="Upstairs bath remodel" className={field} /></label>
        <label className="block"><span className="text-[15px] font-semibold">Phone</span><input name="phone" type="tel" defaultValue={phone} className={field} /></label>
        <label className="block"><span className="text-[15px] font-semibold">Email</span><input name="email" type="email" className={field} /></label>
        <input type="hidden" name="source" value="Phone call" />
        {error && <p role="alert" className="text-[15px] text-flag">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" disabled={saving} className="ml-auto">{saving ? "Creating…" : "Create lead"}</Btn>
        </div>
      </form>
    </Sheet>
  );
}
