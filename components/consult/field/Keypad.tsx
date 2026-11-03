"use client";
/**
 * Keypad bottom sheet (plan §6.3, §6.6): 64 px keys, fractions, ft / in, × for W × H,
 * laser mode (ft-in · decimal ft · m), Same as last, and the reading shown before Save.
 * A bare number that fits the range both as inches and as feet asks 3″ / 3′ first.
 * Hardware keyboard: digits . ' " x space, Backspace, Enter = Save, Escape = Close.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatLength, parseLength, parseLengthPair, prettyLength } from "@/lib/consult/length";
import type { FieldDef } from "@/lib/consult/form-types";
import { W, fill } from "@/lib/consult/ui/words";
import { Btn, Sheet } from "./primitives";

type Mode = "ftin" | "decft" | "m";
const FRACTIONS = ["1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"];
/** One fraction per key, built from the UI font's own digits (r4 C1): the Unicode ¼ ½ ¾ came from
 *  Mulish and ⅛ ⅜ ⅝ ⅞ from a fallback font, so the keys differed in weight. Every key now draws
 *  the same raised numerator, slash and denominator in one font. */
function FracGlyph({ f }: { f: string }) {
  const [n, d] = f.split("/");
  return (
    <span aria-hidden className="inline-flex items-baseline font-sans font-bold leading-none">
      <span className="relative -top-[0.32em] text-[0.72em]">{n}</span>
      <span className="mx-[0.04em] text-[0.95em] font-semibold">/</span>
      <span className="text-[0.72em]">{d}</span>
    </span>
  );
}

export function precisionOf(def: FieldDef) { return def.precision && [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1].includes(def.precision) ? def.precision : 1 / 8; }
export function showLength(value: unknown, def: FieldDef): string {
  const p = precisionOf(def);
  try {
    if (Array.isArray(value)) return value.map((v) => (typeof v === "number" ? formatLength(v, p) : "—")).join(" × ");
    if (typeof value === "number") return formatLength(value, p);
  } catch { /* fall through */ }
  return String(value ?? "");
}

function interpret(text: string, mode: Mode, def: FieldDef, pair: boolean) {
  const opts = { range: def.range, precision: precisionOf(def) };
  const withUnit = (t: string) => {
    const s = t.trim(); if (!s) return s;
    if (mode === "decft" && /^[\d.]+$/.test(s)) return `${s}ft`;
    if (mode === "m" && /^[\d.]+$/.test(s)) return `${s}m`;
    return s;
  };
  if (pair) {
    const parts = text.split(/\s*[x×]\s*/i);
    if (parts.length !== 2 || !parts[1].trim()) return { ok: false as const, error: "need_second" as const };
    const r = parseLengthPair(`${withUnit(parts[0])} x ${withUnit(parts[1])}`, [{...opts,range:def.component_ranges?.[0]??def.range}, {...opts,range:def.component_ranges?.[1]??def.range}]);
    return r.ok ? { ok: true as const, value: r.inches as unknown, display: r.display } : { ok: false as const, error: "invalid_length_pair" as const };
  }
  const r = parseLength(withUnit(text), opts);
  return r.ok ? { ok: true as const, value: r.inches as unknown, display: r.display, interpreted: r.interpreted_as } : { ok: false as const, error: r.error };
}

/** Bare number that reads as both inches and feet inside the range → ask. */
function ambiguous(text: string, mode: Mode, def: FieldDef): number | null {
  if (mode !== "ftin" || !def.range) return null;
  const s = text.trim(); if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s); const [lo, hi] = def.range;
  return n >= lo && n <= hi && n * 12 >= lo && n * 12 <= hi ? n : null;
}

export function Keypad({ open, def, label, initial, last, onSave, onClose }: { open: boolean; def: FieldDef; label: string; initial?: unknown; last?: unknown; onSave: (value: unknown) => Promise<void> | void; onClose: () => void }) {
  const pair = def.type === "length_pair";
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("ftin");
  const [unitPick, setUnitPick] = useState<"in" | "ft" | null>(null);
  const [saving, setSaving] = useState(false);

  const amb = ambiguous(text, mode, def);
  const effective = amb !== null && unitPick ? `${text.trim()}${unitPick === "ft" ? "'" : '"'}` : text;
  const reading = useMemo(() => (effective.trim() ? interpret(effective, mode, def, pair) : null), [effective, mode, def, pair]);
  const warn = reading?.ok && typeof reading.value === "number" && def.warn && ((def.warn.below !== undefined && reading.value < def.warn.below) || (def.warn.above !== undefined && reading.value > def.warn.above)) ? def.warn.text : null;
  const canSave = !!reading?.ok && (amb === null || unitPick !== null) && !saving;

  const press = useCallback((k: string) => {
    setUnitPick(null);
    setText((t) => {
      if (k === "del") { const frac = /\s?\d+\/\d+$/.exec(t); return (frac ? t.slice(0, -frac[0].length) : t.trimEnd().slice(0, -1)).trimEnd(); }
      if (k === "ft") return /'/.test(t.split(/[x×]/).pop() ?? "") ? t : `${t.trim()}' `;
      if (k === "in") return `${t.trim()}"`;
      if (k === "x") return pair && !/[x×]/.test(t) ? `${t.trim()} × ` : t;
      if (k === "space") return t.endsWith(" ") ? t : `${t} `;
      if (FRACTIONS.includes(k)) return `${t.trimEnd()} ${k}`;
      return t + k;
    });
  }, [pair]);

  const save = useCallback(async () => {
    if (!canSave || !reading?.ok) return;
    setSaving(true);
    try { await onSave(reading.value); } finally { setSaving(false); }
  }, [canSave, reading, onSave]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "'") { e.preventDefault(); press("ft"); }
      else if (e.key === '"') { e.preventDefault(); press("in"); }
      else if (e.key === "x" || e.key === "*") { e.preventDefault(); press("x"); }
      else if (e.key === " ") { e.preventDefault(); press("space"); }
      else if (e.key === "/") { e.preventDefault(); setText((s) => s + "/"); }
      else if (e.key === "Backspace") { e.preventDefault(); press("del"); }
      else if (e.key === "Enter") { e.preventDefault(); void save(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, press, save]);

  // Tablet portrait keeps the docked sheet inside 58 dvh with 56 px keys (r3 C12: the fraction
  // row was clipped by the footer at 64 px).
  const key = (k: string, text: React.ReactNode = k, aria?: string, cls = "font-mono text-[1.35em]") => (
    <button key={k} type="button" onClick={() => press(k)} aria-label={aria ?? (typeof text === "string" ? text : k)}
      className={`min-h-16 min-w-11 rounded-md border-2 border-rule bg-card md:max-lg:min-h-14 [@media(max-height:700px)]:min-h-12 ${cls} font-semibold text-ink hover:bg-paper-2 focus-visible:outline-3 focus-visible:outline-focus active:bg-paper-3`}>{text}</button>
  );
  const status = !text.trim() ? (initial !== undefined ? `Now ${showLength(initial, def)}` : "Type the measurement")
    : amb !== null && !unitPick ? W.unitAmbiguous
    : reading?.ok ? fill(W.readsAs, { value: prettyLength(reading.display) })
    : reading?.error === "need_second" ? "Add the height after ×"
    : reading?.error === "out_of_range" ? W.outOfRange : W.invalidLength;

  return (
    <Sheet open={open} onClose={onClose} title={label} dock
      footer={<>
        {last !== undefined && <Btn onClick={() => { void (async () => { setSaving(true); try { await onSave(last); } finally { setSaving(false); } })(); }}>{W.sameAsLast} · {showLength(last, def)}</Btn>}
        <Btn tone="primary" onClick={() => void save()} disabled={!canSave} className="min-w-[8em]">{W.save}</Btn>
      </>}>
      <div aria-live="polite" className="mb-3 rounded-md border-2 border-rule bg-paper px-3 py-2 [@media(max-height:700px)]:mb-2 [@media(max-height:700px)]:py-1">
        <p className="min-h-[1.4em] break-words font-mono text-[1.6em] font-semibold text-ink [@media(max-height:700px)]:text-[1.4em]">{prettyLength(text) || " "}</p>
        <p className={`text-[0.95em] ${reading && !reading.ok && text.trim() && amb === null ? "font-semibold text-flag" : "text-ink-2"}`}>{reading && !reading.ok && text.trim() && amb === null ? "! " : ""}{status}</p>
        {warn && <p className="mt-1 text-[0.95em] font-semibold text-flag">! {warn}</p>}
      </div>
      {amb !== null && (
        <div className="mb-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label={W.unitAmbiguous}>
          <Btn tone={unitPick === "in" ? "primary" : "secondary"} role="radio" aria-checked={unitPick === "in"} onClick={() => setUnitPick("in")}>{amb}″ · inches</Btn>
          <Btn tone={unitPick === "ft" ? "primary" : "secondary"} role="radio" aria-checked={unitPick === "ft"} onClick={() => setUnitPick("ft")}>{amb}′ · feet</Btn>
        </div>
      )}
      <div className="mb-3 grid grid-cols-3 gap-2 [@media(max-height:700px)]:mb-2" role="radiogroup" aria-label="Laser mode">
        {([["ftin", W.laserFtIn], ["decft", W.laserDecFt], ["m", W.laserMetric]] as const).map(([m, l]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { setMode(m); setUnitPick(null); }}
            className={`min-h-14 rounded-md border-2 md:max-lg:min-h-12 [@media(max-height:700px)]:min-h-11 text-[0.95em] font-semibold ${mode === m ? "border-accent bg-accent-soft text-ink" : "border-rule bg-card text-ink-2"}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2 [@media(max-height:700px)]:gap-1.5">
        {key("7")}{key("8")}{key("9")}{mode === "ftin" ? key("ft", "ft", "feet") : <span />}
        {key("4")}{key("5")}{key("6")}{mode === "ftin" ? key("in", "in", "inches") : <span />}
        {key("1")}{key("2")}{key("3")}{key("del", "⌫", "Delete")}
        {key(".")}{key("0")}{pair ? key("x", "×", "times — next value") : <span />}{key("space", "␣", "Space")}
      </div>
      {mode === "ftin" && (
        // Seven across only where each key stays ≥ 44 px; narrower phones get 4 + 3 rows.
        <div className="mt-2 grid grid-cols-4 gap-2 min-[400px]:grid-cols-7 [@media(max-height:700px)]:mt-1.5 [@media(max-height:700px)]:gap-1.5">
          {(precisionOf(def) === 1/16 ? [...FRACTIONS,...Array.from({length:8},(_,i)=>`${i*2+1}/16`)] : FRACTIONS).map((f) => key(f, <FracGlyph f={f} />, `${f} inch`, "text-[1.45em]"))}
        </div>
      )}
    </Sheet>
  );
}
