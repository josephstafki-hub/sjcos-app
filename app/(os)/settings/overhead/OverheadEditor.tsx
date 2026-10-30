"use client";

import { useState, useTransition } from "react";
import { Button, Card, Chip, Eyebrow, EmptyState } from "@/components/ui";
import type { Subscription, MeteredCharge, OverheadSummary, ReconcileLine, Cadence, SubscriptionSource, ChargeSource } from "@/lib/overhead/overhead";
import {
  addMeteredChargeAction,
  addSubscriptionAction,
  deleteMeteredChargeAction,
  deleteSubscriptionAction,
  endSubscriptionAction,
  setAlertThresholdAction,
  updateSubscriptionAction,
} from "@/lib/overhead/actions";
import { runAction } from "@/lib/run-action";

const inputCls = "w-full rounded-md border border-rule bg-paper px-2 py-1 text-meta text-ink outline-none focus:border-accent";
const btnCls =
  "rounded-md border border-ink-4 px-2.5 py-1 text-meta font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const primaryCls =
  "rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-meta font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50";

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const month = () => new Date().toISOString().slice(0, 7);

export function OverheadEditor({ subs, charges, summary, reconcile, thresholdCents }: { subs: Subscription[]; charges: MeteredCharge[]; summary: OverheadSummary; reconcile: { lines: ReconcileLine[]; caveat: string }; thresholdCents: number | null }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [sub, setSub] = useState({ name: "", vendor: "", amountDollars: "", cadence: "monthly" as Cadence, source: "owner_reported" as SubscriptionSource, startedOn: "", externalRef: "", notes: "" });
  const [chg, setChg] = useState({ provider: "", period: month(), amountDollars: "", source: "bill" as ChargeSource, externalRef: "", notes: "" });
  const [threshold, setThreshold] = useState(thresholdCents === null ? "" : (thresholdCents / 100).toFixed(2));
  const [refEdit, setRefEdit] = useState<Record<string, string>>({});
  const recBy = new Map(reconcile.lines.map((l) => [l.subscription.id, l]));

  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await runAction(fn, {onError: message => setFeedback(message)});
      if (r && r.ok !== false) {setFeedback("Saved");after?.();}
    });

  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sticky top-0 z-10 bg-paper py-2 text-body text-ink-2">{pending ? "Saving…" : feedback}</p>
      <Card kind="soft" className="px-4 py-3 text-meta text-ink-3">
        <div className="flex flex-wrap gap-4 text-body text-ink">
          <div>Fixed <strong>{dollars(summary.fixed.monthly_cents)}</strong>/mo</div>
          <div>Metered ({summary.month}) <strong>{dollars(summary.metered.cents)}</strong></div>
          <div>Known total <strong>{dollars(summary.total_known_cents)}</strong></div>
          {summary.alert.exceeded ? <Chip kind="flag">Over threshold</Chip> : null}
        </div>
        <ul className="mt-2">
          {summary.caveats.map((c) => (
            <li key={c}>· {c}</li>
          ))}
        </ul>
      </Card>

      <section>
        <Eyebrow muted>Fixed subscriptions</Eyebrow>
        <div className="mt-2 divide-y divide-rule-soft">
          {!subs.length && <EmptyState compact title="No subscriptions recorded" description="Add the services you pay for below to track their recurring cost." />}
          {subs.map(s => {
            const rec = recBy.get(s.id);
            return <div key={s.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-subheading font-semibold text-ink">{s.name}</h3>
                  <p className="mt-1 text-meta text-ink-3">{s.vendor} · {s.source === 'owner_reported' ? 'Owner reported' : s.source === 'qbo' ? 'QuickBooks' : 'From a bill'}{s.ended_on ? ' · Ended' : ''}</p>
                </div>
                <span className="shrink-0 text-body tabular-nums text-ink">{dollars(s.amount_cents)}/{s.cadence === 'yearly' ? 'yr' : 'mo'}</span>
                <details className="relative shrink-0">
                  <summary aria-label={`Actions for ${s.name}`} className="cursor-pointer rounded-md px-3 py-1 text-body hover:bg-hover">…</summary>
                  <div className="absolute right-0 z-10 flex min-w-40 flex-col rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                    {s.ended_on ? <Button variant="ghost" size="sm" disabled={pending} onClick={()=>go(()=>updateSubscriptionAction(s.id,{endedOn:null}))}>Restore subscription</Button> : <Button variant="ghost" size="sm" disabled={pending} onClick={()=>go(()=>endSubscriptionAction(s.id))}>End subscription</Button>}
                    <Button variant="ghost" size="sm" className="text-flag" disabled={pending} onClick={()=>{if(confirm(`Delete ${s.name}? Its cost record will be removed.`))go(()=>deleteSubscriptionAction(s.id));}}>Delete subscription</Button>
                  </div>
                </details>
              </div>
              <details className="mt-2 text-body">
                <summary className="cursor-pointer text-accent-2">Details & reconciliation</summary>
                <div className="mt-3 space-y-3">
                  <p className="text-meta text-ink-3">Started {s.started_on}{s.ended_on ? ` · Ended ${s.ended_on}` : ''}</p>
                  {s.notes && <p className="break-words text-body text-ink-2">{s.notes}</p>}
                  <label className="block text-label text-ink-2">Bill or QuickBooks reference
                    <div className="mt-1.5 flex gap-2">
                      <input className={inputCls} value={refEdit[s.id] ?? s.external_ref ?? ''} onChange={e=>setRefEdit({...refEdit,[s.id]:e.target.value})} />
                      <Button variant="secondary" size="sm" disabled={pending || refEdit[s.id] === undefined} onClick={()=>go(()=>updateSubscriptionAction(s.id,{externalRef:refEdit[s.id],source:refEdit[s.id].trim() ? (refEdit[s.id].startsWith('qbo')?'qbo':'bill'):'owner_reported'}),()=>setRefEdit(r=>{const next={...r};delete next[s.id];return next;}))}>Save</Button>
                    </div>
                  </label>
                  {rec && <p className="break-words text-meta text-ink-3">{rec.note}</p>}
                </div>
              </details>
            </div>;
          })}
        </div>
        <Card className="mt-3 px-4 py-3">
          <Eyebrow muted>Add a subscription</Eyebrow>
          <div className="mt-2 grid gap-2 @3xl/page:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Name<input className={inputCls} aria-label="Name" placeholder="Name" value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Vendor<input className={inputCls} aria-label="Vendor" placeholder="Vendor" value={sub.vendor} onChange={(e) => setSub({ ...sub, vendor: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Amount ($)<input className={inputCls} aria-label="Amount ($)" placeholder="Amount ($)" inputMode="decimal" value={sub.amountDollars} onChange={(e) => setSub({ ...sub, amountDollars: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Billing frequency<select aria-label="Billing frequency" className={inputCls} value={sub.cadence} onChange={(e) => setSub({ ...sub, cadence: e.target.value as Cadence })}>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Subscription source<select aria-label="Subscription source" className={inputCls} value={sub.source} onChange={(e) => setSub({ ...sub, source: e.target.value as SubscriptionSource })}>
              <option value="owner_reported">owner-reported</option>
              <option value="bill">from a bill</option>
              <option value="qbo">from QuickBooks</option>
            </select></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Subscription start date<input className={inputCls} type="date" aria-label="Subscription start date" value={sub.startedOn} onChange={(e) => setSub({ ...sub, startedOn: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Bill reference (optional)<input className={inputCls} aria-label="Bill reference (optional)" placeholder="Bill reference (optional)" value={sub.externalRef} onChange={(e) => setSub({ ...sub, externalRef: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Notes<input className={inputCls} aria-label="Notes" placeholder="Notes" value={sub.notes} onChange={(e) => setSub({ ...sub, notes: e.target.value })} /></label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primaryCls}
              disabled={pending || !sub.name || !sub.vendor || !sub.amountDollars}
              onClick={() => go(() => addSubscriptionAction(sub), () => setSub({ ...sub, name: "", amountDollars: "", externalRef: "", notes: "" }))}
            >
              Add subscription
            </button>
            <span className="text-meta text-ink-3">An existing bill reference, or a matching name, vendor and start date, prevents duplicates.</span>
          </div>
        </Card>
      </section>

      <section>
        <Eyebrow muted>Metered charges (actual API usage, by month)</Eyebrow>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-body">
            <thead>
              <tr className="border-b border-rule text-left text-meta text-ink-3">
                <th className="py-2 pr-3">Period</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Bill reference</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {charges.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-2 text-ink-3">No metered charges recorded — usage is unknown, not zero.</td>
                </tr>
              ) : null}
              {charges.map((c) => (
                <tr key={c.id} className="border-b border-rule-soft">
                  <td className="py-2 pr-3 text-meta">{c.period}</td>
                  <td className="py-2 pr-3">{c.provider}</td>
                  <td className="py-2 pr-3">{dollars(c.amount_cents)}</td>
                  <td className="py-2 pr-3">{c.source === "estimate" ? <Chip kind="flag">estimate</Chip> : c.source}</td>
                  <td className="py-2 pr-3 text-meta">{c.external_ref ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <details className="relative"><summary aria-label={`Actions for ${c.provider} charge`} className="cursor-pointer px-3 py-1">…</summary><div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop"><Button variant="ghost" size="sm" className="text-flag" disabled={pending} onClick={()=>{if(confirm(`Delete this ${c.provider} charge?`))go(()=>deleteMeteredChargeAction(c.id));}}>Delete charge</Button></div></details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Card className="mt-3 px-4 py-3">
          <Eyebrow muted>Record a metered charge</Eyebrow>
          <div className="mt-2 grid gap-2 @3xl/page:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Provider (Anthropic, OpenAI…)<input className={inputCls} aria-label="Provider (Anthropic, OpenAI…)" placeholder="Provider (Anthropic, OpenAI…)" value={chg.provider} onChange={(e) => setChg({ ...chg, provider: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Period YYYY-MM<input className={inputCls} aria-label="Period YYYY-MM" placeholder="Period YYYY-MM" value={chg.period} onChange={(e) => setChg({ ...chg, period: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Amount ($)<input className={inputCls} aria-label="Amount ($)" placeholder="Amount ($)" inputMode="decimal" value={chg.amountDollars} onChange={(e) => setChg({ ...chg, amountDollars: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Charge source<select aria-label="Charge source" className={inputCls} value={chg.source} onChange={(e) => setChg({ ...chg, source: e.target.value as ChargeSource })}>
              <option value="bill">from a bill</option>
              <option value="provider_usage">provider usage page</option>
              <option value="qbo">from QuickBooks</option>
              <option value="owner_reported">owner-reported</option>
              <option value="estimate">estimate (labelled)</option>
            </select></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Bill or invoice reference<input className={inputCls} aria-label="Bill or invoice reference" placeholder="Bill or invoice reference" value={chg.externalRef} onChange={(e) => setChg({ ...chg, externalRef: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Notes<input className={inputCls} aria-label="Notes" placeholder="Notes" value={chg.notes} onChange={(e) => setChg({ ...chg, notes: e.target.value })} /></label>
          </div>
          <div className="mt-2">
            <button type="button" className={primaryCls} disabled={pending || !chg.provider || !chg.amountDollars} onClick={() => go(() => addMeteredChargeAction(chg), () => setChg({ ...chg, amountDollars: "", externalRef: "", notes: "" }))}>
              Record charge
            </button>
          </div>
        </Card>
      </section>

      <section>
        <Eyebrow muted>Monthly threshold (notification only)</Eyebrow>
        <Card className="mt-2 px-4 py-3">
          <div className="flex max-w-[420px] items-center gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-label text-ink-2">Monthly threshold ($)<input className={inputCls} aria-label="Blank = no threshold" placeholder="Blank = no threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
            <button type="button" className={btnCls} disabled={pending} onClick={() => go(() => setAlertThresholdAction(threshold))}>
              Save
            </button>
          </div>
          <div className="mt-1 text-meta text-ink-3">When known overhead for the month passes this, you get one money notification. Nothing is paused or blocked.</div>
        </Card>
      </section>

      <section>
        <Eyebrow muted>Reconciliation proposal</Eyebrow>
        <Card className="mt-2 px-4 py-3 text-meta text-ink-3">
          <div>{reconcile.caveat}</div>
          <ul className="mt-2 flex flex-col gap-1">
            {reconcile.lines.map((l) => (
              <li key={l.subscription.id}>
                <strong className="text-ink">{l.subscription.name}</strong> — {l.note}
                {l.candidates.length ? (
                  <ul className="ml-4 text-ink-3">
                    {l.candidates.slice(0, 4).map((c) => (
                      <li key={c.id}>
                        candidate: {c.expense_date} {c.vendor_label} {dollars(c.amount_cents)} {c.source_ref ? `(${c.source_ref})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
