"use client";
/**
 * Schedule dialog (plan §6.9 "Schedule dialog", §5.1 step 2): who goes, date, time,
 * templates (pre-ticked from the scope register), add-ons, estimated visit length.
 * Visitor notes are included in the assigned snapshot. Owner only. POSTs the existing `schedule` command (all published
 * modules are pinned with the chosen templates). Also "Change who goes" (`assign`).
 * Errors come back as data and are shown in plain words. No stage is advanced.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { W, componentDuration, fill, plainWords, visitTiming } from "@/lib/consult/ui/words";
import type { ScheduleOptions } from "@/lib/consult/ui/server";

async function command(target: string, cmd: string, input: unknown) {
  const r = await fetch(`/api/consult/${target}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Consult-CSRF": "1" }, body: JSON.stringify({ command: cmd, input }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.ok === false) throw new Error(body.error_code ?? body.code ?? "invalid_command");
  return body;
}
function centralOffset(date: string): string {
  // America/Chicago offset on that day (−05:00 in daylight time, −06:00 otherwise).
  const probe = new Date(`${date}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const m = /GMT([+-])(\d{1,2})/.exec(name);
  return m ? `${m[1]}${m[2].padStart(2, "0")}:00` : "-06:00";
}

const box = "min-h-12 rounded-md border-2 px-3 text-left font-semibold";
function Tick({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className={`${box} ${on ? "border-accent bg-accent-soft text-ink" : "border-rule bg-card text-ink-2 hover:bg-paper-2"}`}><span aria-hidden className="mr-1.5 font-mono">{on ? "☑" : "☐"}</span>{label}</button>;
}

export function ScheduleDialog({ projectId, client, options, ownerId }: { projectId: string; client: string; options: ScheduleOptions; ownerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(ownerId);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [templates, setTemplates] = useState<string[]>(options.suggested);
  const [visitorNotes, setVisitorNotes] = useState("");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (list: string[], set: (v: string[]) => void, key: string) => set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  // §6.9: the summed length of what is ticked, in the dialog's own order; nothing when no template is ticked.
  const ordered = [...options.templates, ...options.addOns].filter((t) => templates.includes(t.key) || addOns.includes(t.key));
  const timing = visitTiming(ordered.map((t) => t.key));
  const estimate = templates.length === 0 || !timing.duration ? "" : `${fill(W.estimatedVisit, { duration: timing.duration })}${ordered.length > 1 ? ` (${ordered.map((t) => `${t.title} ${componentDuration(timing.components.find((c) => c.key === t.key)?.minutes ?? [0, 0])}`).join(" + ")})` : ""}${timing.suggestSplit && !templates.includes("whole") ? `; ${W.offerSplit}` : ""}`;
  const ready = !!who && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && templates.length > 0;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      const ids = [...options.templates, ...options.addOns].filter((t) => templates.includes(t.key) || addOns.includes(t.key)).map((t) => t.id);
      await command("new", "schedule", { project: projectId, visit_time: `${date}T${time}:00${centralOffset(date)}`, visitor: who, visitor_notes: visitorNotes, forms: [...ids, ...options.modules] });
      setOpen(false); router.refresh();
    } catch (e) { setErr(plainWords(e instanceof Error ? e.message : "")); } finally { setBusy(false); }
  };
  if (!options.templates.length) return <p className="text-body text-ink-3">No published consultation forms yet.</p>;
  return (
    <>
      <Button size="md" onClick={() => setOpen(true)} disabled={!options.captureOn} title={options.captureOn ? undefined : "In-home consultations are switched off (Settings flag consult_capture)."}>{W.schedule}</Button>
      {!options.captureOn && <p className="mt-1 text-meta text-ink-3">In-home consultations are switched off right now.</p>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="sched-h" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border-2 border-rule bg-card p-5 text-[15px] shadow-modal md:max-w-[560px] md:rounded-xl"
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            <h2 id="sched-h" className="font-serif text-title font-semibold text-ink">{fill(W.scheduleTitle, { client })}</h2>
            <div className="mt-4 grid gap-4">
              <label className="block"><span className="font-semibold text-ink">{W.whoGoes}</span>
                <select value={who} onChange={(e) => setWho(e.target.value)} className="mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 text-[16px]" autoFocus>
                  {options.visitors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.role === "owner" ? "" : " (staff)"}</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="font-semibold text-ink">{W.date}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 text-[16px]" /></label>
                <label className="block"><span className="font-semibold text-ink">{W.time}</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 text-[16px]" /></label>
              </div>
              <fieldset><legend className="font-semibold text-ink">{W.templates}</legend>
                <div className="mt-1 flex flex-wrap gap-3">{options.templates.map((t) => <Tick key={t.key} on={templates.includes(t.key)} label={t.title} onClick={() => toggle(templates, setTemplates, t.key)} />)}</div></fieldset>
              {options.addOns.length > 0 && <fieldset><legend className="font-semibold text-ink">{W.addOns}</legend>
                <div className="mt-1 flex flex-wrap gap-3">{options.addOns.map((t) => <Tick key={t.key} on={addOns.includes(t.key)} label={t.title} onClick={() => toggle(addOns, setAddOns, t.key)} />)}</div></fieldset>}
              <label className="block"><span className="font-semibold text-ink">{W.visitorNotes}</span><textarea value={visitorNotes} maxLength={8000} onChange={(e)=>setVisitorNotes(e.target.value)} aria-describedby="sched-notes-hint" className="mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 py-2 text-[16px]" /><span id="sched-notes-hint" className="mt-1 block text-meta text-ink-3">{W.visitorNotesHint}</span></label>
              {estimate && <p className="text-body text-ink" aria-live="polite">{estimate}</p>}
              {err && <p role="alert" className="font-semibold text-flag">! {err}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>{W.cancel}</Button>
              <Button size="lg" onClick={() => void submit()} disabled={!ready || busy}>{busy ? "Scheduling…" : W.schedule}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Owner move (plan §5.4, §5.7 "ask Joe to move it here"): change who goes, or keep the same
 * person and move the visit to another device. Moving away from a device that never closed
 * needs Joe's written reason — that device may still hold unsent answers (it can be
 * recovered later from the visit page). Uses the `assign` command with `missing_device_reason`.
 */
export function AssignControl({ consultId, revision, visitors, current }: { consultId: string; revision: number; visitors: { id: string; name: string; role: string }[]; current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [who, setWho] = useState(current); const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null); const [needReason, setNeedReason] = useState(false); const [busy, setBusy] = useState(false);
  if (!open) return <Button variant="secondary" size="md" onClick={() => setOpen(true)}>{W.moveTitle}</Button>;
  const same = who === current;
  const reasonRequired = same || needReason;
  const field = "mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 text-[16px] text-ink";
  const save = async () => {
    setBusy(true); setErr(null);
    try { await command(consultId, "assign", { visitor: who, expected_revision: revision, ...(reason.trim() ? { missing_device_reason: reason.trim() } : {}) }); setOpen(false); setReason(""); router.refresh(); }
    catch (e) { const code = e instanceof Error ? e.message : ""; if (code === "missing_device_manifest_required") setNeedReason(true); setErr(plainWords(code)); }
    finally { setBusy(false); }
  };
  return (
    <form className="grid w-full gap-3 rounded-md border border-rule bg-card p-3" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-labelledby={`move-h-${consultId}`}>
      <p id={`move-h-${consultId}`} className="text-body font-semibold text-ink">{W.moveTitle}</p>
      <p className="text-meta text-ink-3">{W.moveLead}</p>
      <label className="block text-body"><span className="font-semibold text-ink">{W.whoGoes}</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className={field}>{visitors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.id === current ? " — goes now" : ""}</option>)}</select></label>
      <label className="block text-body"><span className="font-semibold text-ink">{W.moveReason}{reasonRequired && <span className="text-flag" aria-label={W.required}> *</span>}</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={`${field} py-2 ${needReason && !reason.trim() ? "border-flag" : ""}`} aria-invalid={needReason && !reason.trim() ? true : undefined} /></label>
      {err && <p role="alert" className="text-body font-semibold text-flag">! {err}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="lg" type="button" onClick={() => { setOpen(false); setErr(null); setNeedReason(false); }}>{W.cancel}</Button>
        <Button size="lg" type="submit" disabled={busy || (reasonRequired && !reason.trim())}>{W.moveSave}</Button>
      </div>
    </form>
  );
}
