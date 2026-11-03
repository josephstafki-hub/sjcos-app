"use client";
/**
 * "Skip this field…" (plan §3, §10.2): one per field, never section-wide. Lists exactly
 * the §10.2 reasons. A price-critical skip that must carry a written assumption shows
 * the assumption fields; without one the field stays ○ Open (it doesn't count).
 */
import { useState } from "react";
import type { RiskAssumption, SkipReason } from "@/lib/consult/completeness";
import { hasRiskAssumption } from "@/lib/consult/completeness";
import { skipHelp, skipNeedsAssumption, skipReasonsFor, W, plainWords } from "@/lib/consult/ui/words";
import { Btn, Choice, Ring, Sheet, TextInput } from "./primitives";

export interface SkipValue { reason: SkipReason; note?: string; assumption?: RiskAssumption; trade_walk_decided?: boolean }
const blank = (): RiskAssumption => ({ text: "", responsible_trade: "", verification_point: "", adjustment_route: "precon_change", quantity: null, unit: null, exclusion: null });

export function SkipSheet({ open, label, tier, onSave, onClose, initial, isShot, saveError, field }: { field?: {type?:string;key?:string}; saveError?: string | null; open: boolean; label: string; tier: "price_critical" | "record"; initial?: SkipValue; isShot?: boolean; onSave: (v: SkipValue) => Promise<void> | void; onClose: () => void }) {
  // Mounted fresh for each field (conditional render), so props seed the state once.
  const [reason, setReason] = useState<SkipReason | null>(initial?.reason ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [a, setA] = useState<RiskAssumption>(initial?.assumption ?? blank());
  const [qty, setQty] = useState(initial?.assumption?.quantity != null ? String(initial.assumption.quantity) : "");
  const [walk, setWalk] = useState(!!initial?.trade_walk_decided);
  const [saving, setSaving] = useState(false);
  const wantsAssumption = !!reason && skipNeedsAssumption({ type: field?.type, key: field?.key, tier }, reason);
  const assumption: RiskAssumption = { ...a, quantity: qty.trim() && Number.isFinite(Number(qty)) ? Number(qty) : null, unit: a.unit?.trim() ? a.unit : null, exclusion: a.exclusion?.trim() ? a.exclusion : null };
  const written = hasRiskAssumption(assumption);
  const noteMissing = reason === "Other" && !note.trim();
  const save = async () => {
    if (!reason || noteMissing) return;
    setSaving(true);
    try { await onSave({ reason, ...(note.trim() ? { note: note.trim() } : {}), ...(wantsAssumption && written ? { assumption } : {}), ...(reason === "Sub/supplier will measure" ? { trade_walk_decided: walk } : {}) }); }
    finally { setSaving(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={<>{W.skipTitle} · <span className="font-sans font-normal">{label}</span></>}
      footer={<><Btn onClick={onClose}>{W.cancel}</Btn><Btn tone="primary" disabled={!reason || noteMissing || saving} onClick={() => void save()}>{W.saveSkip}</Btn></>}>
      <fieldset>
        <legend className="mb-2 text-[1em] font-semibold text-ink">{W.skipWhy}</legend>
        {saveError && <p role="alert" className="font-semibold text-flag">{plainWords(saveError)}</p>}
        <div className="grid gap-3">
          {skipReasonsFor(field).filter((r) => !(isShot && r === "Not on this job")).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
              className={`min-h-14 rounded-md border-2 px-3 py-2 text-left focus-visible:outline-3 focus-visible:outline-focus ${reason === r ? "border-accent bg-accent-soft" : "border-rule bg-card hover:bg-paper-2"}`}>
              <span className="block font-semibold text-ink"><Ring on={reason === r} />{r}</span>
              <span className="block text-[0.9em] text-ink-2">{skipHelp(field, r)}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {reason && (
        <div className="mt-4 grid gap-3">
          <TextInput label={reason === "Other" ? `${W.skipNote} (needed)` : W.skipNote} value={note} onChange={setNote} multiline />
          {noteMissing && <p className="text-[0.95em] font-semibold text-flag">! {W.skipNoteRequired}</p>}
          {reason === "Sub/supplier will measure" && (
            <Choice label={W.tradeWalkDecided} options={[true, false] as const} value={walk} onPick={setWalk} labels={(v) => (v ? W.yes : W.no)} columns={2} />
          )}
          {wantsAssumption && (
            <fieldset className="rounded-lg border-2 border-rule p-3">
              <legend className="px-1 font-serif text-[1.05em] font-semibold text-ink">{W.assumptionTitle}</legend>
              <div className="grid gap-3">
                <TextInput label={W.assumptionText} value={a.text} onChange={(v) => setA({ ...a, text: v })} multiline />
                <TextInput label={W.assumptionTrade} value={a.responsible_trade} onChange={(v) => setA({ ...a, responsible_trade: v })} />
                <TextInput label={W.assumptionCheck} value={a.verification_point} onChange={(v) => setA({ ...a, verification_point: v })} />
                <Choice label={W.assumptionRoute} options={["precon_change", "change_order"] as const} value={a.adjustment_route} onPick={(v) => setA({ ...a, adjustment_route: v })} labels={(v) => (v === "precon_change" ? W.routePrecon : W.routeCo)} columns={2} />
                <div className="grid grid-cols-2 gap-3">
                  <TextInput label={W.assumptionQty} value={qty} onChange={setQty} inputMode="decimal" />
                  <TextInput label={W.assumptionUnit} value={a.unit ?? ""} onChange={(v) => setA({ ...a, unit: v })} />
                </div>
                <TextInput label={W.assumptionExclusion} value={a.exclusion ?? ""} onChange={(v) => setA({ ...a, exclusion: v })} />
                <p className={`text-[0.95em] ${written ? "text-ink-2" : "font-semibold text-flag"}`}>{written ? "✓ Assumption written — this skip counts." : "! Without a written assumption this stays ○ Open."}</p>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </Sheet>
  );
}
