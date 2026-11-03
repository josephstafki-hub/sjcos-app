"use client";
/**
 * Visit page actions (plan §6.8): Reopen (reason), Apply findings (only while automatic
 * apply is off), Try again on a failed apply (same generation, never duplicates), and the
 * office conflict picker (Pick · Pick · Enter another). Errors are data → plain words.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { W, fill, plainWords } from "@/lib/consult/ui/words";

async function command(id: string, cmd: string, input: unknown) {
  const r = await fetch(`/api/consult/${id}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Consult-CSRF": "1" }, body: JSON.stringify({ command: cmd, input }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.ok === false) throw new Error(body.error_code ?? body.code ?? "invalid_command");
  return body;
}
const field = "min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 py-2 text-[16px]";

export function ReopenButton({ id, revision }: { id: string; revision: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!open) return <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>{W.reopen}</Button>;
  return (
    <form className="grid w-full max-w-[420px] gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await command(id, "reopen", { expected_revision: revision, reason: reason.trim() }); setOpen(false); router.refresh(); } catch (x) { setErr(plainWords(x instanceof Error ? x.message : "")); } finally { setBusy(false); } }}>
      <label className="text-body font-semibold text-ink" htmlFor="reopen-why">{W.reopenReason}</label>
      <textarea id="reopen-why" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={field} autoFocus />
      {err && <p role="alert" className="text-body font-semibold text-flag">! {err}</p>}
      <div className="flex gap-2"><Button variant="secondary" size="lg" type="button" onClick={() => setOpen(false)}>{W.cancel}</Button><Button size="lg" type="submit" disabled={!reason.trim() || busy}>{W.reopen}</Button></div>
    </form>
  );
}

export function ApplyFindings({ id, generation, retry }: { id: string; generation: number; retry?: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="lg" variant={retry ? "secondary" : "primary"} disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await command(id, "apply_findings", { expected_generation: generation, operation_id: crypto.randomUUID() }); router.refresh(); } catch (x) { setErr(plainWords(x instanceof Error ? x.message : "")); } finally { setBusy(false); } }}>{retry ? W.tryAgain : W.applyFindings}</Button>
      {err && <span role="alert" className="text-body font-semibold text-flag">! {err}</span>}
    </span>
  );
}

export function OfficeConflict({ id, revision, generation, instance, fieldKey, label, current, proposed }: {
  id: string; revision: number; generation: number; instance: string; fieldKey: string; label: string;
  /** r7 R7-3: `from` names where the value came from; a side that couldn't be loaded isn't offered. */
  current: { id: string; text: string; from: string; available: boolean }; proposed: { id: string; text: string; from: string; available: boolean };
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [other, setOther] = useState(false);
  const pick = async (choice: "current" | "proposed") => {
    setBusy(true); setErr(null);
    try { await command(id, "resolve_conflict", { instance_id: instance, field_key: fieldKey, current_answer_id: current.id, proposed_answer_id: proposed.id, expected_revision: revision, generation, reason: "Picked on the visit page", choice }); router.refresh(); }
    catch (x) { setErr(plainWords(x instanceof Error ? x.message : "")); } finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label={`Conflict on ${label}`} className="mt-2 rounded-md border-2 border-flag bg-flag-soft p-3">
      <p className="text-body font-semibold text-flag">! Conflict · {label}</p>
      <p className="text-body text-ink">{W.conflictBody}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {current.available && <Button size="lg" variant="secondary" disabled={busy} onClick={() => void pick("current")}>{fill(W.pick, { value: current.text })} · {current.from}</Button>}
        {proposed.available && <Button size="lg" variant="secondary" disabled={busy} onClick={() => void pick("proposed")}>{fill(W.pick, { value: proposed.text })} · {proposed.from}</Button>}
        <Button size="lg" variant="ghost" onClick={() => setOther(true)}>{W.enterAnother}</Button>
      </div>
      {other && <p className="mt-2 text-body text-ink">Pick one of the two first, then the visitor enters the new value on the visit device — the office page doesn’t type answers.</p>}
      {err && <p role="alert" className="mt-1 text-body font-semibold text-flag">! {err}</p>}
    </div>
  );
}
