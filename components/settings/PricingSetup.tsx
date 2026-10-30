"use client";

import { historicalAuthor, percentLabel } from "@/lib/pricing-labels";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import type { PricingSetupRow, PricingSetupConfig } from "@/lib/estimating/setup";
import { proposePricingSetupAction, updatePricingDraftAction, activatePricingSetupAction } from "@/lib/estimating/actions";

const btn = "rounded-md border border-ink-4 px-2.5 py-1 text-meta font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-md border border-rule bg-paper px-2 py-1 text-meta text-ink outline-none focus:border-accent";

function DraftEditor({ row }: { row: PricingSetupRow }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [baseline, setBaseline] = useState(row.config);
  const [cfg, setCfg] = useState<PricingSetupConfig>(row.config);
  const setRate = (k: string, v: string) => setCfg({ ...cfg, labor_rates: { ...cfg.labor_rates, [k]: { cents_per_hour: v === "" ? null : Math.round(Number(v) * 100), reason: v === "" ? cfg.labor_rates[k]?.reason ?? "not set" : "owner entered" } } });
  const setAllowance = (k: string, v: string) => setCfg({ ...cfg, default_allowances: { ...cfg.default_allowances, [k]: { cents: v === "" ? null : Math.round(Number(v) * 100), reason: v === "" ? cfg.default_allowances[k]?.reason ?? "not set" : "owner entered" } } });
  const dirty = JSON.stringify(cfg) !== JSON.stringify(baseline);
  const save = () => start(async () => { await runAction(() => updatePricingDraftAction(row.version, cfg), {onSuccess:()=>{setBaseline(cfg);setFeedback("Saved");},onError:setFeedback}); });
  const activate = () => start(async () => { await runAction(() => activatePricingSetupAction(row.version), {onSuccess:()=>setFeedback("Activation request saved. Review Decisions if this version is still a draft."),onError:setFeedback}); });
  const missingRates = Object.values(cfg.labor_rates).filter(v => v.cents_per_hour == null).length;
  const missingAllowances = Object.values(cfg.default_allowances).filter(v => v.cents == null).length;
  return (
    <div>
      <aside className="mb-3 rounded-md border border-rule-soft bg-paper-2 p-3 text-body">
        <p>{missingRates} labor rates and {missingAllowances} allowances lack evidence{cfg.markup_pct == null || cfg.margin_target_pct == null ? "; markup or margin also needs your decision" : ""}.</p>
        <div className="mt-2 flex flex-wrap gap-4 text-accent-2"><Link href="/cost-book" className="underline">Review cost book</Link><Link href="/projects?stage=closeout" className="underline">Review job closeouts</Link></div>
      </aside>
      <div className="mt-2 flex flex-wrap items-center gap-3"><span className="font-medium">v{row.version}</span><Chip kind="ghost">Draft</Chip><button className={btn} disabled={pending || dirty} onClick={activate}>Activate v{row.version}</button><span role="status" className="text-meta text-ink-2">{pending ? "Saving…" : feedback || (dirty ? "Unsaved changes" : "")}</span></div>
      <p className="mt-2 text-meta text-ink-3">{historicalAuthor(row.proposed_by)} · {row.created_at.slice(0,10)}{row.notes ? ` · ${row.notes}` : ""}</p>
      <div className="mt-3 grid gap-3 text-body @3xl/page:grid-cols-2">
      <div>
        <Eyebrow muted>Labor rates ($/h)</Eyebrow>
        <p className="mt-2 text-meta text-ink-3">Unset rates need an hourly cost-book item or verified closeout hours for that category.</p>
        {Object.entries(cfg.labor_rates).map(([k, v]) => (
          <div key={k} className="mt-2 flex flex-wrap items-center gap-2">
            <span className="w-28 text-ink-3">{k}</span>
            <input disabled={pending} aria-label={`${k} hourly rate`} className={`${input} w-24`} placeholder="not set" type="number" step="0.01" value={v.cents_per_hour == null ? "" : (v.cents_per_hour / 100).toString()} onChange={(e) => setRate(k, e.target.value)} />

          </div>
        ))}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="w-28 text-ink-3">markup %</span>
          <input disabled={pending} className={`${input} w-24`} aria-label="Markup percent" placeholder="not set" type="number" step="0.1" value={cfg.markup_pct ?? ""} onChange={(e) => setCfg({ ...cfg, markup_pct: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="w-28 text-ink-3">margin target %</span>
          <input disabled={pending} className={`${input} w-24`} aria-label="Margin target percent" placeholder="not set" type="number" step="0.1" value={cfg.margin_target_pct ?? ""} onChange={(e) => setCfg({ ...cfg, margin_target_pct: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <Eyebrow muted>Default allowances ($)</Eyebrow>
        {Object.entries(cfg.default_allowances).length === 0 && <div className="mt-1 text-meta text-ink-3">none proposed</div>}
        {Object.entries(cfg.default_allowances).map(([k, v]) => (
          <div key={k} className="mt-2 flex flex-wrap items-center gap-2">
            <span className="w-28 text-ink-3">{k}</span>
            <input disabled={pending} aria-label={`${k} allowance`} className={`${input} w-24`} placeholder="not set" type="number" step="1" value={v.cents == null ? "" : (v.cents / 100).toString()} onChange={(e) => setAllowance(k, e.target.value)} />
            <span className="min-w-0 basis-full text-meta text-ink-3 @3xl/page:basis-auto @3xl/page:flex-1">{v.cents == null ? v.reason : ""}</span>
          </div>
        ))}
        <Eyebrow muted>Uncertainty rules</Eyebrow>
        <div className="mt-1 text-meta text-ink-3">
          rough range −{cfg.uncertainty_rules.rough_range_low_pct}% / +{cfg.uncertainty_rules.rough_range_high_pct}% · prices stale after {cfg.uncertainty_rules.stale_after_days} days · fixed proposal requires: {cfg.uncertainty_rules.fixed_requires.join(", ")}
        </div>
      </div>
      <div className={dirty ? "sticky bottom-3 z-10 flex flex-wrap gap-2 rounded-lg border border-rule-soft bg-card p-3 shadow-card @3xl/page:col-span-2" : "hidden"}>
        {dirty && <button className={btn} disabled={pending} onClick={save}>Save draft</button>}

      </div>
    </div></div>
  );
}

export function PricingSetup({ setups }: { setups: PricingSetupRow[] }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <Card kind="soft" className="flex flex-wrap items-center gap-2 px-4 py-3 text-body">
        <input className={`${input} w-full min-w-0 @3xl/page:w-72`} aria-label="Proposal notes" placeholder="notes for the proposal (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className={btn} disabled={pending} onClick={() => start(async () => { await runAction(() => proposePricingSetupAction(notes), {onSuccess:()=>setFeedback("Draft saved"),onError:setFeedback}); })}>Propose a new draft from evidence</button>
      </Card>
      <p role="status" className="text-meta text-ink-2">{pending ? "Saving…" : feedback}</p>
      {setups.length === 0 && <Card kind="soft" className="px-4 py-3 text-body text-ink-3">No pricing setup versions yet.</Card>}
      {setups.map((s) => (
        <Card key={s.id} kind="default" className="px-4 py-3">
          {s.state !== "draft" && <div className="flex flex-wrap items-center gap-2 text-body">
            <span className="font-medium">v{s.version}</span>
            <Chip kind={s.state === "active" ? "money" : "ghost"}>{s.state}</Chip>
            <span className="text-ink-3">{historicalAuthor(s.proposed_by)} · {s.created_at.slice(0, 10)}{s.activated_at ? ` · active since ${s.activated_at.slice(0, 10)}` : ""}</span>
            {s.notes ? <span className="text-ink-3">· {s.notes}</span> : null}
          </div>}
          {s.state === "draft" ? (
            <DraftEditor row={s} />
          ) : (
            <div className="mt-2 text-meta text-ink-3">
              Markup {percentLabel(s.config.markup_pct)} · margin target {percentLabel(s.config.margin_target_pct)} · rates: {Object.entries(s.config.labor_rates).map(([k, v]) => `${k} ${v.cents_per_hour == null ? "unset" : `$${(v.cents_per_hour / 100).toFixed(2)}/h`}`).join(", ") || "none"}
            </div>
          )}
          {Array.isArray((s.evidence as { sources?: unknown[] }).sources) && (
            <details className="mt-2 text-meta text-ink-3"><summary>evidence</summary><pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(s.evidence, null, 1)}</pre></details>
          )}
        </Card>
      ))}
    </div>
  );
}
