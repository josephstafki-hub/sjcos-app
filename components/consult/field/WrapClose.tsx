"use client";
/**
 * Before you wrap (plan §6.9 sheet, §5.5), flag decisions (§10.3 check 9), trade walks
 * (check 11), Renovate Right (check 8), the declined-initials reason (check 5), and the
 * close result: Visit closed — sending · Complete · Needs finishing (n open) with the
 * failing checks in plain words. No item count is a score; the server decides Complete.
 */
import {closeAction, closeResultOpenCount, completeCountsLine, openCheckPhrase, openItemCount} from '@/lib/consult/completeness';
import { useEffect, useRef, useState } from "react";
import { CoverageMark } from "@/components/ui/CoverageMark";
import type { EvidenceDraft, FieldView, ShotView, VisitModel } from "@/lib/consult/ui/model";
import type { ClosingState } from "@/lib/consult/ui/controller";
import { CHECK_ACTION_WORDS, CLOSE_FIX_LABEL, FLAG_CHOICES, W, closeRefusal, closeRefusalCalm, fill, plainWords, quantitiesLine, reopenedHead, type CloseFix, type RefusalPlace } from "@/lib/consult/ui/words";
import type { Snapshot } from "@/lib/consult/ui/model";
import { flagLead } from "@/lib/consult/ui/flag-lead";
import { MeasureText } from "../MeasureText";
import { centralTime } from "./GetReady";
import { CertWarningList } from "../CertWarning";
import { certDate, clampDay, type CertificationWarning } from "@/lib/consult/rrp";
import { Banner, Box, Btn, Choice, DotLine, LinkBtn, Sheet, TextInput } from "./primitives";

const itemLabel = (o: VisitModel["open"][number]) => (o.kind === "field" ? (o.item as FieldView).def.label : `Photo · ${(o.item as ShotView).def.label}`);
const itemAddr = (o: VisitModel["open"][number]) => (o.kind === "field" ? (o.item as FieldView).addr : (o.item as ShotView).addr);
const WRAP_GROUP_MAX = 5;
const promisedLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** Open items grouped by section, in visit order (first appearance). */
function groupBySection(list: VisitModel["open"]) {
  const out: { section: VisitModel["open"][number]["section"]; items: VisitModel["open"] }[] = [];
  for (const o of list) { const g = out.find((x) => x.section.instance.id === o.section.instance.id); if (g) g.items.push(o); else out.push({ section: o.section, items: [o] }); }
  return out;
}

/** r9 R9-3: who reopened the visit, when and why — calm, the "What we know so far" card's style. */
export function ReopenedNote({ reopened, className = "" }: { reopened?: Snapshot["reopened"]; className?: string }) {
  if (!reopened?.reason?.trim()) return null;
  return <p role="note" className={`rounded-lg border-2 border-rule-soft bg-card px-3 py-2 text-ink ${className}`}><span className="font-semibold">{reopenedHead(reopened)}</span> — {reopened.reason.trim()}</p>;
}

/** r9 / r10 R10-2: a certification that runs out before the planned finish — advice, never a close block. */
export function CertWarnings({ list, className = "" }: { list: CertificationWarning[]; className?: string }) {
  return <CertWarningList list={list} className={className} />;
}

export function WrapSheet({ open, onClose, model, draft, hasInitials, refused, onGo, onFlags, onTrades, onRrp, onClient, onAck, onCloseVisit, onPromised, needDate, reopened, refusedNote }: {
  open: boolean; onClose: () => void; model: VisitModel; draft: EvidenceDraft; hasInitials: boolean; refused: number;
  onGo: (sectionId: string, addr: string) => void; onFlags: () => void; onTrades: () => void; onRrp: () => void; onClient: () => void; onAck: () => void; onCloseVisit: () => void; onPromised?: () => void;
  /** r5 domain 2: no estimate date yet (and not skipped) — the client would initial a sheet without it. */
  needDate?: boolean;
  /** r9 R9-3: set while a reopened visit is waiting for its next close. */
  reopened?: Snapshot["reopened"];
  /** r12 extra: opened from a refused close the office named no field for — say why it opened. */
  refusedNote?: boolean;
}) {
  const required = model.open.filter((o) => !o.partly);
  const partly = model.open.filter((o) => o.partly);
  const undecidedFlags = model.flags.filter((f) => !draft.flags[f.key]?.note?.trim());
  const trades = [...new Set([...model.touchedTrades, ...draft.trade_walks.map((w) => w.trade)])].filter(Boolean);
  const undecidedTrades = trades.filter((t) => !draft.trade_walks.some((w) => w.trade === t && typeof w.needed === "boolean" && w.reason.trim()));
  const tradesOpen = trades.length ? undecidedTrades.length > 0 : !draft.no_trades_confirmed;
  const rrpOpen = model.rrpApplies && !(model.rrp.receipt && model.rrp.firm_current && model.rrp.renovator_current);
  const ackOpen = !hasInitials && !draft.ack_reason?.trim();
  // r7: "Joe sets the date" (or Other with a note) settles the date check, as the server counts it.
  const dateSkip = model.sections.find((s) => s.module.key === "closing")?.fields.find((f) => f.key === "estimate_promised")?.answer;
  const dateSkipped = !model.promised && dateSkip?.status === "skipped" && (dateSkip.skip_reason === "Joe sets the date" || (dateSkip.skip_reason === "Other" && !!dateSkip.skip_note?.trim()));
  const dateOk = !!model.promised || dateSkipped;
  const blocking = required.length > 0 || undecidedFlags.length > 0 || tradesOpen || rrpOpen || ackOpen || model.conflicts.length > 0 || refused > 0 || !dateOk;
  // r4 R4-5: the header says only what the list under it shows — Partly appears when there is any.
  // r7 extra: "246 still open", the close checks' own phrasing (no capital O mid-sentence).
  const conflictN = model.conflicts.length;
  const firstConflict = model.conflicts[0];
  // r10 extra: the header counts every close line listed below — one per conflict, as each has its own line.
  // r9 R9-2: while a conflict is open the button says why it waits, and one line above it says what to do.
  const closeLabel = conflictN ? (conflictN === 1 ? W.closeVisitPickConflict : W.closeVisitPickConflicts) : blocking ? W.closeVisitNeeds : W.closeVisit;
  const conflictName = (c: VisitModel["conflicts"][number]) => { const s = model.sections.find((x) => x.instance.id === c.instance_id); const f = s?.fields.find((x) => x.addr === c.key); return [s?.label, f?.def.label ?? c.field_key].filter(Boolean).join(" › "); };
  const title = `${W.beforeYouWrap} · ${openItemCount({price_critical:model.pc,record:model.record}, [undecidedFlags.length > 0,tradesOpen,rrpOpen,ackOpen,!dateOk,refused > 0].filter(Boolean).length + conflictN)} ${W.stillOpen}${partly.length ? ` · ${partly.length} Partly` : ""}`;
  return (
    <Sheet open={open} onClose={onClose} side title={title}
      footer={<>
        {/* r10 R10-3: words left, a 56 px Go to field right (under them when narrow) — no separator dot.
            While a conflict is open the sheet's own Close is the way back, so Keep working steps aside.
            r14 extra: Go to field is the outlined secondary button (full width when narrow), as on every
            other Go to field, so it reads as the way forward above the greyed Close visit. */}
        {firstConflict && <div className="flex w-full basis-full flex-wrap items-center justify-between gap-x-3 gap-y-2 text-ink">
          <p className="min-w-0"><span aria-hidden className="mr-1 font-bold text-flag">!</span><span className="font-semibold">{fill(conflictN === 1 ? W.conflictBeforeClose : W.conflictsBeforeClose, { n: conflictN })}</span></p>
          <Btn className="max-md:w-full" onClick={() => onGo(firstConflict.instance_id, firstConflict.key)}>{W.goToField}</Btn>
        </div>}
        {!firstConflict && <Btn className="max-md:w-full" onClick={onClose}>{W.keepWorking}</Btn>}<Btn tone="primary" className="max-md:w-full" onClick={onCloseVisit} disabled={conflictN > 0 || refused > 0}>{closeLabel}</Btn></>}>
      <ReopenedNote reopened={reopened} className="mb-3" />
      {refusedNote && <div className="mb-3"><Banner kind="status">{W.wrapRefusedNote}</Banner></div>}
      <div className="mb-5 grid gap-3">
        {/* r3 C7: what stops a Complete close comes first — flags, promised date, client initials. */}
        {model.flags.length > 0 && <Line text={undecidedFlags.length ? fill(undecidedFlags.length === 1 ? W.flagsLine : W.flagsLinePlural, { n: undecidedFlags.length }) : `Flags: all ${model.flags.length} decided ✓`} action={<Btn onClick={onFlags}>{W.reviewFlags}</Btn>} done={undecidedFlags.length === 0} />}
        {/* r14 extra: "Thu, Nov 12 ✓" stays together — the ✓ never wraps alone. */}
        <Line text={model.promised ? <>{W.promisedBy} <span className="whitespace-nowrap">{promisedLabel(model.promised)} ✓</span></> : dateSkipped ? (dateSkip!.skip_reason === "Joe sets the date" ? W.promisedJoeSets : `${W.promisedSkipped} · ${dateSkip!.skip_note!.trim()} ✓`) : W.promisedMissing} action={dateOk ? undefined : onPromised && <Btn onClick={onPromised}>{W.pickDate}</Btn>} done={dateOk} />
        {/* r5: the same row shape as every other card — words left, the two buttons stacked on the right. */}
        <Line text={hasInitials ? "Client initials ✓" : draft.ack_reason ? `No initials · ${draft.ack_reason}` : "Client initials — not yet"} note={!hasInitials && needDate ? `→ ${W.pickDateBeforeClient}` : undefined}
          action={hasInitials ? undefined : <span className="grid justify-items-stretch gap-2"><Btn onClick={onClient} disabled={needDate}>{W.showToClient}</Btn><Btn tone="quiet" onClick={onAck}>{W.noInitialsSay}</Btn></span>} done={!ackOpen} />
        <Line text={trades.length ? (undecidedTrades.length ? fill(W.tradeWalksLine, { trade: undecidedTrades.join(", ") }) : "Trade walks: all decided ✓") : draft.no_trades_confirmed ? "Trade walks: none — no trade is touched ✓" : "Trade walks: confirm none is needed"} action={<Btn onClick={onTrades}>{tradesOpen ? W.decide : W.review}</Btn>} done={!tradesOpen} />
        {model.sections.filter(s=>s.module.key==='footing').map(s=>{const zone=s.fields.find(f=>f.key==='frost_zone')?.answer;return zone?.status==='answered' ? <Line key={s.instance.id} text={`County frost zone: ${String(zone.value)}`} info /> : null;})}
        {model.rrpApplies && <Line text={rrpOpen ? fill(W.rrpNeeds, { list: [!model.rrp.receipt && W.rrpShortReceipt, !model.rrp.firm_current && (model.values["era.firm_cert_expiry"] ? W.rrpShortFirm : W.rrpShortFirmMissing), !model.rrp.renovator_current && (model.values["era.renovator_expiry"] ? W.rrpShortRenovator : W.rrpShortRenovatorMissing)].filter(Boolean).join(" · ") }) : W.rrpRecorded} action={<Btn onClick={onRrp}>{W.rrpReview}</Btn>} done={!rrpOpen} />}
        <CertWarnings list={model.certificationWarnings ?? []} />
        {/* r9 R9-2: "Section › Field", the office heading's form; "Conflict:" when there is one. */}
        {model.conflicts.map((c) => <Line key={c.key} text={fill(conflictN === 1 ? W.conflictLine : W.conflictsLine, { field: conflictName(c) })} action={<Btn onClick={() => onGo(c.instance_id, c.key)}>{W.goToField}</Btn>} warn />)}
        {refused > 0 && <Line text={`${refused} ${refused === 1 ? "answer was" : "answers were"} refused by the office — enter again or remove`} warn />}
      </div>
      {required.length === 0 && partly.length === 0 && <p className="mb-3 font-semibold text-accent-2">✓ {W.allClear}</p>}
      {/* §5.5 / §6.9: grouped by section. A section with more than 5 open collapses to one row. */}
      <div className="grid gap-4">
        {groupBySection([...required, ...partly]).sort((a, b) => model.sections.indexOf(a.section) - model.sections.indexOf(b.section)).map(({ section, items }) => {
          const sid = section.instance.id;
          const big = items.length > WRAP_GROUP_MAX;
          return (
            <section key={sid} aria-label={section.label} className="border-b-2 border-rule-soft pb-2">
              {/* r3 C7: one position for the button on every row — name and count left, button right. */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <h3 className="min-w-0 break-words font-semibold text-ink">{section.label} <span className="whitespace-nowrap font-mono text-[0.9em] font-normal text-ink-2">· {fill(W.nOpenInSection, { n: items.length })}</span></h3>
                <Btn onClick={() => onGo(sid, itemAddr(items[0]))}>{W.goToSection}</Btn>
              </div>
              {!big && <ul className="mt-1 grid gap-1">
                {items.map((o) => {
                  const f = o.kind === "field" ? (o.item as FieldView) : null;
                  return (
                    <li key={`${sid}:${itemAddr(o)}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1">
                      <div className="min-w-0">
                        <p className="text-ink">{itemLabel(o)}<span aria-label={W.required} className="text-flag"> *</span></p>
                        <span className="flex flex-wrap gap-2"><CoverageMark variant="coverage" state={o.partly ? "partial" : "open"} />{f?.returnVisit && <CoverageMark variant="coverage" state="return_visit" />}</span>
                      </div>
                      {!f?.returnVisit && <Btn onClick={() => onGo(sid, itemAddr(o))}>{o.kind === "shot" ? W.goToPhoto : W.goToField}</Btn>}
                    </li>
                  );
                })}
              </ul>}
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}

/** r4 R4-5: a not-done-yet line is the neutral ○ Open (mark + word, card fill); only `warn`
 *  (a conflict, a refused answer) is the ! Problem style. Done lines carry their own ✓ in the text.
 *  r6 D2: below 600 px every line stacks — mark and words, then the note, then the button(s) at full
 *  width; side by side from 600 px. ○ Open is the 15 px row mark (r6 extra). */
function Line({ text, action, warn, stack, done, info, note }: { text: React.ReactNode; action?: React.ReactNode; warn?: boolean; stack?: boolean; done?: boolean; info?: boolean; note?: string }) {
  return (
    <div className={`grid gap-2 rounded-md border-2 px-3 py-2 ${action && !stack ? "min-[600px]:grid-cols-[minmax(0,1fr)_auto] min-[600px]:items-center" : ""} ${warn ? "border-flag bg-flag-soft" : done || info ? "border-rule-soft bg-paper" : "border-rule bg-card"}`}>
      <div className="min-w-0">
        {warn ? <p className="text-ink"><span aria-hidden className="mr-1 font-bold text-flag">!</span>{text}</p>
          : done || info ? <p className="text-ink">{text}</p>
          : <p className="flex flex-wrap items-baseline gap-x-2 text-ink"><CoverageMark variant="coverage" state="open" /><span className="min-w-0 break-words">{text}</span></p>}
        {note && <p className="mt-1 text-[0.9em] font-semibold text-ink-2">{note}</p>}
      </div>
      {action && <div className="grid gap-2 max-[599px]:[&_button]:w-full">{action}</div>}
    </div>
  );
}

export function FlagSheet({ open, onClose, model, draft, onSave, saveError, onGo }: { open: boolean; onClose: () => void; model: VisitModel; draft: EvidenceDraft; saveError?: string | null; onSave: (d: EvidenceDraft) => Promise<boolean>; onGo?: (sectionId: string, addr: string) => void }) {
  const [local, setLocal] = useState(draft.flags);
  const set = (key: string, patch: Partial<EvidenceDraft["flags"][string]>) => setLocal((l) => ({ ...l, [key]: { disposition: l[key]?.disposition ?? "price_it", note: l[key]?.note ?? "", ...patch } }));
  return (
    <Sheet open={open} onClose={onClose} side title={W.flagTitle} footer={<><Btn onClick={onClose}>{W.cancel}</Btn><Btn tone="primary" onClick={async () => { if(await onSave({ ...draft, flags: local })) onClose(); }}>{W.save}</Btn></>}>
      {saveError && <Banner kind="action">{plainWords(saveError)}</Banner>}
      <div className="grid gap-5">
        {/* r7 extra: the title sits inside the card (no legend breaking the border). A kept toilet's
            clearance is advice for Joe (kind "advisory"), shown calm — not the code flag. */}
        {model.flags.map((f) => (
          <section key={f.key} aria-label={`${f.section.label} · ${f.field.def.label}`} className={`rounded-lg border-2 p-3 ${f.kind === "advisory" ? "border-rule-soft bg-paper" : "border-rule"}`}>
            <p className={`mb-1 font-semibold ${f.kind === "advisory" ? "text-ink" : "text-flag"}`}><span aria-hidden>{f.kind === "advisory" ? "⚐" : "⚑"} </span>{f.section.label} · {f.field.def.label}</p>
            <p className="mb-2 text-ink"><MeasureText text={flagLead(f, model)} /></p>
            {onGo && <div className="mb-3"><Btn tone="quiet" onClick={() => onGo(f.address.split(":")[0], f.address)}>{W.goToField}</Btn></div>}
            <Choice options={FLAG_CHOICES.map((c) => c.key)} labels={(k) => FLAG_CHOICES.find((c) => c.key === k)!.label} value={local[f.key]?.disposition ?? null} onPick={(v) => set(f.key, { disposition: v })} />
            <div className="mt-3"><TextInput label={W.flagNote} value={local[f.key]?.note ?? ""} onChange={(v) => set(f.key, { note: v })} multiline /></div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/** r12 extra: "Dec 10" — the trade-walk day as words, the same way the promised date is said. */
const walkDayLabel = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : d;

export function TradeSheet({ open, onClose, model, draft, onSave, saveError, toDay }: { open: boolean; onClose: () => void; model: VisitModel; draft: EvidenceDraft; saveError?: string | null; onSave: (d: EvidenceDraft) => Promise<boolean>;
  /** r12 extra: opened from the "Only Joe can set a trade-walk day" refusal — scroll to the trade that has the day. */
  toDay?: boolean }) {
  const initial = [...new Set([...model.touchedTrades, ...draft.trade_walks.map((w) => w.trade)])].filter(Boolean).map((t) => draft.trade_walks.find((w) => w.trade === t) ?? { trade: t, needed: null, reason: "" });
  const [walks, setWalks] = useState(initial);
  const [none, setNone] = useState(draft.no_trades_confirmed);
  const [extra, setExtra] = useState("");
  const set = (i: number, patch: Partial<EvidenceDraft["trade_walks"][number]>) => setWalks((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const dayRef = useRef<HTMLFieldSetElement | null>(null);
  const firstDay = walks.findIndex((w) => !!w.day);
  useEffect(() => { if (open && toDay) dayRef.current?.scrollIntoView({ block: "center" }); }, [open, toDay]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} side title={W.tradeWalkTitle} footer={<><Btn onClick={onClose}>{W.cancel}</Btn><Btn tone="primary" onClick={async () => { if(await onSave({ ...draft, trade_walks: walks, no_trades_confirmed: walks.length === 0 && none })) onClose(); }}>{W.save}</Btn></>}>
      {saveError && <Banner kind="action">{plainWords(saveError)}</Banner>}
      <div className="grid gap-5">
        {walks.map((w, i) => (
          <fieldset key={w.trade} ref={i === firstDay ? dayRef : undefined} className="rounded-lg border-2 border-rule p-3">
            <legend className="px-1 font-semibold text-ink">{w.trade}</legend>
            {/* r12 extra: the day only Joe sets is said on its trade, with the way to remove it beside it. */}
            {w.day && <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 max-sm:grid-cols-1">
              <p className="text-ink"><span aria-hidden className="mr-1 font-semibold text-ink-2">⚐</span>{fill(W.tradeWalkDay, { day: walkDayLabel(w.day) })}</p>
              <Btn className="max-sm:w-full" onClick={() => set(i, { day: undefined })}>{W.tradeWalkDayOff}</Btn>
            </div>}
            <Choice label={W.needsWalk} options={[true, false] as const} value={w.needed} onPick={(v) => set(i, { needed: v })} labels={(v) => (v ? W.yes : W.no)} columns={2} />
            <div className="mt-3"><TextInput label={W.reason} value={w.reason} onChange={(v) => set(i, { reason: v })} multiline /></div>
          </fieldset>
        ))}
        {walks.length === 0 && <Choice options={[true] as const} value={none ? true : null} onPick={() => setNone(!none)} labels={() => W.noTrades} />}
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const t = extra.trim(); if (t && !walks.some((w) => w.trade === t)) { setWalks([...walks, { trade: t, needed: null, reason: "" }]); setExtra(""); setNone(false); } }}>
          <div className="min-w-0 flex-1"><TextInput label="Another touched trade" value={extra} onChange={setExtra} /></div>
          <Btn type="submit" disabled={!extra.trim()}>{W.addTrade}</Btn>
        </form>
      </div>
    </Sheet>
  );
}

export function RrpSheet({ model, onGo, open, onClose, draft, onSave, saveError }: { open: boolean; onClose: () => void; draft: EvidenceDraft; saveError?: string | null; onSave: (d: EvidenceDraft) => Promise<boolean>; model: VisitModel; onGo: () => void }) {
  const [rrp, setRrp] = useState(draft.rrp);
  const dayWindow = model.redeliveryWindow;
  const toggle = (k: "receipt" | "firm_current" | "renovator_current" | "redelivery_required", label: string) => (
    <button type="button" role="checkbox" aria-checked={rrp[k]} onClick={() => setRrp({ ...rrp, [k]: !rrp[k] })}
      className={`min-h-14 rounded-md border-2 px-3 py-2 text-left font-semibold ${rrp[k] ? "border-accent bg-accent-soft text-ink" : "border-rule bg-card text-ink-2"}`}>
      <Box on={rrp[k]} />{label}
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} side title={W.rrpTitle} footer={<><Btn onClick={onClose}>{W.cancel}</Btn><Btn tone="primary" onClick={async () => { if(await onSave({ ...draft, rrp })) onClose(); }}>{W.save}</Btn></>}>
      {saveError && <Banner kind="action">{plainWords(saveError)}</Banner>}
      <p className="mb-3 text-ink-2">{W.rrpWhy}</p>
      <CertWarnings list={model.certificationWarnings ?? []} className="mb-3" />
      {/* Read from the Era answers (model.rrp) — never ticked here, so it can't disagree with them. */}
      <ul className="grid gap-2" aria-label={W.rrpTitle}>
        {([["receipt", W.rrpReceipt, W.rrpReceiptOpen], ["firm_current", W.rrpFirm, W.rrpFirmOpen], ["renovator_current", W.rrpRenovator, W.rrpRenovatorOpen]] as const).map(([key, label, open]) => (
          <li key={key} className={`grid grid-cols-[auto_1fr] items-start gap-3 rounded-md border-2 px-3 py-2 ${model.rrp[key] ? "border-rule-soft bg-paper" : "border-flag bg-flag-soft"}`}>
            <CoverageMark variant="ready" state={model.rrp[key] ? "done" : "problem"} size="sm" />
            <span className="min-w-0 text-ink"><span className="font-semibold">{label}</span>{!model.rrp[key] && <span className="block text-[0.95em]">{open}</span>}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3">
        <Btn onClick={onGo}>{W.rrpGoEra}</Btn>{toggle("redelivery_required", W.rrpRedelivery)}
        {/* r11 domain Fix 1: with the start known the day is limited to start − 60 … start − 7 (40 CFR 745.84(a)(1)),
            and the hint says why. With no start yet it stays open; the office clamps it once the start is set. */}
        {rrp.redelivery_required && <label className="block"><span className="font-semibold">{W.rrpRedeliveryDay}</span>
          {dayWindow && <span id="rrp-redelivery-why" className="mt-1 block text-ink-2">{W.rrpRedeliveryWindow} {W.rrpRedeliveryRange.split(/(\{from\}|\{to\})/).map((part, i) => part === "{from}" ? <span key={i} className="whitespace-nowrap">{certDate(dayWindow.min)}</span> : part === "{to}" ? <span key={i} className="whitespace-nowrap">{certDate(dayWindow.max)}</span> : part)}</span>}
          <input type="date" min={dayWindow?.min} max={dayWindow?.max} aria-describedby={dayWindow ? "rrp-redelivery-why" : undefined} value={rrp.redelivery_day ?? ""} onChange={(e) => setRrp({ ...rrp, redelivery_day: e.target.value ? clampDay(e.target.value, dayWindow) : undefined })} className="mt-1 block min-h-14 rounded-md border-2 border-rule bg-card px-3 text-[max(16px,1em)]" /></label>}
      </div>
    </Sheet>
  );
}

export function AckSheet({ open, onClose, draft, onSave, saveError, summaryText }: { summaryText?: string; open: boolean; onClose: () => void; draft: EvidenceDraft; saveError?: string | null; onSave: (d: EvidenceDraft) => Promise<boolean> }) {
  const [why, setWhy] = useState(draft.ack_reason ?? "");
  return (
    <Sheet open={open} onClose={onClose} title={W.noInitialsWhy} footer={<><Btn onClick={onClose}>{W.cancel}</Btn><Btn tone="primary" disabled={!why.trim()} onClick={async () => { if(await onSave({ ...draft, ack_reason: why.trim() })) onClose(); }}>{W.save}</Btn></>}>
      {saveError && <Banner kind="action">{plainWords(saveError)}</Banner>}
      <div className="grid gap-3">
        {summaryText && <details><summary>Summary saved with this reason</summary><p className="whitespace-pre-wrap">{summaryText}</p></details>}
        <Choice options={[W.noInitialsAbsent, W.noInitialsDeclined, "Other"]} value={why === W.noInitialsAbsent || why === W.noInitialsDeclined ? why : null} onPick={setWhy} columns={2} />
        <TextInput label={W.reason} value={why} onChange={setWhy} />
      </div>
    </Sheet>
  );
}

/** Visit closed — sending → Complete / Needs finishing, the same words for Joe's and staff visits. */
export function ClosingScreen({ closing, unsent, online, autoApply, findings, findingsCode, unmeasured = 0, onSend, onRetry, onKeepWorking, onReopen, onApply, onAction, onRefused, signInHref, staff = false, closedAt, refusedPlace }: {
  closing: ClosingState; unsent: number; online: boolean; autoApply: boolean; findings: { status: string; last_error: string | null } | null; findingsCode: string | null;
  /** r8 domain E4: estimate quantities with no measured answer, said under ✓ Complete. */
  unmeasured?: number;
  onSend: () => void; onRetry: () => void; onKeepWorking: () => void; onReopen: (reason: string) => Promise<void>; onApply: () => void; home: string;
  /** r5: an open check's own way forward (Review flags, Pick the date, Show to client, …) — back on the visit. */
  onAction?: (action: string) => void;
  /** r10 R10-1: a refused close's way forward (Reload, Back to visits, Send now then close again, Go to field,
   *  Try again) or Keep working. Each drops or rebuilds the refused close so it can't pop back up. */
  onRefused?: (fix: CloseFix | "retry") => void;
  /** r11 R11-1: the same /login?next= link the signed-out banner uses. */
  signInHref?: string;
  /** r11 extra: a staff visitor sees "Joe applies the findings" instead of the Apply findings button. */
  staff?: boolean;
  /** r11 extra: the close time, said in the ✓ Complete heading as the opened Complete screen does. */
  closedAt?: string | null;
  /** r14 R14-1: the answer a refused close named, when the app can place it (closeRefusalPlace). */
  refusedPlace?: RefusalPlace | null;
}) {
  const [reopening, setReopening] = useState(false); const [reason, setReason] = useState(""); const [err, setErr] = useState<string | null>(null);
  const r = closing.result;
  const closedWhen = closedAt ? centralTime(closedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const openN = r ? closeResultOpenCount(r) : 0;
  // r7 R7-2: a slow office (408 / 429 / 5xx, the 15 s request deadline, or this device's answers still
  // on their way after a timed-out send while online) is the calm "◐ Still closing…", never the red generic error.
  const slow = closing.step === "error" && (closing.code === "close_timeout" || /^http_(408|429|5\d\d)$/.test(closing.code ?? "") || (online && closing.code === "manifest_sequence_gap"));
  return (
    <section className="mx-auto w-full max-w-[640px] px-4 py-6" aria-live="polite">
      {(closing.step === "sending" || closing.step === "closing") && <>
        {/* r5 R5-7: "— sending" only while something is waiting; otherwise the office is checking. */}
        <h1 className="font-serif text-[1.6em] font-semibold text-ink">{unsent > 0 ? W.visitClosedSending : W.visitClosedChecking}</h1>
        {/* Never "⇅ 0 · sending" with nothing waiting: then the device is checking with the office. */}
        <p className="mt-2 text-ink-2" role="status">{unsent > 0 ? fill(W.closeWaitingN, { n: unsent }) : W.closeChecking}</p>
      </>}
      {closing.step === "waiting_signal" && <>
        {/* r7 extra: no signal is said once — the strip and this heading; no third banner. */}
        <h1 className="font-serif text-[1.6em] font-semibold text-ink">{online ? W.visitClosedSending : W.visitClosedOffline}</h1>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><Btn tone="primary" onClick={onRetry} disabled={!online}>{online ? W.sendNow : W.sendNowNeedsSignal}</Btn><Btn onClick={onKeepWorking}>{W.keepWorking}</Btn></div>
      </>}
      {slow && <>
        {/* r4 R4-3 / r7 R7-2: a close the office hasn't answered is a calm wait with a way forward, not an error. */}
        <h1 className="font-serif text-[1.6em] font-semibold text-ink"><span aria-hidden className="font-mono">◐ </span>{W.stillClosing}</h1>
        <div className="mt-3"><Banner kind="status">{W.stillClosingBody}</Banner></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><Btn tone="primary" onClick={onRetry} disabled={!online}>{W.tryAgain}</Btn><Btn onClick={onKeepWorking}>{W.keepWorking}</Btn></div>
        {!online && <p className="mt-3 text-ink-2">{W.offlineStrip}</p>}
      </>}
      {closing.step === "error" && !slow && (() => {
        // r10 R10-1: the office refused — the visit is not closed and nothing is sending. Say what happened
        // and offer the one fix for this code; Try again only where trying again can work.
        // r14 R14-1: "Check Before you wrap" names a place the button doesn't go when the office named one
        // answer the app can place — then the line names that answer and the button says where it goes.
        const found = closeRefusal(closing.code);
        const place = found.fix === "before_you_wrap" ? refusedPlace ?? null : null;
        const refusal = place ? { ...found, line: fill(W.refusedOneAnswer, { field: place.label }) } : found;
        const refused = (fix: CloseFix | "retry") => (onRefused ? onRefused(fix) : fix === "retry" ? onRetry() : onKeepWorking());
        // r11 R11-1: the button goes where the line says (CLOSE_FIX_LABEL / CLOSE_FIX_CUE). Where only Joe
        // can act, Keep working is the one (primary) button. Sign in is the signed-out banner's own link.
        const only = refusal.fix === "keep_working";
        return <>
          <h1 className="font-serif text-[1.6em] font-semibold text-ink">{W.visitNotClosed}</h1>
          {/* r11 extra: a refusal one tap of Reload fixes is the calm status banner, not the ⚠ one. */}
          <div className="mt-3"><Banner kind={closeRefusalCalm(refusal.fix) ? "status" : "action"} role="status">{refusal.line}</Banner></div>
          {closing.ownerNotified && <p className="mt-2 text-ink-2" role="status">{W.ownerToldNotClosed}</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {refusal.fix === "sign_in" && signInHref
              ? <LinkBtn tone="primary" href={signInHref} onClick={(e) => { e.preventDefault(); refused("sign_in"); }}>{CLOSE_FIX_LABEL.sign_in}</LinkBtn>
              : <Btn tone="primary" onClick={() => refused(refusal.fix)} disabled={refusal.fix === "send_now" && !online}>{refusal.fix === "send_now" && !online ? W.sendNowNeedsSignal : place ? place.button : CLOSE_FIX_LABEL[refusal.fix]}</Btn>}
            {refusal.fix !== "back_to_visits" && !only && <Btn onClick={() => refused("keep_working")}>{W.keepWorking}</Btn>}
          </div>
        </>;
      })()}
      {closing.step === "done" && r && <>
        {r.complete ? <>
          {/* r11 extra: the same heading as the opened Complete screen (CompleteCard) — with the close time. */}
          {/* r12 extra: "Nov 3, 7:01 pm" stays on one line — never "7:01 / pm".
              r13 R13-1: "✓ Complete" alone; the close time is a plain line under it, so no "·" is stranded. */}
          <h1 className="font-serif text-[1.8em] font-semibold text-accent-2">✓ {W.complete}</h1>
          {closedWhen && <p className="mt-1 text-ink-2">{W.closedOn} <span className="whitespace-nowrap">{closedWhen}</span></p>}
          {unmeasured > 0 && <p className="mt-1 font-semibold text-ink">{quantitiesLine(unmeasured)}</p>}
          <DotLine className="mt-2 font-mono text-ink" line={completeCountsLine(r)} />
          <p className="mt-1 text-ink-2">Answers and photos sent ✓</p>
          {/* r12 R12-3: the opened Complete screen's lock line, from the same role check — a staff visitor
              is told Joe reopens it from the office look-over; Joe gets Reopen below. */}
          <p className="mt-3 text-ink">{staff ? W.completeLocked : W.answersLocked}</p>
          {!autoApply && (
            // r13 extra: a staff visitor's "Joe applies the findings" is a plain line, not a box shaped like a button.
            <div className={staff && !findings && !findingsCode ? "mt-3" : "mt-4 rounded-lg border-2 border-rule p-3"}>
              {findings?.status === "applied" || findings?.status === "done" ? <p className="font-semibold text-accent-2">Findings applied ✓</p>
                : findings?.status === "failed" || findingsCode ? <Banner kind="action" actions={<Btn onClick={onApply}>{W.tryAgain}</Btn>}>{"Couldn’t apply findings to the scope"}</Banner>
                : findings ? <p className="text-ink-2">{W.findingsWaiting}</p>
                // r11 extra: words beside the button; a staff visitor can't apply them, so Joe does it in the office.
                : staff ? <p className="text-ink">{W.joeAppliesFindings}</p>
                : <div className="grid gap-2"><p className="text-ink">{W.applyFindingsWhat}</p><Btn tone="primary" onClick={onApply} className="justify-self-start">{W.applyFindings}</Btn></div>}
            </div>
          )}
        </> : <>
          {/* r3 C2: Needs finishing is a normal outcome — ink heading, ○ Open per unmet check,
              ! Problem only for conflicts. The count is the one Before you wrap showed. */}
          <h1 className="font-serif text-[1.8em] font-semibold text-ink"><span aria-hidden className="font-mono">◐ </span>{W.needsFinishing}</h1>
          <p className="mt-2 text-ink">{fill(W.needsFinishingN, { n: openN })}</p>
          <ul className="mt-3 grid gap-2">
            {r.checks.filter((c) => c.open.length).map((c) => {
              const devices = c.code === "close_manifests" ? c.open.filter((x) => x !== "conflicts").length : 0;
              const conflicts = c.code === "close_manifests" && c.open.includes("conflicts");
              const text = c.code === "close_manifests"
                ? [devices ? fill(devices === 1 ? W.otherDeviceWaiting : W.otherDevicesWaiting, { n: devices }) : "", conflicts ? W.conflictsToPick : ""].filter(Boolean).join(" ")
                : c.open_phrase ?? openCheckPhrase(c.code, c.open); // r6 D6: what is left, as Before you wrap says it
              // r5: every open row carries its way forward. Other devices' answers: this device can only
              // send its own (Send now); a conflict is picked on the visit (Before you wrap lists it).
              const action = c.action ?? closeAction(c.code);
              const button = c.code === "close_manifests"
                ? (conflicts ? <Btn onClick={() => onAction?.("review_sync")}>{W.goToField}</Btn> : unsent > 0 ? <Btn onClick={onSend} disabled={!online}>{W.sendNow}</Btn> : null)
                : onAction && <Btn onClick={() => onAction(action)}>{CHECK_ACTION_WORDS[action] ?? W.review}</Btn>;
              return (
                <li key={c.code} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md border-2 border-rule-soft bg-card px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  {conflicts ? <CoverageMark variant="ready" state="problem" /> : <CoverageMark variant="coverage" state="open" />}
                  <span className="text-ink">{text}</span>
                  {button && <span className="col-span-2 sm:col-span-1 [&>button]:max-sm:w-full">{button}</span>}
                </li>
              );
            })}
          </ul>
        </>}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {!r.complete && <Btn tone="primary" onClick={onKeepWorking}>{W.keepWorking}</Btn>}
          {r.complete && !staff && !reopening && <Btn onClick={() => setReopening(true)}>{W.reopen}</Btn>}
          {/* r11 / r12 extra: both close results go back to the visit list, as the opened Complete screen does. */}
          <LinkBtn href="/consult/">{W.backToVisits}</LinkBtn>
        </div>
        {reopening && !staff && (
          <form className="mt-4 grid gap-3" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await onReopen(reason.trim()); } catch (x) { setErr(plainWords(x instanceof Error ? x.message : "")); } }}>
            <TextInput label={W.reopenReason} value={reason} onChange={setReason} multiline autoFocus />
            {err && <p role="alert" className="font-semibold text-flag">! {err}</p>}
            <div className="flex gap-3"><Btn onClick={() => setReopening(false)}>{W.cancel}</Btn><Btn tone="primary" type="submit" disabled={!reason.trim()}>{W.reopen}</Btn></div>
          </form>
        )}
      </>}
    </section>
  );
}
