"use client";

import { useId, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Mic, Square } from "lucide-react";
import { CoverageMark } from "@/components/ui/CoverageMark";
import { useDictation } from "@/lib/use-dictation";
import type { ChecklistItem, CoverageState } from "@/lib/checklist-coverage/contract";
import { INSURANCE_WARNING } from "@/lib/checklist-coverage/manual";
import { buildValue, fieldsFor, fieldsFromValue, isInsurance, mainField, suggestedState, type Fields } from "@/lib/checklist-coverage/answers";
import type { RowValue } from "@/lib/checklist-coverage/client-queue";
import { Btn, Sheet } from "./Sheet";

const STATES: CoverageState[] = ["open", "partial", "covered", "not_applicable"];
const RANK: Record<CoverageState, number> = { open: 0, partial: 1, covered: 2, not_applicable: 3 };
const INPUT = "mt-1 block w-full min-h-12 rounded-md border bg-paper px-3 py-2.5 text-[16px] leading-6 text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** Plain text for the plan's "Covered when" notes (they carry **bold** marks). */
function plain(text: string | undefined): string {
  return (text ?? "").replace(/\*\*/g, "");
}

function MicButton({ onText, label }: { onText: (t: string) => void; label: string }) {
  const [error, setError] = useState("");
  const { state, start, stop, supported } = useDictation({ onText, onError: setError });
  if (!supported) return null; // voice not set up on this server: no dead button
  const recording = state === "recording", busy = state === "transcribing";
  return (
    <span className="flex flex-none flex-col items-center">
      <button type="button" onClick={recording ? stop : () => { setError(""); void start(); }} disabled={busy}
        aria-label={recording ? `Stop dictating ${label}` : `Dictate ${label}`} aria-pressed={recording}
        className={`mt-1 inline-flex size-12 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 ${recording ? "border-flag bg-flag-soft text-flag" : "border-rule bg-card text-ink hover:bg-paper-2"}`}>
        {busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : recording ? <Square aria-hidden className="size-4 fill-current" /> : <Mic aria-hidden className="size-5" strokeWidth={1.75} />}
      </button>
      <span className="mt-0.5 text-label text-ink-3" aria-live="polite">{busy ? "Writing…" : recording ? "Listening" : error}</span>
    </span>
  );
}

export function RowSheet({
  spec, view, manualLock, onSave, onClose, undoTo,
}: {
  spec: ChecklistItem;
  view: RowValue;
  manualLock: boolean;
  onSave: (next: RowValue) => void;
  onClose: () => void;
  /** The row's value before this page's last saved change to it, for Undo. */
  undoTo: RowValue | null;
}) {
  const initial = useMemo(() => ({ state: view.state, fields: fieldsFromValue(spec.key, view.value), reason: view.reason ?? "" }), [view, spec.key]);
  const [state, setState] = useState<CoverageState>(initial.state);
  const [fields, setFields] = useState<Fields>(initial.fields);
  const [reason, setReason] = useState(initial.reason);
  const [reasonError, setReasonError] = useState(false);
  // Joe tapped a state button in this sheet: from then on the answer never moves it.
  const [stateTouched, setStateTouched] = useState(false);
  const ids = useId();
  const main = mainField(spec.key);
  const specs = fieldsFor(spec.key);
  const value = buildValue(spec.key, fields);
  const dirty = state !== initial.state || reason !== initial.reason || JSON.stringify(fields) !== JSON.stringify(initial.fields);

  /** Picking a choice or typing an answer on an Open row moves it to Covered
   *  (Partly when the answer is only part of it), so Joe doesn't need two more
   *  taps mid-sentence. Only ever up from Open, never over a state he tapped,
   *  and clearing the answer doesn't drop it back. */
  function set(name: string, v: string) {
    const next = { ...fields, [name]: v };
    setFields(next);
    if (stateTouched || initial.state !== "open") return;
    const suggested = suggestedState(spec.key, buildValue(spec.key, next));
    if (suggested && RANK[suggested] > RANK[state]) setState(suggested);
  }

  function save() {
    if (state === "not_applicable" && !reason.trim()) { setReasonError(true); document.getElementById(`${ids}-reason`)?.focus(); return; }
    onSave({ state, value, reason: state === "not_applicable" ? reason.trim() : null });
  }

  function undo() {
    if (dirty) { setState(initial.state); setFields(initial.fields); setReason(initial.reason); setReasonError(false); setStateTouched(false); return; }
    if (undoTo) onSave(undoTo);
  }

  return (
    <Sheet title={spec.label} onClose={onClose} initialFocus={`[data-state="${state}"]`}
      footer={<>
        <Btn onClick={undo} disabled={!dirty && !undoTo}>Undo</Btn>
        <Btn kind="primary" onClick={save} className="ml-auto min-w-32">Save</Btn>
      </>}>
      <div role="group" aria-label={`${spec.label} state`} className="grid grid-cols-4 gap-1 rounded-lg bg-paper-2 p-1 max-[400px]:grid-cols-2">
        {STATES.map((s) => (
          <button key={s} type="button" data-state={s} aria-pressed={state === s} onClick={() => { setState(s); setStateTouched(true); setReasonError(false); }}
            className={`flex min-h-14 items-center justify-center rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${state === s ? "bg-card shadow-card ring-2 ring-ink" : "hover:bg-hover"}`}>
            <CoverageMark variant="coverage" state={s} />
          </button>
        ))}
      </div>

      {state === "not_applicable" && (
        <label className="mt-4 block">
          <span className="text-[15px] font-semibold text-ink">Why it doesn&apos;t apply <span aria-hidden className="text-flag">*</span><span className="sr-only">(required)</span></span>
          <textarea id={`${ids}-reason`} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(false); }} rows={2}
            aria-invalid={reasonError} aria-describedby={reasonError ? `${ids}-reason-err` : undefined}
            className={`${INPUT} ${reasonError ? "border-flag" : "border-rule"}`} />
          {reasonError && <span id={`${ids}-reason-err`} className="mt-1 flex items-center gap-1.5 text-[15px] text-flag"><AlertTriangle aria-hidden className="size-4" /> N/A needs a reason.</span>}
        </label>
      )}

      <div className="mt-4 space-y-4">
        {specs.map((f) => {
          const id = `${ids}-${f.name}`;
          if (f.type === "choice") {
            return (
              <fieldset key={f.name}>
                {/* "Budget" under the "Budget" sheet title says nothing new: keep it for screen readers only. */}
                <legend className={f.label.trim().toLowerCase() === spec.label.trim().toLowerCase() ? "sr-only" : "text-[15px] font-semibold text-ink"}>{f.label}</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {f.options.map((o) => {
                    const on = fields[f.name] === o.value;
                    return (
                      <button key={o.value} type="button" aria-pressed={on} onClick={() => set(f.name, on ? "" : o.value)}
                        className={`inline-flex min-h-12 items-center gap-2 rounded-full border px-4 text-[16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${on ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink hover:bg-paper-2"}`}>
                        {/* ✓ only on the picked one; ○ already means Open beside these (§6.0). */}
                        {on && <span aria-hidden>✓</span>}{o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          }
          if (f.type === "check") {
            return (
              <label key={f.name} className="flex min-h-12 cursor-pointer items-center gap-3 text-[16px]">
                <input type="checkbox" checked={fields[f.name] === "true"} onChange={(e) => set(f.name, e.target.checked ? "true" : "")} className="size-6 flex-none accent-[var(--ink)]" />
                {f.label}
              </label>
            );
          }
          const isMain = f.name === main;
          const control = f.type === "textarea" || f.type === "people"
            ? <textarea id={id} rows={3} value={fields[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={"placeholder" in f ? f.placeholder : undefined} className={`${INPUT} border-rule`} />
            : <input id={id} type={f.type} inputMode={f.type === "tel" ? "tel" : undefined} autoComplete="off" value={fields[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={"placeholder" in f ? f.placeholder : undefined} className={`${INPUT} border-rule`} />;
          return (
            <div key={f.name}>
              <label htmlFor={id} className="text-[15px] font-semibold text-ink">{f.label}</label>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">{control}</div>
                {isMain && <MicButton label={spec.label} onText={(t) => set(f.name, [(fields[f.name] ?? "").trim(), t.trim()].filter(Boolean).join(" "))} />}
              </div>
            </div>
          );
        })}
      </div>

      {isInsurance(spec.key, value) && (
        <p role="note" className="mt-4 flex gap-2 rounded-md border border-flag/40 bg-flag-soft px-3 py-2.5 text-[16px] text-flag">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" /> <span>{INSURANCE_WARNING}</span>
        </p>
      )}

      <details className="group mt-5 rounded-md border border-rule-soft bg-paper px-3">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-[16px] font-semibold text-ink-2 focus-visible:outline-2 focus-visible:outline-focus">
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span> Why we ask · Questions to try
        </summary>
        <div className="space-y-3 pb-3 text-[16px] leading-6 text-ink-2">
          {spec.questions.length > 0 && <ul className="space-y-1.5">{spec.questions.map((q, i) => <li key={i}>“{q}”</li>)}</ul>}
          {spec.covered_when && <p><span className="font-semibold text-ink">Covered when:</span> {plain(spec.covered_when)}</p>}
          {spec.partial_when && <p><span className="font-semibold text-ink">Partly when:</span> {plain(spec.partial_when)}</p>}
        </div>
      </details>

      {manualLock && <p className="mt-4 text-[15px] text-ink-3">Changed by hand</p>}
    </Sheet>
  );
}
