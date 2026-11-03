"use client";
import {sectionCounts} from "@/lib/consult/completeness";
/**
 * The visitor's screens (plan §6.3 phone portrait, §6.4 tablet landscape):
 * opening script → section list → section fields. Phone/tablet portrait: one column,
 * primary action bottom-right in the thumb zone. ≥1024 px: script + sections pane
 * (360 px) beside the active section. In-tool Back returns to the section list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoverageMark } from "@/components/ui/CoverageMark";
import type { FieldView, SectionView, ShotView, VisitModel, EvidenceDraft, Display } from "@/lib/consult/ui/model";
import { leaveLine, leaveList, moduleNoun, nextOpen, resumeSection, selectionHint, spokenSelections } from "@/lib/consult/ui/model";
import type { AnswerPayload } from "@/lib/consult/ui/ops";
import { W, fill, plainWords, spokenDuration, visitDuration } from "@/lib/consult/ui/words";
import { Banner, Btn, Eyebrow, Sheet, scrollInPane } from "./primitives";
import { FieldRow, MarkCell, PhotoRow, type FieldActions } from "./FieldRow";
import { Keypad } from "./Keypad";
import { SkipSheet, type SkipValue } from "./SkipSheet";
import { AckSheet, FlagSheet, RrpSheet, TradeSheet, WrapSheet } from "./WrapClose";
import { centralTime } from "./GetReady";

export interface VisitApi {
  answer: (instance: string, field: string, label: string, p: AnswerPayload, draft?: EvidenceDraft) => Promise<unknown>;
  addInstance: (module: string, label: string, parent?: string | null) => Promise<unknown>;
  removeInstance: (instance: string, label: string) => Promise<unknown>;
  photo: (file: Blob, meta: { instance_id: string; field_key?: string; shot_key?: string }, label: string) => Promise<unknown>;
  resolve: (instance: string, field: string, rev: number, current: string, proposed: string, p: AnswerPayload, label: string) => Promise<unknown>;
  discard: (eventId: string, reason: string) => Promise<unknown>;
  setDraft: (d: EvidenceDraft) => Promise<boolean>;
  close: () => void;
  ensureClosing: () => Promise<string>;
  ackSummary?: string;
  showToClient: (field?: FieldView) => void;
}

/** r6 D8: a field shown under an opening card, without the Say line the card already quotes. */
const hideSay = (f: FieldView): FieldView => ({ ...f, def: { ...f.def, say: undefined } });

/** A line that can't be read yet (no estimate date) is a direction to the visitor, never a quote (r2 item 9). */
const needsDate = (line: string, model: VisitModel) => !model.promised && line.includes("{estimate_date}");
const fillScript = (line: string, display: Display | undefined, model: VisitModel) =>
  line.replace(/\s*This is \{helper\}[^.]*\./, "").replace("{duration}", spokenDuration(model.templates.map((t) => t.key)))
    .replace("{name}", display?.visitor_name ?? "").replace("{estimate_date}", model.promised ? centralTime(`${model.promised}T12:00:00-06:00`, { weekday: "long", month: "long", day: "numeric" }) : "the date you pick below")
    .replace("{open_selections}", spokenSelections(model) || "none");

/** §6.1 thumb zone: the primary action bottom-right, 56 px. Fixed on phone and tablet portrait;
 *  from 1024 px it is sticky at the bottom of the scrolling right pane (the section is a flex column
 *  at least the pane's height, so a short opening card still puts Next at the bottom). */
function BottomBar({ left, right }: { left?: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t-2 border-rule-soft bg-paper px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:sticky lg:inset-x-auto lg:mt-auto lg:-mx-4 lg:pb-3">
      {left ?? <span />}
      {right}
    </div>
  );
}

/** r5: each "word n/m" stays on one line, so "Record" and "0/2" never break apart at 320 px. */
function counts(s: { pc: { done: number; total: number }; record: { done: number; total: number } }) {
  return <><span className="whitespace-nowrap">Price-critical {s.pc.done}/{s.pc.total}</span>{s.record.total ? <> · <span className="whitespace-nowrap">Record {s.record.done}/{s.record.total}</span></> : null}</>;
}

function SectionRows({ model, active, onOpen, onAdd, compact }: { model: VisitModel; active: string | null; onOpen: (id: string) => void; onAdd: (moduleKey: string, parent?: string | null) => void; compact?: boolean }) {
  const missing = model.slots.filter((s) => s.required && s.live < s.minimum && !s.parent);
  const extra = model.slots.filter((s) => !s.parent && (s.module.repeatable || s.live === 0) && !(s.required && s.live < s.minimum));
  return (
    <div>
      <ul className="grid">
        {model.sections.map((s) => (
          <li key={s.instance.id}>
            <button type="button" onClick={() => onOpen(s.instance.id)} aria-current={active === s.instance.id ? "true" : undefined}
              aria-label={`${s.label}, ${s.pc.done} of ${s.pc.total} price-critical done, ${s.mark === "covered" ? "Covered" : s.mark === "partial" ? "Partly" : s.mark === "not_applicable" ? "N/A" : "Open"}${s.returnVisit ? ", Return visit" : ""}${s.conflict ? ", Conflict" : ""}`}
              className={`grid min-h-14 w-full items-center gap-x-3 border-b-2 border-rule-soft px-2 py-2 text-left hover:bg-hover focus-visible:outline-3 focus-visible:outline-focus ${compact ? "grid-cols-[1fr_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto_auto]"} ${active === s.instance.id ? "bg-accent-soft" : ""} ${s.depth ? "pl-6" : ""}`}>
              <span className="min-w-0 break-words font-semibold text-ink">{s.depth ? "↳ " : ""}{s.label}</span>
              {/* r3 C9: count · mark, chevron last. */}
              <span className="font-mono text-[0.9em] text-ink-2">{sectionCounts(s).done}/{sectionCounts(s).total}</span>
              <span className={compact ? "col-span-2 justify-self-start" : ""}><MarkCell f={{ mark: s.mark, conflict: s.conflict, returnVisit: s.returnVisit }} /></span>
              {!compact && <span aria-hidden className="font-mono text-ink-3">›</span>}
            </button>
          </li>
        ))}
        {missing.map((slot) => (
          // r4 R4-8: stacked — name and count, the hint at full width, then the button at full width.
          <li key={`missing-${slot.module.key}`} className="grid gap-2 border-b-2 border-rule-soft px-2 py-3">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-semibold text-ink">{moduleNoun(slot.module)}</span><span className="flex items-center gap-2"><span className="font-mono text-[0.9em] text-ink-2">{slot.live}/{slot.minimum}</span><CoverageMark variant="coverage" state="open" size="sm" /></span></span>
            {slot.label && <span className="text-[0.85em] text-ink-3">{slot.label}</span>}
            <Btn wide onClick={() => onAdd(slot.module.key)}>{fill(W.addInstance, { name: moduleNoun(slot.module).toLowerCase() })}</Btn>
          </li>
        ))}
      </ul>
      {extra.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {extra.map((slot) => <Btn key={slot.module.key} tone="secondary" onClick={() => onAdd(slot.module.key)}>+ {moduleNoun(slot.module)}</Btn>)}
        </div>
      )}
    </div>
  );
}

export function VisitScreen({ device, model, display, api, thumbs, online, draft, refused, hasInitials, userName, staff, lastSaved, forgotClose, startAt, prefill, visitorNotes, saveError, startAction, onStartAction }: {
  startAction?: string | null; onStartAction?: () => void;
  /** This device's id, so a conflict side typed here says "this device" (r7 R7-3). */
  device?: string;
  saveError?: string | null; prefill?: import("@/lib/consult/ui/model").Snapshot["prefill"]; visitorNotes?: string; startAt?: string | null; model: VisitModel; display: Display | undefined; api: VisitApi; thumbs: Record<string, string>; online: boolean; draft: EvidenceDraft; refused: number; hasInitials: boolean; userName: string; staff: boolean; lastSaved: string | null; forgotClose: boolean;
}) {
  const [view, setView] = useState<"opening" | "list" | "section">(() => (startAt ? "section" : model.sections.some((s) => s.fields.some((f) => f.answer)) ? "list" : "opening"));
  const [active, setActive] = useState<string | null>(resumeSection(model,startAt));
  const [focusAddr, setFocusAddr] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  /** r5 R5-1: every jump to a field — the field scrolls into the section pane and is ringed. */
  const jump = (addr: string | null) => { setFocusAddr(addr); if (addr) setFocusTick((t) => t + 1); };
  const [keypad, setKeypad] = useState<{ f: FieldView; resolveAfter?: boolean } | null>(null);
  const [skip, setSkip] = useState<{ field?: FieldView; shot?: ShotView; sectionId: string } | null>(null);
  const [sheet, setSheet] = useState<null | "wrap" | "flags" | "trades" | "rrp" | "ack">(null);
  const [leave, setLeave] = useState<{ from: string; go: () => void } | null>(null);
  const [remove, setRemove] = useState<SectionView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openingStep, setOpeningStep] = useState(0);
  const main = useRef<HTMLDivElement>(null);
  const section = model.sections.find((s) => s.instance.id === active) ?? null;
  const tmpl = model.templates[0];
  const opening = useMemo(() => ((staff ? tmpl?.opening_staff : tmpl?.opening) ?? tmpl?.opening ?? []).map((l) => fillScript(l, display, model)), [tmpl, staff, display, model]);
  const closingLines = useMemo(() => ((staff ? tmpl?.closing_staff : tmpl?.closing) ?? tmpl?.closing ?? []).filter(l => !l.includes("{open_selections}") || model.sections.some(s=>s.module.key==="selections" && !s.fields.some(f=>f.key==="status"&&f.answer?.value==="Exact product picked"))).map((l) => ({ direction: needsDate(l, model), text: needsDate(l, model) ? W.pickDateFirst : fillScript(l, display, model) })), [tmpl, staff, display, model]);
  const head = `${display?.client ?? ""}${model.templates.length ? ` · ${model.templates.map((t) => t.title).join(" + ")}` : ""}`;
  // r5 domain 2: the client initials a sheet that carries the estimate date. Until it is picked (or
  // skipped with a reason — a staff visitor may not know Joe's date) Show to client waits for it.
  const dateField = model.sections.find((s) => s.module.key === "closing")?.fields.find((f) => f.key === "estimate_promised");
  const needDate = !model.promised && dateField?.answer?.status !== "skipped";

  // In-tool Back returns to the section list; from the list it stays in the tool.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    history.pushState({ consult: "tool" }, "");
    const onPop = () => { history.pushState({ consult: "tool" }, ""); if (viewRef.current === "section") setView("list"); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const guard = useCallback((go: () => void) => {
    if (active && view === "section") {
      const l = leaveList(model, active);
      if (l.open.length || l.partly.length) { setLeave({ from: active, go }); return; }
    }
    go();
  }, [active, view, model]);
  const openSection = (id: string, addr?: string) => {
    setLeave(null); setActive(id); setView("section"); jump(addr ?? null);
    // The pane that scrolls: <main> below 1024 px, the right pane from 1024 px. Never the document.
    if (!addr) { main.current?.scrollTo?.({ top: 0 }); (main.current?.closest("[data-scroll]") as HTMLElement | null)?.scrollTo?.({ top: 0 }); }
  };
  const wrap = async <T,>(p: Promise<T>) => { setErr(null); try { return await p; } catch (e) { setErr(e instanceof Error ? e.message : "unknown"); return undefined; } };

  const addInstance = (moduleKey: string, parent?: string | null) => {
    const m = model.modules.find((x) => x.key === moduleKey); if (!m) return;
    const n = model.sections.filter((s) => s.module.key === moduleKey).length + 1;
    void wrap(api.addInstance(moduleKey, m.repeatable ? `${moduleNoun(m)} ${n}` : m.title, parent ?? null));
  };
  const lastValue = (s: SectionView, f: FieldView) => {
    const idx = model.sections.indexOf(s);
    for (let i = idx - 1; i >= 0; i--) { const o = model.sections[i]; if (o.module.key !== s.module.key) continue; const hit = o.fields.find((x) => x.key === f.key && x.answer?.status === "answered"); if (hit) return hit.answer!.value; }
    return undefined;
  };

  const actions: FieldActions = {
    device, thumbs, online, photosOk: model.photosOk, focusAddr, focusTick, showToClient: api.showToClient, clientNeedsDate: needDate,
    houseId: model.sections.find((s) => s.module.key === "house")?.instance.id,
    answer: async (f, p) => { const inst = f.addr.split(":")[0]; await wrap(api.answer(inst, f.key, f.def.label, p)); },
    keypad: (f) => {
      setKeypad({ f });
      // Below 1024 px the keypad covers the lower half: bring the field it fills into the top half.
      if (typeof window !== "undefined" && window.innerWidth < 1024) requestAnimationFrame(() => scrollInPane(document.getElementById(`f-${f.addr}`), "start"));
    },
    skip: (t) => setSkip(t),
    photo: async (shot, file, fieldKey) => { await api.photo(file, { instance_id: shot.addr.split(":")[0], shot_key: shot.key, ...(fieldKey ? { field_key: fieldKey } : {}) }, shot.def.label); },
    discard: async (id) => { await wrap(api.discard(id, "Entered again on the visit device")); },
    resolve: (f, pick) => {
      const c = f.conflict; if (!c) return;
      const inst = f.addr.split(":")[0];
      if (c.rebase) { if (c.event_id) void wrap(api.discard(c.event_id, "Entered again after the visit was reopened")); if (f.def.type.startsWith("length")) setKeypad({ f }); else jump(f.addr); return; }
      const chosen = pick === "proposed" ? c.proposed : c.current ?? c.proposed;
      if (!c.current || !c.proposed || !chosen || chosen.available===false) return;
      void wrap(api.resolve(inst, f.key, c.current.revision, c.current.id, c.proposed.id, { status: chosen.status as AnswerPayload["status"], ...(chosen.status === "answered" ? { value: chosen.value } : {}), unit: chosen.unit??f.def.unit, ...(chosen.status==='skipped'?{skip_reason:chosen.skip_reason as AnswerPayload["skip_reason"],skip_note:chosen.skip_note??undefined}:{}) }, f.def.label)).then(() => { if (pick === "other") { if (f.def.type.startsWith("length")) setKeypad({ f }); else jump(f.addr); } });
    },
  };

  const next = () => {
    if (!section) return;
    const hit = nextOpen(model, section.instance.id, focusAddr ?? undefined);
    if (hit && hit.addr !== focusAddr) { jump(hit.addr); return; }
    const idx = model.sections.indexOf(section);
    const after = model.sections[idx + 1];
    guard(() => (after ? openSection(after.instance.id) : setSheet("wrap")));
  };

  const houseInst = model.sections.find((s) => s.module.key === "house");

  // r5: the close result's row buttons land here — the same ways forward Before you wrap has.
  const pickDate = () => { void api.ensureClosing().then((id) => { setSheet(null); openSection(id, `${id}:estimate_promised`); }); };
  const runAction = (action: string) => {
    const field = model.open.find((o) => o.kind === "field" && !o.partly) ?? model.open.find((o) => o.kind === "field");
    const shot = model.open.find((o) => o.kind === "shot");
    const go = (o: typeof field) => { if (o) openSection(o.section.instance.id, (o.item as { addr: string }).addr); else setSheet("wrap"); };
    switch (action) {
      case "review_flags": setSheet("flags"); break;
      case "review_trades": setSheet("trades"); break;
      case "review_rrp": setSheet("rrp"); break;
      case "pick_date": pickDate(); break;
      case "show_client": if (needDate) pickDate(); else api.showToClient(); break;
      case "go_field": go(field); break;
      case "take_photo": go(shot ?? field); break;
      case "add_instance": setView("list"); break;
      case "review_permissions": { const f = houseInst?.fields.find((x) => x.key === "photos_ok"); if (houseInst && f) openSection(houseInst.instance.id, f.addr); else setSheet("wrap"); break; }
      default: setSheet("wrap");
    }
  };
  const ranAction = useRef(false);
  useEffect(() => {
    if (!startAction || ranAction.current) return;
    ranAction.current = true; runAction(startAction); onStartAction?.();
  }, [startAction]); // eslint-disable-line react-hooks/exhaustive-deps
  const photosField = houseInst?.fields.find((f) => f.key === "photos_ok");
  const clientList = houseInst?.fields.find((f) => f.key === "client_list");

  // ── Opening (one card per line, Next advances) ──
  const visitLength = visitDuration(model.templates.map((t) => t.key));
  const openingLine = visitLength ? fill(W.openingLine, { duration: visitLength }) : W.openingLine.split(" · ")[0];
  const openingView = (
    <section className="px-4 pb-28 pt-5 lg:flex lg:min-h-full lg:flex-col lg:pb-0" aria-labelledby="opening-h">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{W.opening} · {openingStep + 1} of {opening.length || 1}</Eyebrow>
        {/* Narrow phones (<420 px): the bar holds only ‹ Sections and Next ›, so Back sits up here. */}
        {openingStep > 0 && <Btn tone="quiet" className="hidden max-[420px]:inline-flex" onClick={() => setOpeningStep(openingStep - 1)}>{W.previous}</Btn>}
      </div>
      <h1 id="opening-h" className="mt-1 font-serif text-[1.15em] font-semibold text-ink">{openingLine}</h1>
      <div className="mt-3 rounded-lg border-2 border-rule bg-card p-5 shadow-card">
        <p className="font-serif text-[1.25em] leading-snug text-ink">“{opening[openingStep] ?? ""}”</p>
      </div>
      {/* r6 D8: the card above already quotes the line, so the field under it drops its own Say. */}
      {/photos/i.test(opening[openingStep] ?? "") && photosField && <FieldRow f={hideSay(photosField)} actions={actions} sectionId={houseInst!.instance.id} />}
      {/anything you want to make sure/i.test(opening[openingStep] ?? "") && clientList && <FieldRow f={hideSay(clientList)} actions={actions} sectionId={houseInst!.instance.id} />}
      <BottomBar
        left={<span className="flex items-center gap-2">
          {/* ‹ Sections at every opening step (the client may walk off to the kitchen mid-script). */}
          <Btn className="lg:hidden" onClick={() => setView("list")}>‹ {W.sections}</Btn>
          {openingStep > 0 && <Btn tone="quiet" className="px-3 max-[420px]:hidden" onClick={() => setOpeningStep(openingStep - 1)}>{W.previous}</Btn>}
        </span>}
        right={<Btn tone="primary" className="ml-auto min-w-[8em]" onClick={() => (openingStep + 1 < opening.length ? setOpeningStep(openingStep + 1) : setView("list"))}>{W.next}</Btn>} />
    </section>
  );

  const listView = (
    <section className="px-4 py-4" aria-labelledby="list-h">
      <h1 id="list-h" className="font-serif text-[1.3em] font-semibold text-ink">{head}</h1>
      <p className="font-mono text-[0.9em] text-ink-2">{counts(model)}</p>
      {forgotClose && <div className="mt-3"><Banner kind="action" actions={<Btn tone="primary" onClick={() => setSheet("wrap")}>{W.closeVisit}</Btn>}>{W.notClosed} {W.orKeepWorking}</Banner></div>}
      <div className="mt-3"><SectionRows model={model} active={active} onOpen={(id) => openSection(id)} onAdd={(m) => addInstance(m)} /></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Btn onClick={() => { setOpeningStep(0); setView("opening"); }}>{W.opening}</Btn>
        <Btn tone="primary" onClick={() => setSheet("wrap")}>{W.beforeYouWrap}</Btn>
      </div>
    </section>
  );

  const sectionView = section && (
    <section className="px-4 pb-28 pt-4 lg:flex lg:min-h-full lg:flex-col lg:pb-0" aria-labelledby="sec-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>{display?.client}</Eyebrow>
          <h1 id="sec-h" className="font-serif text-[1.35em] font-semibold text-ink">{section.label}</h1>
          {section.module.key === "selections" && selectionHint(section.label) && <p className="text-[0.95em] text-ink-2">{selectionHint(section.label)}</p>}
          <p className="font-mono text-[0.9em] text-ink-2">{counts(section)}</p>
        </div>
        <MarkCell f={{ mark: section.mark, conflict: section.conflict, returnVisit: section.returnVisit }} />
      </div>
      {(prefill || visitorNotes) && <details className="mt-3 rounded-lg border-2 border-rule-soft bg-card p-3"><summary className="min-h-12 cursor-pointer py-3 font-semibold">What we know so far</summary>
        {visitorNotes && <p>{visitorNotes}</p>}
        {display?.address && <p>{display.address}</p>}{display?.phone && <p>{display.phone}</p>}
        {prefill?.intake.map((i,n)=><p key={`i${n}`}>{i.question}: {i.answer}</p>)}
        {prefill?.rough_estimate.map((i,n)=><p key={`r${n}`}>{i.label}{i.value!==undefined ? ` · ${String(i.value)}` : ''}</p>)}
        {prefill?.scope_items.map(i=><p key={i.key}>{i.title} · {i.quantities.map(q=>`${q.label}: ${q.qty??"Open"} ${q.unit??""}${q.basis ? ` · ${q.basis}` : ""}`).join("; ")}</p>)}
        {prefill?.plan_items.map((i,n)=><p key={`p${n}`}>{i.prompt} · {i.location}</p>)}
        {prefill?.photos.map(i=><p key={i.id}>{i.name}</p>)}
        {prefill?.discovery_notes.map((i,n)=><p key={`d${n}`}>{i.summary}</p>)}
        {section.module.key==='house' && prefill?.year_built && <><Btn onClick={()=>void api.answer(section.instance.id,'year_built','Year built',{status:'answered',value:Number(prefill.year_built)})}>Still right ✓ · {prefill.year_built}</Btn><Btn onClick={()=>jump(`${section.instance.id}:year_built`)}>Correct</Btn></>}
      </details>}
      {section.module.say.length > 0 && (
        <div className="mt-3 rounded-lg border-2 border-rule-soft bg-card p-3 lg:hidden">
          {section.module.say.map((l, i) => <p key={i} className="font-serif italic text-ink-2"><span className="not-italic font-semibold text-ink">{W.say}</span> {l}</p>)}
        </div>
      )}
      {section.module.key === "closing" && closingLines.length > 0 && (
        <div className="mt-3 rounded-lg border-2 border-rule-soft bg-card p-3">
          <Eyebrow>{W.script}</Eyebrow>
          {closingLines.map((l, i) => l.direction
            ? <p key={i} className="mt-2 rounded-md border-2 border-info bg-info-soft px-3 py-2 font-sans font-semibold text-ink"><span aria-hidden>→ </span>{l.text}</p>
            : <p key={i} className="mt-1 font-serif text-ink-2">“{l.text}”</p>)}
          <div className="mt-3 grid gap-2">
            {needDate && <p className="rounded-md border-2 border-info bg-info-soft px-3 py-2 font-semibold text-ink"><span aria-hidden>→ </span>{W.pickDateBeforeClient}</p>}
            <div className="flex flex-wrap gap-3">
              {needDate && dateField && <Btn tone="primary" onClick={() => jump(dateField.addr)}>{W.pickDate}</Btn>}
              <Btn tone={needDate ? "secondary" : "primary"} disabled={needDate} onClick={() => api.showToClient()}>{W.showToClient}</Btn>
            </div>
          </div>
        </div>
      )}
      {/* r4 R4-6: one column on tablet portrait (no half-width field beside empty space); two only from 1280 px. */}
      <div className="xl:grid xl:grid-cols-2 xl:gap-x-6">
        {section.fields.map((f) => <div key={f.addr} className={f.def.type === "text" || f.def.type === "multi" || f.shots.length || f.def.say || f.def.hint || (f.def.options?.length ?? 0) > 2 ? "xl:col-span-2" : ""}><FieldRow f={f} actions={actions} sectionId={section.instance.id} last={lastValue(section, f)} /></div>)}
      </div>
      {section.shots.map((s) => <PhotoRow key={s.key} shot={s} actions={actions} sectionId={section.instance.id} />)}
      {section.hidden.length > 0 && (
        <details className="mt-4 rounded-md border-2 border-rule-soft bg-paper px-3 py-2">
          <summary className="min-h-12 cursor-pointer py-3 font-semibold text-ink-2">Not on this job · {section.hidden.length}</summary>
          <ul className="pb-2">{section.hidden.map((f) => <li key={f.addr} className="flex justify-between gap-3 py-1 text-ink-2"><span>{f.def.label}</span><CoverageMark variant="coverage" state="not_applicable" size="sm" /></li>)}</ul>
        </details>
      )}
      {/* r5 domain 3: a required child that isn't there yet is listed like a missing top-level slot —
          "Vented appliance — 0/1 · Add" — so an offline Yes still shows what it needs. */}
      {section.missingRequiredChildren.filter((c) => c.missing > 0).map((c) => {
        const m = model.modules.find((x) => x.key === c.module_key); const noun = m ? moduleNoun(m) : c.title;
        return (
          <div key={`need-${c.module_key}`} className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border-2 border-rule bg-card px-3 py-2">
            <span className="min-w-0"><span className="font-semibold text-ink">{noun}</span> <span className="whitespace-nowrap font-mono text-[0.9em] text-ink-2">— {c.live}/{c.minimum}</span>
              <span className="mt-0.5 block"><CoverageMark variant="coverage" state="open" size="sm" /></span></span>
            <Btn onClick={() => addInstance(c.module_key, section.instance.id)} aria-label={fill(W.addInstance, { name: noun.toLowerCase() })}>{W.addChild}</Btn>
          </div>
        );
      })}
      {model.slots.filter((s) => s.parent === section.module.key && !section.missingRequiredChildren.some((c) => c.module_key === s.module.key && c.missing > 0)).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {model.slots.filter((s) => s.parent === section.module.key && !section.missingRequiredChildren.some((c) => c.module_key === s.module.key && c.missing > 0)).map((slot) => <Btn key={slot.module.key} onClick={() => addInstance(slot.module.key, section.instance.id)}>+ {moduleNoun(slot.module)}</Btn>)}
        </div>
      )}
      {section.children.length > 0 && (
        <ul className="mt-3 grid gap-2">{model.sections.filter((c) => section.children.includes(c.instance.id)).map((c) => <li key={c.instance.id}><Btn wide className="justify-between" onClick={() => guard(() => openSection(c.instance.id))}><span>↳ {c.label}</span><MarkCell f={{ mark: c.mark, conflict: c.conflict }} /></Btn></li>)}</ul>
      )}
      {section.module.repeatable && section.children.length === 0 && (
        <div className="mt-6"><Btn tone="quiet" onClick={() => setRemove(section)}>{fill(W.removeInstance, { name: section.label })}</Btn></div>
      )}
      <div className="lg:h-6" aria-hidden />
      <BottomBar left={<Btn className="lg:hidden" onClick={() => guard(() => setView("list"))}>‹ {W.sections}</Btn>}
        right={<Btn tone="primary" className="ml-auto min-w-[8em]" onClick={next}>{W.next}</Btn>} />
    </section>
  );

  // Left pane on tablet landscape: while the opening card shows a line, the pane shows only the
  // *next* line (never the same one twice); on the list there is no script, so no heading either.
  const paneScript = view === "opening"
    ? (opening[openingStep + 1] ? [opening[openingStep + 1]] : [])
    : view === "section" && section ? section.module.say : [];
  const body = view === "opening" ? openingView : view === "section" && section ? sectionView : listView;
  return (
    <>
      {err && <div className="px-4 pt-3"><Banner kind="action" actions={<Btn onClick={() => setErr(null)}>{W.close}</Btn>}>{plainWords(err, { field: lastSaved ?? "—", name: userName })}</Banner></div>}
      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <aside className="hidden border-r-2 border-rule-soft lg:block lg:overflow-y-auto" aria-label={W.sections}>
          <div className="px-4 py-4">
            {paneScript.length > 0 && <>
              <Eyebrow>{W.script}</Eyebrow>
              <div className="mb-6">{paneScript.map((l, i) => <p key={i} className="mt-2 font-serif text-[1.05em] italic text-ink-2">{view === "opening" && <span className="not-italic font-semibold text-ink">{W.nextLine} </span>}“{l}”</p>)}</div>
            </>}
            <Eyebrow>{W.sections}</Eyebrow>
            <p className="font-mono text-[0.85em] text-ink-2">{counts(model)}</p>
            <div className="mt-2"><SectionRows compact model={model} active={active} onOpen={(id) => guard(() => openSection(id))} onAdd={(m) => addInstance(m)} /></div>
            <div className="mt-4 grid gap-3"><Btn onClick={() => { setOpeningStep(0); setView("opening"); }}>{W.opening}</Btn><Btn tone="primary" onClick={() => setSheet("wrap")}>{W.beforeYouWrap}</Btn></div>
          </div>
        </aside>
        <div ref={main} className="min-w-0 lg:overflow-y-auto">{view === "list" ? <><div className="lg:hidden">{listView}</div><div className="hidden lg:block">{sectionView}</div></> : body}{keypad && <div aria-hidden className="h-[60dvh] lg:hidden" />}</div>
      </div>

      {keypad && <Keypad open def={keypad.f.def} label={keypad.f.def.label} initial={keypad.f.answer?.status === "answered" ? keypad.f.answer.value : undefined} last={section ? lastValue(section, keypad.f) : undefined}
        onClose={() => setKeypad(null)} onSave={async (value) => { await actions.answer(keypad.f, { status: "answered", value, unit: keypad.f.def.unit }); setKeypad(null); }} />}
      {skip && <SkipSheet field={skip.field?.def} open label={skip.field?.def.label ?? skip.shot?.def.label ?? ""} tier={skip.field?.def.tier ?? skip.shot?.def.tier ?? "price_critical"} isShot={!!skip.shot}
        saveError={saveError} initial={draft.skips[skip.field?.addr ?? skip.shot?.addr ?? ""]} onClose={() => setSkip(null)}
        onSave={async (v: SkipValue) => {
          const key = skip.field?.addr ?? skip.shot!.addr;
          const next = { ...draft, skips: { ...draft.skips, [key]: v } };
          if (skip.field) { const inst = skip.field.addr.split(":")[0]; if(skip.field.key==="client_initials") next.ack_reason=[v.reason,v.note].filter(Boolean).join(" · "); await wrap(api.answer(inst, skip.field.key, skip.field.def.label, { status: "skipped", skip_reason: v.reason, skip_note: v.note, unit: skip.field.def.unit }, next)); }
          else if(!await api.setDraft(next)) return;
          setSkip(null);
        }} />}
      <WrapSheet open={sheet === "wrap"} onClose={() => setSheet(null)} model={model} draft={draft} hasInitials={hasInitials} refused={refused} needDate={needDate}
        onGo={(id, addr) => { setSheet(null); openSection(id, addr); }} onFlags={() => setSheet("flags")} onTrades={() => setSheet("trades")} onRrp={() => setSheet("rrp")} onClient={() => { setSheet(null); api.showToClient(); }} onAck={() => setSheet("ack")}
        onCloseVisit={() => { setSheet(null); api.close(); }}
        onPromised={pickDate} />
      {sheet === "flags" && <FlagSheet open onClose={() => setSheet("wrap")} model={model} draft={draft} saveError={saveError} onSave={api.setDraft} onGo={(id, addr) => { setSheet(null); openSection(id, addr); }} />}
      {sheet === "trades" && <TradeSheet open onClose={() => setSheet("wrap")} model={model} draft={draft} saveError={saveError} onSave={api.setDraft} />}
      {sheet === "rrp" && <RrpSheet model={model} onGo={() => {setSheet(null);const id=model.sections.find(s=>s.module.key==="era")?.instance.id;if(id)openSection(id);}} open onClose={() => setSheet("wrap")} draft={draft} saveError={saveError} onSave={api.setDraft} />}
      {sheet === "ack" && <AckSheet summaryText={api.ackSummary} open onClose={() => setSheet("wrap")} draft={draft} saveError={saveError} onSave={api.setDraft} />}
      {/* r4 R4-2: the leave check is a bottom sheet beside the thumb that tapped ‹ Sections / Next, never a
          banner at the top of a long section. */}
      {leave && (() => { const from = model.sections.find((s) => s.instance.id === leave.from); if (!from) return null; const l = leaveList(model, from.instance.id); return (
        <Sheet open dock compact noClose onClose={() => setLeave(null)} title={fill(W.leaveStill, { section: from.label })}
          footer={<><Btn onClick={() => { setLeave(null); const h = nextOpen(model, from.instance.id); if (h) jump(h.addr); }}>{W.goBack}</Btn><Btn tone="primary" onClick={() => { const go = leave.go; setLeave(null); go(); }}>{W.leaveForNow}</Btn></>}>
          <ul className="grid gap-2 text-ink">
            {l.open.length > 0 && <li><span className="font-semibold">{W.leaveOpen}</span> {leaveLine(l.open)}</li>}
            {l.partly.length > 0 && <li><span className="font-semibold">{W.leavePartly}</span> {leaveLine(l.partly)}</li>}
          </ul>
        </Sheet>); })()}
      <Sheet open={!!remove} onClose={() => setRemove(null)} title={remove ? fill(W.removeInstance, { name: remove.label }) : ""}
        footer={<><Btn onClick={() => setRemove(null)}>{W.cancel}</Btn><Btn tone="danger" onClick={() => { const r = remove!; setRemove(null); setView("list"); void wrap(api.removeInstance(r.instance.id, r.label)); }}>{W.remove}</Btn></>}>
        <p className="text-ink">{remove ? fill(W.removeConfirm, { name: remove.label }) : ""}</p>
      </Sheet>
    </>
  );
}
