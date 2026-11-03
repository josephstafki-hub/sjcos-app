"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { errorCopy } from "@/lib/checklist-coverage/action-result";
import { loadDiscoveryChecklistSettings, publishDiscoveryChecklist } from "@/lib/actions/discovery-checklist";
import type { ChecklistItem } from "@/lib/checklist-coverage/contract";
import { Btn } from "@/components/calls/checklist/Sheet";

// Settings › Calls › Discovery checklist (plan §3.4). Owner only. Per row:
// label, reminder sentence, two questions, On/Off (the four extra rows),
// Reminders for this row, Move up / Move down. Save publishes a new version;
// checklists already started keep the version they started with.

export interface ChecklistSettingsData {
  definition: { id: string; current_version_id: string };
  version: { id: string; items: ChecklistItem[]; version: number };
  settings: { screen_phone: boolean; send_call_link: boolean };
  defaults: ChecklistItem[];
}

const LIMITS = { label: 40, reminder: 120, question: 160 };

type RowErrors = { label?: string; reminder?: string; questions?: string };

function validate(items: ChecklistItem[]): Record<string, RowErrors> {
  const out: Record<string, RowErrors> = {};
  for (const i of items) {
    const e: RowErrors = {};
    const label = i.label.trim(), reminder = i.reminder.trim();
    if (!label) e.label = "Add a label."; else if (label.length > LIMITS.label) e.label = `Keep it to ${LIMITS.label} characters.`;
    if (!reminder) e.reminder = "Add the reminder sentence."; else if (reminder.length > LIMITS.reminder) e.reminder = `Keep it to ${LIMITS.reminder} characters.`;
    if (i.questions.some((q) => q.length > LIMITS.question)) e.questions = `Keep each question to ${LIMITS.question} characters.`;
    if (Object.keys(e).length) out[i.id] = e;
  }
  return out;
}

function clean(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((i) => ({ ...i, label: i.label.trim(), reminder: i.reminder.trim(), questions: i.questions.map((q) => q.trim()).filter(Boolean).slice(0, 2), enabled: i.optional ? i.enabled : true }));
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`inline-flex min-h-12 min-w-20 items-center justify-center gap-2 rounded-full border px-4 text-[16px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 ${on ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink-2"}`}>
      <span aria-hidden className="font-mono">{on ? "●" : "○"}</span>{on ? "On" : "Off"}
    </button>
  );
}

function Counted({ id, label, value, max, onChange, error, multiline }: { id: string; label: string; value: string; max: number; onChange: (v: string) => void; error?: string; multiline?: boolean }) {
  const over = value.trim().length > max;
  const cls = `mt-1 block w-full rounded-md border bg-card px-3 text-[16px] leading-6 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${error || over ? "border-flag" : "border-rule"}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[15px] font-semibold text-ink">{label}</label>
        <span className={`text-[14px] tabular-nums ${over ? "font-semibold text-flag" : "text-ink-3"}`} aria-live="polite">{value.trim().length}/{max}</span>
      </div>
      {multiline
        ? <textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || over} className={`${cls} py-2.5`} />
        : <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || over} className={`${cls} min-h-12`} />}
      {error && <p className="mt-1 flex items-center gap-1.5 text-[15px] text-flag"><AlertTriangle aria-hidden className="size-4" />{error}</p>}
    </div>
  );
}

export function DiscoveryChecklistSettings({ initial }: { initial: ChecklistSettingsData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [items, setItems] = useState<ChecklistItem[]>(initial.version.items);
  const [screenPhone, setScreenPhone] = useState(initial.settings.screen_phone);
  const [sendLink, setSendLink] = useState(initial.settings.send_call_link);
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "flag"; text: string; reload?: boolean } | null>(null);
  const opRef = useRef<{ id: string; key: string } | null>(null);
  const ids = useId();

  const dirty = JSON.stringify([items, screenPhone, sendLink]) !== JSON.stringify([data.version.items, data.settings.screen_phone, data.settings.send_call_link]);

  function update(id: string, patch: Partial<ChecklistItem>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setMessage(null);
  }
  function move(index: number, by: -1 | 1) {
    setItems((list) => {
      const next = [...list];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });
    setMessage(null);
  }

  function restoreWording() {
    const byId = new Map(data.defaults.map((d) => [d.id, d]));
    setItems((list) => list.map((i) => { const d = byId.get(i.id); return d ? { ...i, label: d.label, reminder: d.reminder, questions: [...d.questions] } : i; }));
    setErrors({});
    setMessage({ tone: "ok", text: "Default wording is back. Save to keep it." });
  }

  function cancel() {
    setItems(data.version.items); setScreenPhone(data.settings.screen_phone); setSendLink(data.settings.send_call_link);
    setErrors({}); setMessage(null);
  }

  async function reloadCurrent() {
    try {
      const fresh = (await loadDiscoveryChecklistSettings()) as ChecklistSettingsData;
      setData(fresh); setItems(fresh.version.items); setScreenPhone(fresh.settings.screen_phone); setSendLink(fresh.settings.send_call_link);
      setErrors({}); setMessage({ tone: "ok", text: "Showing the current list. Make your changes again, then Save." });
    } catch { setMessage({ tone: "flag", text: "Couldn't load the current list. Try again." }); }
  }

  async function save() {
    const found = validate(items);
    setErrors(found);
    if (Object.keys(found).length) {
      setOpenRow(Object.keys(found)[0]);
      setMessage({ tone: "flag", text: "Some rows need a fix before saving." });
      return;
    }
    const payload = { items: clean(items), screen_phone: screenPhone, send_call_link: sendLink };
    const key = JSON.stringify([data.version.id, payload]);
    if (opRef.current?.key !== key) opRef.current = { id: crypto.randomUUID(), key };
    setSaving(true); setMessage(null);
    try {
      const result = await publishDiscoveryChecklist({ definition_id: data.definition.id, expected_version: data.version.id, ...payload, operation_id: opRef.current.id });
      if(!result.ok) { setMessage({tone:"flag",text:errorCopy(result.code),reload:result.code==="CHECKLIST_VERSION_CONFLICT"}); return; }
      const fresh = (await loadDiscoveryChecklistSettings()) as ChecklistSettingsData;
      setData(fresh); setItems(fresh.version.items);
      setMessage({ tone: "ok", text: "Saved. New checklists use this list; checklists already started keep theirs." });
      router.refresh();
    } catch {
      // Production hides thrown messages: check whether the list moved on.
      try {
        const fresh = (await loadDiscoveryChecklistSettings()) as ChecklistSettingsData;
        if (fresh.version.id !== data.version.id) {
          setMessage({ tone: "flag", text: "These settings were changed somewhere else. Reload the current list, then make your changes again.", reload: true });
          return;
        }
      } catch { /* fall through */ }
      setMessage({ tone: "flag", text: navigator.onLine === false ? "Saving needs a connection. Your changes are still here." : "Couldn't save. Your changes are still here — check the lengths and try again." });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6 pb-28">
      <section aria-labelledby={`${ids}-rows`}>
        <h2 id={`${ids}-rows`} className="font-serif text-[20px] font-semibold text-ink">Rows</h2>
        <p className="mt-1 text-[16px] text-ink-2">The nine standard rows are always on. Turn the four extra rows off here if you don&apos;t want them on new checklists.</p>
        <ol className="mt-3 space-y-2">
          {items.map((item, index) => {
            const e = errors[item.id];
            const open = openRow === item.id || !!e;
            return (
              <li key={item.id} className={`rounded-lg border bg-card ${e ? "border-flag" : "border-rule"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                  <span className="w-6 text-right font-mono text-[14px] text-ink-3" aria-hidden>{index + 1}</span>
                  <span className="flex min-h-12 min-w-0 flex-1 basis-40 flex-col justify-center">
                    <span className="text-[17px] font-semibold text-ink">{item.label || "(no label)"}</span>
                    {/* Status only; the action is its own button. */}
                    <span className="text-[14px] text-ink-3">{item.optional ? (item.enabled ? "On" : "Off") : "Always on"} · Reminders {item.reminder_enabled ? "on" : "off"}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Btn aria-expanded={open} aria-controls={`${ids}-${item.id}`} aria-label={`Edit wording for ${item.label || "this row"}`} onClick={() => setOpenRow(open && !e ? null : item.id)} className="px-3">
                      Edit wording <ChevronDown aria-hidden className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
                    </Btn>
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${item.label} up`}
                      className="inline-flex size-12 items-center justify-center rounded-md border border-rule bg-card text-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><ArrowUp aria-hidden className="size-4" /></button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Move ${item.label} down`}
                      className="inline-flex size-12 items-center justify-center rounded-md border border-rule bg-card text-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><ArrowDown aria-hidden className="size-4" /></button>
                  </span>
                </div>
                {open && (
                  <div id={`${ids}-${item.id}`} className="space-y-4 border-t border-rule-soft px-3 py-3">
                    <Counted id={`${ids}-${item.id}-label`} label="Label" value={item.label} max={LIMITS.label} error={e?.label} onChange={(v) => update(item.id, { label: v })} />
                    <Counted id={`${ids}-${item.id}-rem`} label="Reminder sentence" value={item.reminder} max={LIMITS.reminder} error={e?.reminder} multiline onChange={(v) => update(item.id, { reminder: v })} />
                    {[0, 1].map((q) => (
                      <Counted key={q} id={`${ids}-${item.id}-q${q}`} label={`Question ${q + 1}`} value={item.questions[q] ?? ""} max={LIMITS.question} multiline
                        error={q === 1 ? e?.questions : undefined}
                        onChange={(v) => { const qs = [item.questions[0] ?? "", item.questions[1] ?? ""]; qs[q] = v; update(item.id, { questions: qs.slice(0, qs[1] ? 2 : 1) }); }} />
                    ))}
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      {item.optional && (
                        <div className="flex items-center gap-3"><span className="text-[16px] text-ink" id={`${ids}-${item.id}-on`}>On new checklists</span><Switch label={`${item.label} on new checklists`} on={item.enabled} onChange={(v) => update(item.id, { enabled: v })} /></div>
                      )}
                      <div className="flex items-center gap-3"><span className="text-[16px] text-ink">Reminders for this row</span><Switch label={`Reminders for ${item.label}`} on={item.reminder_enabled} onChange={(v) => update(item.id, { reminder_enabled: v })} /></div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {/* On a phone this lives under the rows, so the sticky footer stays one line. */}
        <div className="mt-2 @sm/page:hidden"><Btn kind="ghost" onClick={restoreWording} disabled={saving}>Restore default wording</Btn></div>
      </section>

      <section aria-labelledby={`${ids}-global`} className="space-y-4">
        <h2 id={`${ids}-global`} className="font-serif text-[20px] font-semibold text-ink">Reminders and call links</h2>
        <fieldset>
          <legend className="text-[16px] font-semibold text-ink">Reminders go to</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([[false, "On screen only"], [true, "On screen and phone"]] as const).map(([v, label]) => (
              <label key={label} className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border px-4 text-[16px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${screenPhone === v ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink"}`}>
                <input type="radio" name={`${ids}-dest`} checked={screenPhone === v} onChange={() => setScreenPhone(v)} className="sr-only" />
                {screenPhone === v && <span aria-hidden>✓</span>}{label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3"><span className="text-[16px] font-semibold text-ink">Send me a link when a call starts</span><Switch label="Send me a link when a call starts" on={sendLink} onChange={setSendLink} /></div>
        <p className="text-[15px] text-ink-3">Saved now. They take effect once live reminders are turned on — today the checklist is ticked by hand.</p>
      </section>

      {/* On a phone the footer shows only while there's something to save (or
          say), as one line: [Save] [Cancel]. */}
      <div className={`sticky bottom-0 z-10 -mx-4 border-t border-rule bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 @4xl/page:-mx-6 @4xl/page:px-6 ${dirty || saving || message ? "" : "@max-sm/page:hidden"}`}>
        {message && (
          <p role={message.tone === "flag" ? "alert" : "status"} className={`mb-2 flex flex-wrap items-center gap-2 text-[16px] ${message.tone === "flag" ? "text-flag" : "text-ink-2"}`}>
            {message.tone === "flag" && <AlertTriangle aria-hidden className="size-4" />}{message.text}
            {message.reload && <Btn onClick={() => void reloadCurrent()}>Reload</Btn>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Btn>
          <Btn onClick={cancel} disabled={saving || !dirty}>Cancel</Btn>
          {/* Left, beside Cancel: the floating Operator pill sits bottom-right on tablet. */}
          <span className="hidden @sm/page:contents"><Btn kind="ghost" onClick={restoreWording} disabled={saving}>Restore default wording</Btn></span>
        </div>
      </div>
    </div>
  );
}
