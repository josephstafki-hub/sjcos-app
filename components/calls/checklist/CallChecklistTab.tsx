"use client";
import { errorCopy } from "@/lib/checklist-coverage/action-result";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { loadChecklistForCall, startChecklist, unknownCallerChoice } from "@/lib/actions/discovery-checklist";
import type { ChecklistLead } from "@/lib/actions/discovery-checklist-ui";
import { formatUsPhone } from "@/lib/comms/phone";
import { ChecklistPane, type ChecklistCallInfo } from "./ChecklistPane";
import { LeadPicker, NewLeadSheet, prefetchChecklistLeads } from "./Pickers";
import { Btn } from "./Sheet";

// The "Discovery checklist" body of a selected call (plan §6, §6.6). Viewing a
// call never creates a checklist: it shows the existing one, or Start
// checklist, or — for a number that matches nobody — the unknown-caller choices.

const NOT_LEAD_KEY = "sjcos:calls:not-lead";

function notLeadIds(): string[] {
  try { return JSON.parse(localStorage.getItem(NOT_LEAD_KEY) ?? "[]") as string[]; } catch { return []; }
}
function setNotLead(callId: string, on: boolean) {
  try {
    const ids = new Set(notLeadIds());
    if (on) ids.add(callId); else ids.delete(callId);
    localStorage.setItem(NOT_LEAD_KEY, JSON.stringify([...ids].slice(-200)));
  } catch { /* storage off: hidden for this view only */ }
}

export function CallChecklistTab({ call, leadId, linked, userId, onSessionStarted }: {
  call: ChecklistCallInfo;
  /** The lead this call is already tied to, if any. */
  leadId: string | null;
  /** The call is tied to some record (sub, vendor, project) — not an unknown number. */
  linked: boolean;
  userId: string;
  onSessionStarted?: (sessionId: string) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Keyed by call id in CallsClient, so this state starts fresh per call.
  const [hidden, setHidden] = useState(() => typeof window !== "undefined" && notLeadIds().includes(call.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [newLead, setNewLead] = useState<{ phone: string } | null>(null);

  // An unknown caller's card offers Link to a lead: have its first page ready.
  const unknown = !leadId && !linked;
  useEffect(() => { if (unknown) prefetchChecklistLeads(call.number).catch(() => undefined); }, [unknown, call.number]);

  useEffect(() => {
    let live = true;
    loadChecklistForCall(call.id).then((s) => { if (live) setSessionId(s?.session.id ?? null); }).catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [call.id, attempt]);

  // A retry of the same start reuses its operation id; starting with another
  // lead (New lead after a failed Start checklist) is a new operation.
  const startOp = useRef<{ lead: string | null; id: string } | null>(null);
  async function start(lead: string | null) {
    setBusy(true); setError(null);
    if (startOp.current?.lead !== lead) startOp.current = { lead, id: crypto.randomUUID() };
    try {
      const r = await startChecklist({ call_id: call.id, lead_id: lead, operation_id: startOp.current.id });
      if (r.ok) { setSessionId(r.session_id); onSessionStarted?.(r.session_id); }
      else setError(errorCopy(r.code));
    } catch { setError(navigator.onLine === false ? "Starting a checklist needs a connection." : "Couldn't start the checklist. Try again."); }
    finally { setBusy(false); }
  }

  async function linkLead(lead: ChecklistLead) {
    setBusy(true); setError(null);
    try {
      const r = await unknownCallerChoice({ call_id: call.id, choice: "link", lead_id: lead.id, operation_id: crypto.randomUUID() });
      if ("ok" in r && r.ok) { setPicking(false); setSessionId(r.session_id); onSessionStarted?.(r.session_id); }
      else setError("code" in r ? errorCopy(r.code) : "Couldn't link. Try again.");
    } catch { setError("Couldn't link. Try again."); }
    finally { setBusy(false); }
  }

  async function chooseNewLead() {
    setBusy(true); setError(null);
    try {
      const r = await unknownCallerChoice({ call_id: call.id, choice: "new_lead", operation_id: crypto.randomUUID() });
      if("ok" in r && !r.ok) {setError(errorCopy(r.code)); return;}
      setNewLead({ phone: ("createLead" in r ? r.createLead?.phone : null) ?? call.number });
    } catch { setNewLead({ phone: call.number }); }
    finally { setBusy(false); }
  }

  async function notLead() {
    setBusy(true);
    try { const r = await unknownCallerChoice({ call_id: call.id, choice: "not_lead", operation_id: crypto.randomUUID() }); if("ok" in r && !r.ok) {setError(errorCopy(r.code));setBusy(false);return;} } catch { setError("Couldn't save your choice. Try again.");setBusy(false);return; }
    setNotLead(call.id, true); setHidden(true); setBusy(false);
  }

  if (sessionId) return <ChecklistPane key={sessionId} sessionId={sessionId} userId={userId} call={call} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-paper-2 px-4 py-4 @2xl/page:px-5">
      {loadFailed ? (
        <p role="alert" className="flex flex-wrap items-center gap-3 text-[16px] text-flag"><AlertTriangle aria-hidden className="size-5" /> Couldn&apos;t load the checklist. <Btn onClick={() => { setLoadFailed(false); setSessionId(undefined); setAttempt((n) => n + 1); }}><RotateCw aria-hidden className="size-4" /> Retry</Btn></p>
      ) : sessionId === undefined ? (
        <p role="status" className="text-[16px] text-ink-3">Loading checklist</p>
      ) : hidden ? (
        <div className="space-y-3 text-[16px]">
          <p className="text-ink-2">Not a lead call — no checklist for this call.</p>
          <Btn onClick={() => { setNotLead(call.id, false); setHidden(false); }}>Undo</Btn>
        </div>
      ) : unknown ? (
        <section aria-labelledby={`${call.id}-unknown`} className="rounded-lg border border-rule bg-card p-4">
          <h2 id={`${call.id}-unknown`} className="font-serif text-[20px] font-semibold leading-7 text-ink">Unknown caller — <span className="whitespace-nowrap">{formatUsPhone(call.number)}</span></h2>
          {/* A new prospect is the main discovery call: tick first, link the lead
              after (plan §4.2 — the checklist starts with Lead: Link later). */}
          <p className="mt-1 text-[16px] text-ink-2">Start the checklist now and link the lead later.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => void start(null)} disabled={busy}>{busy ? "Starting…" : "Start checklist"}</Btn>
            <Btn onClick={() => { setError(null); setPicking(true); }} disabled={busy}>Link to a lead</Btn>
            <Btn onClick={() => void chooseNewLead()} disabled={busy}>New lead</Btn>
            <Btn onClick={() => void notLead()} disabled={busy}>Not a lead call</Btn>
          </div>
          {error && <p role="alert" className="mt-3 text-[15px] text-flag">{error}</p>}
        </section>
      ) : (
        <div className="space-y-3">
          <p className="text-[16px] text-ink-2">No checklist for this call yet.</p>
          <Btn kind="primary" onClick={() => void start(leadId)} disabled={busy}>{busy ? "Starting…" : "Start checklist"}</Btn>
          {error && <p role="alert" className="text-[15px] text-flag">{error}</p>}
        </div>
      )}

      {picking && <LeadPicker callNumber={call.number} busy={busy} error={error} onClose={() => setPicking(false)} onPick={(l) => void linkLead(l)} />}
      {newLead && <NewLeadSheet phone={newLead.phone} onClose={() => setNewLead(null)}
        onCreated={async (lead) => { setNewLead(null); await start(lead.id); }} />}
    </div>
  );
}
