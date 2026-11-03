"use client";
/**
 * One field (plan §6.1, §6.3): label 17/18 px, separate * required marker, the one-legend
 * mark right-aligned (symbol + word, flags beside the state, never replacing it), the
 * input for its type, the photos that prove it, one "Skip this field…", and the inline
 * conflict picker. A ✓ Saved appears only after the durable local write resolved.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CoverageMark } from "@/components/ui/CoverageMark";
import type { FieldView, ShotView } from "@/lib/consult/ui/model";
import type { AnswerPayload } from "@/lib/consult/ui/ops";
import { W, plainWords } from "@/lib/consult/ui/words";
import { Btn, Choice } from "./primitives";
import { showLength } from "./Keypad";
import { curly } from "@/lib/consult/typography";

export interface FieldActions {
  answer: (f: FieldView, p: AnswerPayload) => Promise<void>;
  keypad: (f: FieldView) => void;
  skip: (target: { field?: FieldView; shot?: ShotView; sectionId: string }) => void;
  photo: (shot: ShotView, file: File, fieldKey?: string) => Promise<void>;
  resolve: (f: FieldView, pick: "current" | "proposed" | "other") => void;
  discard: (eventId: string) => Promise<void>;
  thumbs: Record<string, string>;
  photosOk: boolean | null;
  online: boolean;
  showToClient: (field?: FieldView) => void;
  focusAddr: string | null;
}

export function valueText(f: FieldView): string {
  const a = f.answer; if (!a || a.status !== "answered") return "";
  const v = a.value; const d = f.def;
  if (d.type === "length" || d.type === "length_pair") return showLength(v, d);
  if (d.type === "yesno") return v === true ? W.yes : v === false ? W.no : String(v);
  if (d.type === "multi" && Array.isArray(v)) return v.join(", ");
  if (d.type === "date" && typeof v === "string") { const dt = new Date(`${v}T12:00:00`); return Number.isFinite(+dt) ? dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : v; }
  if ((d.type === "count" || d.type === "number") && d.unit && d.unit !== "ea") return `${v} ${d.unit}`;
  return typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
}

export function MarkCell({ f }: { f: { mark: FieldView["mark"]; conflict?: unknown; returnVisit?: boolean } }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-right">
      <CoverageMark variant="coverage" state={f.mark} />
      {f.returnVisit && <CoverageMark variant="coverage" state="return_visit" />}
      {!!f.conflict && <CoverageMark variant="coverage" state="conflict" />}
    </span>
  );
}

function Saved({ f }: { f: FieldView }) {
  const a = f.answer; if (!a) return null;
  if (a.local === "invalid") return null;
  if (a.local === "pending") return <p className="mt-1 text-[0.85em] text-ink-3" aria-live="polite">✓ {W.saved} · on this device</p>;
  return null;
}

const answerKey = (f: FieldView) => `${f.addr}:${f.answer?.status === "answered" ? String(f.answer.value ?? "") : ""}`;

function TextAnswer({ f, actions, kind }: { f: FieldView; actions: FieldActions; kind: "text" | "number" | "year" }) {
  const current = f.answer?.status === "answered" ? String(f.answer.value ?? "") : "";
  const [v, setV] = useState(current);
  const [busy, setBusy] = useState(false);
  const dirty = v.trim() !== current.trim();
  const valid = kind === "text" ? !!v.trim() : kind === "year" ? /^\d{4}$/.test(v.trim()) : v.trim() !== "" && Number.isFinite(Number(v));
  const save = async () => {
    if (!dirty || !valid) return;
    setBusy(true);
    try { await actions.answer(f, { status: "answered", value: kind === "text" ? v.trim() : Number(v), unit: f.def.unit }); } finally { setBusy(false); }
  };
  const id = `in-${f.addr}`;
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3">
      <label htmlFor={id} className="sr-only">{f.def.label}</label>
      {kind === "text"
        ? <textarea id={id} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void save()} rows={2} maxLength={8000} className="min-h-14 min-w-0 flex-1 basis-[12em] rounded-md border-2 border-rule bg-card px-3 py-3 text-[max(16px,1em)] text-ink focus:border-accent focus:outline-none focus-visible:outline-3 focus-visible:outline-focus" />
        : <input id={id} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void save()} inputMode={kind === "year" ? "numeric" : "decimal"} maxLength={kind === "year" ? 4 : 12}
            className="min-h-14 w-[9em] rounded-md border-2 border-rule bg-card px-3 font-mono text-[max(16px,1.2em)] text-ink focus:border-accent focus:outline-none focus-visible:outline-3 focus-visible:outline-focus" />}
      {kind !== "text" && f.def.unit && f.def.unit !== "ea" && <span className="pb-4 font-mono text-ink-2">{f.def.unit}</span>}
      <Btn tone={dirty && valid ? "primary" : "secondary"} disabled={!dirty || !valid || busy} onClick={() => void save()}>{W.save}</Btn>
    </div>
  );
}

function Stepper({ f, actions }: { f: FieldView; actions: FieldActions }) {
  const n = typeof f.answer?.value === "number" && f.answer.status === "answered" ? (f.answer.value as number) : null;
  const set = (v: number) => actions.answer(f, { status: "answered", value: Math.max(f.def.range?.[0] ?? 0, Math.min(f.def.range?.[1] ?? 999, v)), unit: f.def.unit });
  return (
    <div className="mt-2 flex items-center gap-3" role="group" aria-label={f.def.label}>
      <Btn size={64} className="w-16 text-[1.4em]" aria-label="One less" onClick={() => void set((n ?? 1) - 1)} disabled={n === null || n <= (f.def.range?.[0] ?? 0)}>–</Btn>
      <output aria-live="polite" className="min-w-[3ch] text-center font-mono text-[1.6em] font-semibold text-ink">{n ?? "—"}</output>
      <Btn size={64} className="w-16 text-[1.4em]" aria-label="One more" onClick={() => void set((n ?? -1) + 1)}>+</Btn>
      {n === null && <Btn onClick={() => void set(0)}>0</Btn>}
    </div>
  );
}

export function PhotoRow({ shot, actions, fieldKey, sectionId }: { shot: ShotView; actions: FieldActions; fieldKey?: string; sectionId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const latest = shot.blobs[shot.blobs.length - 1];
  const uploaded = latest?.receipt;
  const disabled = actions.photosOk !== true;
  return (
    <div className="mt-3 rounded-md border-2 border-rule-soft bg-paper p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-semibold text-ink">Photo · {shot.def.label}{shot.required && <span aria-label={W.required} className="ml-1 text-flag">*</span>}</p>
        <MarkCell f={{ mark: shot.mark }} />
      </div>
      {shot.def.hint && <p className="text-[0.9em] text-ink-2">{shot.def.hint}</p>}
      {shot.mark === "not_applicable" && shot.skip && <p className="text-[0.9em] text-ink-2">N/A · {shot.skip}</p>}
      {latest && (
        <div className="mt-2 flex items-center gap-3">
          {actions.thumbs[latest.hash] && <img src={actions.thumbs[latest.hash]} alt={`Photo of ${shot.def.label}`} className="size-16 rounded-md border-2 border-rule object-cover" />}
          <p className="text-[0.95em] text-ink-2" aria-live="polite">{uploaded ? W.photoUploaded : actions.online ? `${W.photoUploading}…` : W.photoSaved}</p>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-[0.95em] font-semibold text-flag">! {err}</p>}
      {disabled && !latest && <p className="mt-1 text-[0.9em] text-ink-2">{actions.photosOk === false ? W.photosOff : "Ask “Photos okay?” in House & household first."}</p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden
        onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setBusy(true); setErr(null); try { await actions.photo(shot, file, fieldKey); } catch (x) { setErr(plainWords(x instanceof Error ? x.message : "")); } finally { setBusy(false); } }} />
      <div className="mt-2 flex flex-wrap gap-3">
        <Btn tone={latest ? "secondary" : "primary"} disabled={disabled || busy} onClick={() => input.current?.click()}>{latest ? W.retake : W.takePhoto}</Btn>
        {!latest && shot.mark !== "covered" && <Btn tone="quiet" onClick={() => actions.skip({ shot, sectionId })}>{W.skip}</Btn>}
      </div>
    </div>
  );
}

function ConflictPicker({ f, actions }: { f: FieldView; actions: FieldActions }) {
  const c = f.conflict!;
  const show = (v: unknown, status?: string) => (status && status !== "answered" ? (status === "skipped" ? "skipped" : "cleared") : f.def.type.startsWith("length") ? showLength(v, f.def) : v === true ? W.yes : v === false ? W.no : String(v ?? "—"));
  return (
    <div role="group" aria-label={`Conflict on ${f.def.label}`} className="mt-3 rounded-md border-2 border-flag bg-flag-soft p-3">
      <p className="font-semibold text-flag">! Conflict · {f.def.label}</p>
      <p className="text-[0.95em] text-ink">{c.rebase ? plainWords("rebase_required") : W.conflictBody}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {c.current && <Btn onClick={() => actions.resolve(f, "current")} >Pick {show(c.current.value, c.current.status)} · office</Btn>}
        {c.proposed && !c.rebase && <Btn onClick={() => actions.resolve(f, "proposed")} >Pick {show(c.proposed.value, c.proposed.status)} · this device</Btn>}
        <Btn onClick={() => actions.resolve(f, "other")}>{W.enterAnother}</Btn>
      </div>
    </div>
  );
}

export function FieldRow({ f, actions, sectionId, last }: { f: FieldView; actions: FieldActions; sectionId: string; last?: unknown }) {
  const d = f.def;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (actions.focusAddr === f.addr) { ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); ref.current?.querySelector<HTMLElement>("button, input, textarea")?.focus({ preventScroll: true }); } }, [actions.focusAddr, f.addr]);
  const answered = f.answer?.status === "answered";
  const skipped = f.answer?.status === "skipped";
  let input: ReactNode = null;
  switch (d.type) {
    case "length": case "length_pair":
      input = (
        <button type="button" onClick={() => actions.keypad(f)} aria-label={`${d.label}: ${answered ? valueText(f) : W.tapToEnter}`}
          className={`mt-2 flex min-h-14 w-full items-center rounded-md border-2 px-3 text-left font-mono text-[1.65em] font-semibold focus-visible:outline-3 focus-visible:outline-focus ${answered ? "border-rule bg-card text-ink" : "border-dashed border-rule bg-paper text-ink-3"}`}>
          {answered ? valueText(f) : <span className="font-sans text-[0.6em] font-semibold">[ {W.tapToEnter} ]</span>}
        </button>
      );
      break;
    case "count": input = <Stepper f={f} actions={actions} />; break;
    case "number": input = <TextAnswer key={answerKey(f)} f={f} actions={actions} kind="number" />; break;
    case "year": input = <TextAnswer key={answerKey(f)} f={f} actions={actions} kind="year" />; break;
    case "text": input = <TextAnswer key={answerKey(f)} f={f} actions={actions} kind="text" />; break;
    case "yesno":
      input = <div className="mt-2"><Choice options={[true, false] as const} value={answered ? (f.answer!.value as boolean) : null} onPick={(v) => void actions.answer(f, { status: "answered", value: v, unit: d.unit })} labels={(v) => (v ? W.yes : W.no)} columns={2} /></div>;
      break;
    case "choice":
      input = <div className="mt-2"><Choice options={d.options ?? []} value={answered ? (f.answer!.value as string) : null} onPick={(v) => void actions.answer(f, { status: "answered", value: v, unit: d.unit })} labels={curly} /></div>;
      break;
    case "multi": {
      const set = answered && Array.isArray(f.answer!.value) ? (f.answer!.value as string[]) : [];
      input = (
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(9.5em,100%),1fr))] gap-3" role="group" aria-label={d.label}>
          {(d.options ?? []).map((o) => {
            const on = set.includes(o);
            const next = on ? set.filter((x) => x !== o) : [...set.filter((x) => !(o === "None" || x === "None")), o];
            return (
              <button key={o} type="button" aria-pressed={on} onClick={() => void actions.answer(f, next.length ? { status: "answered", value: next, unit: d.unit } : { status: "cleared", unit: d.unit })}
                className={`min-h-14 rounded-md border-2 px-3 py-2 text-left font-semibold leading-tight focus-visible:outline-3 focus-visible:outline-focus ${on ? "border-accent bg-accent-soft text-ink" : "border-rule bg-card text-ink-2 hover:bg-paper-2"}`}>
                <span aria-hidden className="mr-1.5 font-mono">{on ? "☑" : "☐"}</span>{curly(o)}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case "date":
      input = (
        <div className="mt-2">
          <input type="date" aria-label={d.label} value={answered ? String(f.answer!.value) : ""} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) void actions.answer(f, { status: "answered", value: e.target.value, unit: d.unit }); }}
            className="min-h-14 rounded-md border-2 border-rule bg-card px-3 text-[max(16px,1em)] text-ink focus:border-accent focus:outline-none focus-visible:outline-3 focus-visible:outline-focus" />
        </div>
      );
      break;
    case "signature":
      input = <div className="mt-2 flex flex-wrap items-center gap-3">{f.initials ? <p className="text-ink-2">{W.initialsSaved}{f.initials.receipt ? ` · ${W.photoUploaded}` : ` · ${W.photoSaved}`}</p> : <Btn tone="primary" onClick={() => actions.showToClient(f)}>{W.showToClient}</Btn>}</div>;
      break;
    default:
      input = <TextAnswer key={answerKey(f)} f={f} actions={actions} kind="text" />;
  }
  return (
    <div ref={ref} id={`f-${f.addr}`} className={`scroll-mt-28 border-b-2 border-rule-soft py-4 ${actions.focusAddr === f.addr ? "rounded-md bg-accent-soft/40 px-2" : ""}`}>
      {d.say && <p className="mb-1 font-serif text-[1em] italic text-ink-2"><span className="not-italic font-semibold text-ink">{W.say}</span> {d.say}</p>}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 basis-[10em] text-[1em] font-semibold text-ink">
          {d.label}{f.required && <span aria-label={W.required} title={W.required} className="ml-1 text-flag">*</span>}
          {d.unit && d.type !== "length" && d.type !== "length_pair" && d.unit !== "ea" && <span className="ml-1 font-normal text-ink-3">({d.unit})</span>}
        </p>
        <MarkCell f={f} />
      </div>
      {d.hint && <p className="text-[0.9em] text-ink-2">{d.hint}</p>}
      {skipped && <p className="mt-1 text-[0.95em] text-ink-2">{f.mark === "not_applicable" ? "N/A · " : "Skipped · "}{f.answer!.skip_reason}{f.skipCounts ? (f.answer!.skip_reason === "Not on this job" ? "" : " — assumption written") : f.returnVisit ? "" : f.answer!.skip_reason === "Not on this job" ? " — the job needs it, so it stays Open" : " — needs a written assumption to count"}{f.answer!.skip_note ? ` · ${f.answer!.skip_note}` : ""}</p>}
      {input}
      <Saved f={f} />
      {f.answer?.local === "invalid" && (
        <div role="alert" className="mt-2 rounded-md border-2 border-flag bg-flag-soft p-3">
          <p className="font-semibold text-ink"><span aria-hidden className="text-flag">⚠ </span>{plainWords(f.answer.error_code ?? "invalid_operation")}</p>
          {f.answer.event_id && <div className="mt-2"><Btn onClick={() => void actions.discard(f.answer!.event_id!)}>Remove the refused answer</Btn></div>}
        </div>
      )}
      {f.conflict && <ConflictPicker f={f} actions={actions} />}
      {f.flags.map((fl) => <p key={fl.key} className="mt-2 text-[0.95em] font-semibold text-flag">⚑ Flag · {fl.hint} Decide in {W.beforeYouWrap}.</p>)}
      {f.shots.map((s) => <PhotoRow key={s.key} shot={s} actions={actions} fieldKey={f.key} sectionId={sectionId} />)}
      <div className="mt-2 flex flex-wrap gap-3">
        {last !== undefined && !answered && (d.type === "length" || d.type === "length_pair") && <Btn onClick={() => void actions.answer(f, { status: "answered", value: last, unit: d.unit })}>{W.sameAsLast} · {showLength(last, d)}</Btn>}
        {!answered && d.type !== "signature" && <Btn tone="quiet" onClick={() => actions.skip({ field: f, sectionId })}>{W.skip}</Btn>}
        {d.type === "signature" && !f.initials && <Btn tone="quiet" onClick={() => actions.skip({ field: f, sectionId })}>{W.skip}</Btn>}
      </div>
    </div>
  );
}
