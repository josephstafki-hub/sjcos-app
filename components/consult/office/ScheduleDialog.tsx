"use client";
/**
 * Schedule dialog (plan §6.9 "Schedule dialog", §5.1 step 2): who goes, date, time,
 * templates (pre-ticked from the scope register), add-ons, estimated visit length.
 * Visitor notes are included in the assigned snapshot. Owner only. POSTs the existing `schedule` command (all published
 * modules are pinned with the chosen templates). Also "Change who goes" (`assign`).
 * Errors come back as data and are shown in plain words. No stage is advanced.
 */
import { RecoveryControl } from './RecoveryControl';
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { W, fill, plainWords, visitDuration } from "@/lib/consult/ui/words";
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
              <label className="block"><span className="font-semibold text-ink">Visitor notes</span><textarea value={visitorNotes} maxLength={8000} onChange={(e)=>setVisitorNotes(e.target.value)} className="mt-1 block min-h-12 w-full rounded-md border-2 border-rule bg-card px-3 text-[16px]" /></label>
              <p className="text-ink-2">{fill(W.estimatedVisit, { duration: visitDuration([...templates,...addOns]) })}</p>
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

export function AssignControl({ consultId, revision, visitors, current }: { consultId: string; revision: number; visitors: { id: string; name: string; role: string }[]; current: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false); const [who, setWho] = useState(current); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!open) return <Button variant="secondary" size="md" onClick={() => setOpen(true)}>{W.reassign}</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`who-${consultId}`}>{W.whoGoes}</label>
      <select id={`who-${consultId}`} value={who} onChange={(e) => setWho(e.target.value)} className="min-h-11 rounded-md border-2 border-rule bg-card px-2 text-[16px]">{visitors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <input aria-label="Reason for setting aside the previous device" placeholder="Set aside / move device — reason (unsent work may be missing)" value={reason} onChange={e=>setReason(e.target.value)} className="min-h-11 border px-2" />
      <Button size="md" disabled={busy || (who === current && !reason.trim())} onClick={async () => { setBusy(true); setErr(null); try { await command(consultId, "assign", { visitor: who, expected_revision: revision, ...(reason.trim() ? {missing_device_reason:reason.trim()} : {}) }); setOpen(false); router.refresh(); } catch (e) { setErr(plainWords(e instanceof Error ? e.message : "")); } finally { setBusy(false); } }}>{W.save}</Button>
      <Button variant="ghost" size="md" onClick={() => setOpen(false)}>{W.cancel}</Button>
      <RecoveryControl consultId={consultId} />
      {err && <p role="alert" className="w-full text-body font-semibold text-flag">! {err}</p>}
    </div>
  );
}
