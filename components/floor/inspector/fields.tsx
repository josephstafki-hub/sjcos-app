"use client";

// Small form primitives shared by the inspector panels. Every field commits
// on blur / Enter (never on each keystroke) so one edit = one undo entry.
// Inch fields go through parseIn/fmtIn; an unparsable entry shows a red hint
// and applies nothing.

import { useState, type ReactNode } from "react";
import { fmtIn, parseIn } from "@/lib/plan-doc";

export const INPUT_CLS =
  "w-full min-w-0 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50";
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-40";
export const BTN_GHOST =
  "inline-flex items-center justify-center gap-1 rounded-md border border-rule bg-paper px-2.5 py-1 text-[12px] text-ink-2 hover:border-ink-4 hover:text-ink disabled:opacity-40";
export const BTN_DANGER =
  "inline-flex items-center justify-center gap-1 rounded-md border border-rule bg-paper px-2.5 py-1 text-[12px] text-flag hover:border-flag disabled:opacity-40";
export const LABEL_CLS = "font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3";

export function SectionHeader({ children, right, className = "" }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`mt-4 mb-1.5 flex items-center gap-2 first:mt-0 ${className}`}>
      <div className={`flex-1 ${LABEL_CLS}`}>{children}</div>
      {right}
    </div>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <div className={`mb-0.5 ${LABEL_CLS}`}>{label}</div>
      {children}
      {hint && <div className="mt-0.5 text-[11px] text-flag">{hint}</div>}
    </label>
  );
}

export function Grid({ cols = 2, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const cls = cols === 4 ? "grid-cols-4" : cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid ${cls} gap-2`}>{children}</div>;
}

// ─── Number (inches) ─────────────────────────────────────────────────────────

export function NumberField({
  label,
  value,
  onCommit,
  inchesOnly,
  min,
  max,
  disabled,
  placeholder,
  raw,
}: {
  label: string;
  value: number | null | undefined;
  onCommit: (n: number) => void;
  /** Show 36" instead of 3' 0" (cabinet nominal style). */
  inchesOnly?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Plain number, no inch formatting (counts, degrees). */
  raw?: boolean;
}) {
  const display = value == null ? "" : raw ? String(value) : fmtIn(value, { inchesOnly });
  // Derived-state reset: when the prop changes, the draft follows it (no effect).
  const [draft, setDraft] = useState<{ base: string; text: string }>({ base: display, text: display });
  const [err, setErr] = useState<string | null>(null);
  const text = draft.base === display ? draft.text : display;
  const setText = (t: string) => setDraft({ base: display, text: t });

  const commit = () => {
    if (text.trim() === display.trim()) {
      setErr(null);
      return;
    }
    const n = raw ? (text.trim() === "" ? null : Number(text)) : parseIn(text);
    if (n == null || !Number.isFinite(n)) {
      setErr(raw ? "Enter a number." : "Try 36, 3' 0\", or 36 1/2.");
      return;
    }
    if (min != null && n < min) {
      setErr(`At least ${raw ? min : fmtIn(min, { inchesOnly })}.`);
      return;
    }
    if (max != null && n > max) {
      setErr(`At most ${raw ? max : fmtIn(max, { inchesOnly })}.`);
      return;
    }
    setErr(null);
    onCommit(n);
  };

  return (
    <Row label={label} hint={err}>
      <input
        className={`${INPUT_CLS} font-mono ${err ? "border-flag" : ""}`}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setText(display);
            setErr(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </Row>
  );
}

// ─── Text ────────────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onCommit: (s: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState<{ base: string; text: string }>({ base: value, text: value });
  const text = draft.base === value ? draft.text : value;
  const setText = (t: string) => setDraft({ base: value, text: t });
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <Row label={label}>
      {multiline ? (
        <textarea
          className={`${INPUT_CLS} min-h-[72px] resize-y`}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        <input
          className={INPUT_CLS}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setText(value);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      )}
    </Row>
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────

export interface Option {
  key: string;
  label: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  groups,
  allowEmpty,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (key: string) => void;
  disabled?: boolean;
  /** Render <optgroup>s: group label → option keys. */
  groups?: { label: string; keys: readonly string[] }[];
  allowEmpty?: string;
}) {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const known = options.some((o) => o.key === value);
  return (
    <Row label={label}>
      <select className={INPUT_CLS} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty != null && <option value="">{allowEmpty}</option>}
        {!known && value && <option value={value}>{value}</option>}
        {groups
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.keys.map((k) => {
                  const o = byKey.get(k);
                  return o ? (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ) : null;
                })}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
      </select>
    </Row>
  );
}

// ─── Segmented ───────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T | null;
  options: readonly { key: T; label: ReactNode; title?: string }[];
  onChange: (key: T) => void;
  disabled?: boolean;
  label?: string;
}) {
  const strip = (
    <div className="flex w-full overflow-hidden rounded-md border border-rule">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-1.5 py-1 text-[11.5px] transition-colors disabled:opacity-50 ${
            o.key === value ? "bg-ink text-paper" : "bg-paper text-ink-2 hover:bg-paper-2"
          } ${o !== options[0] ? "border-l border-rule" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!label) return strip;
  return (
    <div>
      <div className={`mb-0.5 ${LABEL_CLS}`}>{label}</div>
      {strip}
    </div>
  );
}

export function Toggle({ label, on, onChange, disabled }: { label: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2 ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="accent-ink" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  );
}

// ─── Swatches ────────────────────────────────────────────────────────────────

export interface Swatch {
  key: string;
  label: string;
  color: string;
  /** Tile presets get a tiny grout-grid hint. */
  tile?: boolean;
}

export function SwatchGrid({
  swatches,
  value,
  onPick,
  disabled,
  size = "md",
}: {
  swatches: readonly Swatch[];
  value?: string | null;
  onPick: (s: Swatch) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-6" : "size-9";
  return (
    <div className="flex flex-wrap gap-1.5">
      {swatches.map((s) => {
        const active = value === s.key;
        return (
          <button
            key={s.key}
            type="button"
            title={s.label}
            disabled={disabled}
            onClick={() => onPick(s)}
            className={`group flex w-[64px] flex-col items-center gap-1 rounded-md p-1 text-center transition-colors hover:bg-paper-2 disabled:opacity-50 ${
              active ? "bg-paper-2 ring-1 ring-ink" : ""
            }`}
          >
            <span
              className={`${box} relative overflow-hidden rounded border ${active ? "border-ink" : "border-rule"}`}
              style={{ backgroundColor: s.color }}
            >
              {s.tile && (
                <span
                  className="absolute inset-0 opacity-60"
                  style={{
                    backgroundImage:
                      "linear-gradient(#0000 45%, rgba(0,0,0,.25) 45%, rgba(0,0,0,.25) 55%, #0000 55%), linear-gradient(90deg, #0000 45%, rgba(0,0,0,.25) 45%, rgba(0,0,0,.25) 55%, #0000 55%)",
                    backgroundSize: "50% 50%",
                  }}
                />
              )}
            </span>
            <span className="line-clamp-2 w-full text-[9.5px] leading-tight text-ink-3 group-hover:text-ink">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Small bits ──────────────────────────────────────────────────────────────

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-ink-4 px-3 py-4 text-center text-[12px] text-ink-3">{children}</div>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
      <span className="text-ink-3">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}

export const PHASE_OPTIONS = [
  { key: "existing", label: "Existing" },
  { key: "remove", label: "Remove" },
  { key: "new", label: "New" },
  { key: "relocate", label: "Relocate" },
] as const;
