"use client";

// Shared pieces of the project Money › Overview (components/projects/BudgetPanel).
// Spec: docs/project-financials-plan.md §4.

import type { ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { Card } from "@/components/ui";
import { fmtK } from "@/lib/budget-types";

export const FIELD = "w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
export const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";
export const BTN = "inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50";
export const BTN_PRIMARY = "inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50";

/** The cost ramp: ONE hue, stepped by certainty — spent → owed → on order →
 *  still to spend. Validated as a four-step ordinal ramp on the card surface
 *  (plan §4.2). Identity comes from the row label and the legend, never hue. */
export const RAMP = { paid: "bg-accent-2", owed: "bg-accent", ordered: "bg-ink-3", est: "bg-ink-4" } as const;

export interface Seg {
  label: string;
  cents: number;
  className: string;
}

/** A stacked horizontal bar against `max`, with optional hairline ticks. The
 *  unfilled rest of the track is part of the picture: on the cost row it is
 *  the profit. 2px surface gaps separate segments; nothing is outlined. */
export function StackBar({ segs, max, ticks = [] }: { segs: Seg[]; max: number; ticks?: { label: string; cents: number; hideLabel?: boolean }[] }) {
  const pct = (c: number) => (max > 0 ? Math.max(0, Math.min(100, (c / max) * 100)) : 0);
  // Room above the bar only when a tick actually carries a label.
  const labelled = ticks.some((t) => !t.hideLabel);
  return (
    <div className={`relative ${labelled ? "pt-4" : "pt-1"}`}>
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-[4px] bg-card">
        {segs.filter((s) => s.cents > 0).map((s) => (
          <div key={s.label} className={`${s.className} min-w-[2px]`} style={{ width: `${pct(s.cents)}%` }} title={`${s.label} ${fmtK(s.cents)}`} />
        ))}
        <div className="min-w-0 flex-1 bg-paper-3" />
      </div>
      {ticks.map((t) => {
        const x = pct(t.cents);
        const align = x > 88 ? "right-0 translate-x-0" : x < 12 ? "left-0 translate-x-0" : "left-1/2 -translate-x-1/2";
        return (
          <div key={t.label} className={`pointer-events-none absolute bottom-[-3px] w-px bg-ink ${labelled ? "top-[11px]" : "top-0"}`} style={{ left: `calc(${x}% - ${x > 99 ? 1 : 0}px)` }} title={`${t.label} ${fmtK(t.cents)}`}>
            {!t.hideLabel && <span className={`absolute top-[-13px] whitespace-nowrap font-mono text-[9.5px] text-ink-3 ${align}`}>{t.label}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ swatch, label, value, cents }: { swatch: string; label: string; value?: string; cents?: number }) {
  if (cents === 0) return null; // a $0 entry is noise; the vocabulary is taught by the rows that have money in them
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <i className={`inline-block size-2.5 flex-none rounded-[2px] ${swatch}`} />
      <span className="text-ink-2">{label}</span>
      {value && <b className="font-mono text-[12px] font-medium text-ink">{value}</b>}
    </span>
  );
}

export function Section({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[18px] font-semibold text-ink">{title}</h3>
          {sub && <p className="text-[12.5px] text-ink-3">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Fold({ title, right, open, onToggle, children }: { title: string; right?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper-2">
        <span className="min-w-0">
          <span className="block font-serif text-[16px] leading-tight text-ink">{title}</span>
          {right && <span className="mt-0.5 block font-mono text-[11px] leading-snug text-ink-3">{right}</span>}
        </span>
        <ChevronDown className={`size-3.5 flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>
      {open && <div className="border-t border-rule-soft px-4 py-3">{children}</div>}
    </Card>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`whitespace-nowrap px-2 pb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-3 ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Td({ children, right, mono, muted, className = "" }: { children?: ReactNode; right?: boolean; mono?: boolean; muted?: boolean; className?: string }) {
  return (
    <td className={`px-2 py-2 align-top ${right ? "text-right" : ""} ${mono ? "whitespace-nowrap font-mono text-[12px] tabular-nums" : ""} ${muted ? "text-ink-3" : ""} ${className}`}>
      {children}
    </td>
  );
}

export const dash = <span className="text-ink-4">–</span>;

export function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[8vh]" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`w-full ${wide ? "max-w-[620px]" : "max-w-[480px]"} rounded-lg border border-rule bg-card shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The hint sits OUTSIDE the <label>: inside it, a screen reader reads the
 *  whole hint out as the field's name. */
export function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>{label}</span>
        {children}
      </label>
      {hint && <p className="text-[11px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

export function ModalFooter({ onClose, onSave, pending, saveLabel = "Save", danger }: { onClose: () => void; onSave: () => void; pending: boolean; saveLabel?: string; danger?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-rule-soft px-4 py-3">
      {danger}
      <span className="flex-1" />
      <button type="button" onClick={onClose} className={BTN}>Cancel</button>
      <button type="button" disabled={pending} onClick={onSave} className={BTN_PRIMARY}>{saveLabel}</button>
    </div>
  );
}
