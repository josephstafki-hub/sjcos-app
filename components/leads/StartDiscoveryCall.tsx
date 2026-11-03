"use client";
import { errorCopy } from "@/lib/checklist-coverage/action-result";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { discoveryCallConfirmData, startDiscoveryCall } from "@/lib/actions/discovery-checklist";
import { checklistLeadBySlug } from "@/lib/actions/discovery-checklist-ui";
import { formatUsPhone } from "@/lib/comms/phone";
import { Btn, Sheet } from "@/components/calls/checklist/Sheet";

// "Start a discovery call" on the lead page (plan §4.1 item 2, §6.2). The
// confirm sheet offers Call now (owner: the existing exact-number click-to-call)
// or Checklist only — a hand-ticked checklist linked to this lead, for a call
// Joe makes from his own cell. Cancel does nothing.

type Confirm = { id: string; name: string; phone: string | null; explanation: string };

function firstName(name: string): string {
  return name.split(/\s+|&/)[0] || name;
}

export function StartDiscoveryCall({ slug, isOwner, variant = "button", calling = true }: {
  slug: string; isOwner: boolean; variant?: "button" | "menu";
  /** The business number is set up. Off → no Call now (Calls says "Calling is off"). */
  calling?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<"call" | "checklist" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  // One operation per sheet: a double tap or a retry starts the same checklist.
  const opRef = useRef<string | null>(null);

  async function load(): Promise<Confirm | null> {
    setLoadError(false);
    try {
      const lead = await checklistLeadBySlug(slug);
      if (!lead) throw new Error("CHECKLIST_NOT_FOUND");
      const d = await discoveryCallConfirmData(lead.id);
      const c = { id: d.lead.id, name: d.lead.name, phone: d.lead.phone, explanation: d.explanation };
      setConfirm(c);
      return c;
    } catch { setLoadError(true); return null; }
  }

  function begin() {
    opRef.current = crypto.randomUUID();
    setError(null); setFallback(null); setOpen(true);
    void load();
  }

  async function go(checklistOnly: boolean, c: Confirm | null = confirm) {
    if (!c || busy) return;
    opRef.current ??= crypto.randomUUID();
    setBusy(checklistOnly ? "checklist" : "call"); setError(null); setFallback(null);
    try {
      const r = await startDiscoveryCall({ lead_id: c.id, operation_id: opRef.current, checklist_only: checklistOnly });
      if (!r.session.ok) { setError(errorCopy(r.session.code)); return; }
      const checklistHref = `/calls?checklist=${r.session.session_id}`;
      if (checklistOnly) { router.push(checklistHref); return; }
      if ("error" in r && r.error === "CHECKLIST_NO_PHONE") { setError("This lead has no phone number. Add one with Edit, or use Checklist only."); setFallback(checklistHref); return; }
      const call = "call" in r ? r.call : undefined;
      if (call?.ok && call.callId) { router.push(`/calls?open=${call.callId}&view=checklist`); return; }
      // The dial failed; the checklist is still there to use by hand.
      setError(call && "error" in call && call.error ? call.error : "Couldn't place the call.");
      setFallback(checklistHref);
    } catch {
      setError(navigator.onLine === false ? "This needs a connection." : "Something went wrong. Try again.");
    } finally { setBusy(null); }
  }

  async function menuStart() {
    opRef.current = crypto.randomUUID();
    const c = confirm ?? await load();
    if (c) await go(true, c);
    else setOpen(true);
  }

  const trigger = variant === "menu" ? (
    <button type="button" onClick={() => void menuStart()} disabled={!!busy}
      className="inline-flex min-h-12 w-full items-center rounded-md px-2.5 text-left text-[15px] font-semibold text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50">
      {busy ? "Starting…" : "Discovery checklist"}
    </button>
  ) : (
    <button type="button" onClick={begin}
      className="inline-flex h-8 max-sm:min-h-12 max-sm:w-full max-sm:justify-center items-center gap-1.5 rounded-md border border-ink bg-card px-2.5 text-label font-semibold text-ink hover:bg-paper-2 max-sm:text-[16px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
      <PhoneCall aria-hidden className="size-3.5" strokeWidth={1.75} /> Start a discovery call
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <Sheet layout="dialog" title="Start a discovery call" onClose={() => !busy && setOpen(false)}>
          {loadError ? (
            <p role="alert" className="text-[16px] text-flag">Couldn&apos;t load this lead. <button type="button" className="min-h-12 underline" onClick={() => void load()}>Retry</button></p>
          ) : !confirm ? (
            <p role="status" className="text-[16px] text-ink-3">Loading…</p>
          ) : (
            <div className="space-y-3">
              {/* Calling is off (no business number set up): no Call now that can't work. */}
              {isOwner && !calling ? (
                <p className="text-[16px] text-ink-2">Calling is off — call from your cell.</p>
              ) : isOwner && confirm.phone ? (
                <>
                  <p className="text-[17px] text-ink">Call {firstName(confirm.name)} at {formatUsPhone(confirm.phone)}?</p>
                  <p className="text-[16px] text-ink-2">{confirm.explanation}</p>
                </>
              ) : (
                <p className="text-[16px] text-ink-2">{!confirm.phone ? "No phone number on this lead." : `Open a discovery checklist for ${confirm.name}.`}</p>
              )}
              <div className="flex flex-col gap-2 pt-1">
                {isOwner && calling && <Btn kind="primary" onClick={() => void go(false)} disabled={!!busy || !confirm.phone}>{busy === "call" ? "Ringing your cell…" : "Call now"}</Btn>}
                <Btn kind={isOwner && calling ? "secondary" : "primary"} onClick={() => void go(true)} disabled={!!busy} className="py-2 leading-5">{busy === "checklist" ? "Starting…" : "Checklist only — I'll call from my cell"}</Btn>
                <Btn kind="ghost" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Btn>
              </div>
              {error && <p role="alert" className="text-[15px] text-flag">{error}</p>}
              {fallback && <Btn onClick={() => router.push(fallback)}>Open the checklist</Btn>}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
