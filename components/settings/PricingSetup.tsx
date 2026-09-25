"use client";

import { useState, useTransition } from "react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import type { PricingSetupRow, PricingSetupConfig } from "@/lib/estimating/setup";
import { proposePricingSetupAction, updatePricingDraftAction, activatePricingSetupAction } from "@/lib/estimating/actions";

const btn = "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";

function DraftEditor({ row }: { row: PricingSetupRow }) {
  const [pending, start] = useTransition();
  const [cfg, setCfg] = useState<PricingSetupConfig>(row.config);
  const setRate = (k: string, v: string) => setCfg({ ...cfg, labor_rates: { ...cfg.labor_rates, [k]: { cents_per_hour: v === "" ? null : Math.round(Number(v) * 100), reason: v === "" ? cfg.labor_rates[k]?.reason ?? "not set" : "owner entered" } } });
  const setAllowance = (k: string, v: string) => setCfg({ ...cfg, default_allowances: { ...cfg.default_allowances, [k]: { cents: v === "" ? null : Math.round(Number(v) * 100), reason: v === "" ? cfg.default_allowances[k]?.reason ?? "not set" : "owner entered" } } });
  const save = () => start(async () => { await runAction(() => updatePricingDraftAction(row.version, cfg)); });
  const activate = () => start(async () => { await runAction(() => activatePricingSetupAction(row.version)); });
  return (
    <div className="mt-2 grid gap-3 text-[13px] md:grid-cols-2">
      <div>
        <Eyebrow>Labor rates ($/h)</Eyebrow>
        {Object.entries(cfg.labor_rates).map(([k, v]) => (
          <div key={k} className="mt-1 flex items-center gap-2">
            <span className="w-28 text-ink-3">{k}</span>
            <input className={`${input} w-24`} type="number" step="0.01" value={v.cents_per_hour == null ? "" : (v.cents_per_hour / 100).toString()} onChange={(e) => setRate(k, e.target.value)} />
            <span className="text-[11px] text-ink-3">{v.cents_per_hour == null ? v.reason : ""}</span>
          </div>
        ))}
        <div className="mt-3 flex items-center gap-2">
          <span className="w-28 text-ink-3">markup %</span>
          <input className={`${input} w-24`} type="number" step="0.1" value={cfg.markup_pct ?? ""} onChange={(e) => setCfg({ ...cfg, markup_pct: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="w-28 text-ink-3">margin target %</span>
          <input className={`${input} w-24`} type="number" step="0.1" value={cfg.margin_target_pct ?? ""} onChange={(e) => setCfg({ ...cfg, margin_target_pct: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <Eyebrow>Default allowances ($)</Eyebrow>
        {Object.entries(cfg.default_allowances).length === 0 && <div className="mt-1 text-[12px] text-ink-3">none proposed</div>}
        {Object.entries(cfg.default_allowances).map(([k, v]) => (
          <div key={k} className="mt-1 flex items-center gap-2">
            <span className="w-28 text-ink-3">{k}</span>
            <input className={`${input} w-24`} type="number" step="1" value={v.cents == null ? "" : (v.cents / 100).toString()} onChange={(e) => setAllowance(k, e.target.value)} />
            <span className="text-[11px] text-ink-3">{v.cents == null ? v.reason : ""}</span>
          </div>
        ))}
        <Eyebrow>Uncertainty rules</Eyebrow>
        <div className="mt-1 text-[12px] text-ink-3">
          rough range −{cfg.uncertainty_rules.rough_range_low_pct}% / +{cfg.uncertainty_rules.rough_range_high_pct}% · prices stale after {cfg.uncertainty_rules.stale_after_days} days · fixed proposal requires: {cfg.uncertainty_rules.fixed_requires.join(", ")}
        </div>
      </div>
      <div className="flex gap-2 md:col-span-2">
        <button className={btn} disabled={pending} onClick={save}>Save draft</button>
        <button className={btn} disabled={pending} onClick={activate}>Activate v{row.version} (markup decision)</button>
      </div>
    </div>
  );
}

export function PricingSetup({ setups }: { setups: PricingSetupRow[] }) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <Card kind="soft" className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
        <input className={`${input} w-72`} placeholder="notes for the proposal (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className={btn} disabled={pending} onClick={() => start(async () => { await runAction(() => proposePricingSetupAction(notes)); })}>Propose a new draft from evidence</button>
      </Card>
      {setups.length === 0 && <Card kind="soft" className="px-4 py-3 text-[13px] text-ink-3">No pricing setup versions yet.</Card>}
      {setups.map((s) => (
        <Card key={s.id} kind={s.state === "active" ? "money" : "default"} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">v{s.version}</span>
            <Chip kind={s.state === "active" ? "money" : "ghost"}>{s.state}</Chip>
            <span className="text-ink-3">proposed by {s.proposed_by} · {s.created_at.slice(0, 10)}{s.activated_at ? ` · active since ${s.activated_at.slice(0, 10)}` : ""}</span>
            {s.notes ? <span className="text-ink-3">· {s.notes}</span> : null}
          </div>
          {s.state === "draft" ? (
            <DraftEditor row={s} />
          ) : (
            <div className="mt-2 text-[12px] text-ink-3">
              markup {s.config.markup_pct ?? "unset"}% · margin target {s.config.margin_target_pct ?? "unset"}% · rates: {Object.entries(s.config.labor_rates).map(([k, v]) => `${k} ${v.cents_per_hour == null ? "unset" : `$${(v.cents_per_hour / 100).toFixed(2)}/h`}`).join(", ") || "none"}
            </div>
          )}
          {Array.isArray((s.evidence as { sources?: unknown[] }).sources) && (
            <details className="mt-2 text-[12px] text-ink-3"><summary>evidence</summary><pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(s.evidence, null, 1)}</pre></details>
          )}
        </Card>
      ))}
    </div>
  );
}
