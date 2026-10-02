"use client";

import { useState, useTransition } from "react";
import { Card, Chip, Eyebrow } from "@/components/ui";
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

const inputCls = "w-full rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";
const btnCls =
  "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const primaryCls =
  "rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50";

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const month = () => new Date().toISOString().slice(0, 7);

export function OverheadEditor({ subs, charges, summary, reconcile, thresholdCents }: { subs: Subscription[]; charges: MeteredCharge[]; summary: OverheadSummary; reconcile: { lines: ReconcileLine[]; caveat: string }; thresholdCents: number | null }) {
  const [pending, start] = useTransition();
  const [sub, setSub] = useState({ name: "", vendor: "", amountDollars: "", cadence: "monthly" as Cadence, source: "owner_reported" as SubscriptionSource, startedOn: "", externalRef: "", notes: "" });
  const [chg, setChg] = useState({ provider: "", period: month(), amountDollars: "", source: "bill" as ChargeSource, externalRef: "", notes: "" });
  const [threshold, setThreshold] = useState(thresholdCents === null ? "" : (thresholdCents / 100).toFixed(2));
  const [refEdit, setRefEdit] = useState<Record<string, string>>({});
  const recBy = new Map(reconcile.lines.map((l) => [l.subscription.id, l]));

  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await runAction(fn);
      if (r && r.ok !== false) after?.();
    });

  return (
    <div className="flex flex-col gap-6">
      <Card kind="soft" className="px-4 py-3 text-[12px] text-ink-3">
        <div className="flex flex-wrap gap-4 text-[13px] text-ink">
          <div>Fixed <strong>{dollars(summary.fixed.monthly_cents)}</strong>/mo</div>
          <div>Metered ({summary.month}) <strong>{dollars(summary.metered.cents)}</strong></div>
          <div>Known total <strong>{dollars(summary.total_known_cents)}</strong></div>
          {summary.alert.exceeded ? <Chip kind="flag">Over threshold — notification only</Chip> : null}
        </div>
        <ul className="mt-2">
          {summary.caveats.map((c) => (
            <li key={c}>· {c}</li>
          ))}
        </ul>
      </Card>

      <section>
        <Eyebrow>Fixed subscriptions</Eyebrow>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Vendor</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Started / ended</th>
                <th className="py-2 pr-3">External ref (bill / QBO)</th>
                <th className="py-2 pr-3">Reconciliation</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => {
                const rec = recBy.get(s.id);
                return (
                  <tr key={s.id} className={`border-b border-rule-soft align-top ${s.ended_on ? "opacity-60" : ""}`}>
                    <td className="py-2 pr-3 text-ink">
                      {s.name}
                      {s.notes ? <div className="max-w-[280px] text-[11px] text-ink-4">{s.notes}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{s.vendor}</td>
                    <td className="py-2 pr-3">
                      {dollars(s.amount_cents)}/{s.cadence === "yearly" ? "yr" : "mo"}
                    </td>
                    <td className="py-2 pr-3">{s.source === "owner_reported" ? <Chip kind="ghost">owner-reported</Chip> : <Chip kind="money">{s.source}</Chip>}</td>
                    <td className="py-2 pr-3 font-mono text-[12px]">
                      {s.started_on}
                      {s.ended_on ? ` → ${s.ended_on}` : ""}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex gap-1">
                        <input className={inputCls} value={refEdit[s.id] ?? s.external_ref ?? ""} placeholder="e.g. qbo:bill:123" onChange={(e) => setRefEdit({ ...refEdit, [s.id]: e.target.value })} />
                        <button
                          type="button"
                          className={btnCls}
                          disabled={pending || refEdit[s.id] === undefined}
                          onClick={() => go(() => updateSubscriptionAction(s.id, { externalRef: refEdit[s.id], source: refEdit[s.id].trim() ? (refEdit[s.id].startsWith("qbo") ? "qbo" : "bill") : "owner_reported" }), () => setRefEdit((r) => ({ ...r, [s.id]: undefined as unknown as string })))}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-ink-3">
                      {rec ? (
                        <>
                          <Chip kind={rec.status === "matched" ? "money" : rec.status === "unmatched" ? "flag" : "ghost"}>{rec.status.replace(/_/g, " ")}</Chip>
                          <div className="mt-1 max-w-[260px]">{rec.note}</div>
                        </>
                      ) : s.ended_on ? "ended" : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex gap-1">
                        {!s.ended_on ? (
                          <button type="button" className={btnCls} disabled={pending} onClick={() => go(() => endSubscriptionAction(s.id))}>
                            End
                          </button>
                        ) : null}
                        <button type="button" className={btnCls} disabled={pending} onClick={() => go(() => deleteSubscriptionAction(s.id))}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Card className="mt-3 px-4 py-3">
          <Eyebrow>Add a subscription</Eyebrow>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <input className={inputCls} placeholder="Name" value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} />
            <input className={inputCls} placeholder="Vendor" value={sub.vendor} onChange={(e) => setSub({ ...sub, vendor: e.target.value })} />
            <input className={inputCls} placeholder="Amount ($)" inputMode="decimal" value={sub.amountDollars} onChange={(e) => setSub({ ...sub, amountDollars: e.target.value })} />
            <select className={inputCls} value={sub.cadence} onChange={(e) => setSub({ ...sub, cadence: e.target.value as Cadence })}>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
            <select className={inputCls} value={sub.source} onChange={(e) => setSub({ ...sub, source: e.target.value as SubscriptionSource })}>
              <option value="owner_reported">owner-reported</option>
              <option value="bill">from a bill</option>
              <option value="qbo">from QuickBooks</option>
            </select>
            <input className={inputCls} type="date" value={sub.startedOn} onChange={(e) => setSub({ ...sub, startedOn: e.target.value })} />
            <input className={inputCls} placeholder="External ref (optional)" value={sub.externalRef} onChange={(e) => setSub({ ...sub, externalRef: e.target.value })} />
            <input className={inputCls} placeholder="Notes" value={sub.notes} onChange={(e) => setSub({ ...sub, notes: e.target.value })} />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className={primaryCls}
              disabled={pending || !sub.name || !sub.vendor || !sub.amountDollars}
              onClick={() => go(() => addSubscriptionAction(sub), () => setSub({ ...sub, name: "", amountDollars: "", externalRef: "", notes: "" }))}
            >
              Add subscription
            </button>
            <span className="text-[11px] text-ink-4">Same external ref, or same name + vendor + start date, is refused as a duplicate.</span>
          </div>
        </Card>
      </section>

      <section>
        <Eyebrow>Metered charges (actual API usage, by month)</Eyebrow>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Period</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">External ref</th>
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
                  <td className="py-2 pr-3 font-mono text-[12px]">{c.period}</td>
                  <td className="py-2 pr-3">{c.provider}</td>
                  <td className="py-2 pr-3">{dollars(c.amount_cents)}</td>
                  <td className="py-2 pr-3">{c.source === "estimate" ? <Chip kind="flag">estimate</Chip> : c.source}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{c.external_ref ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" className={btnCls} disabled={pending} onClick={() => go(() => deleteMeteredChargeAction(c.id))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Card className="mt-3 px-4 py-3">
          <Eyebrow>Record a metered charge</Eyebrow>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <input className={inputCls} placeholder="Provider (Anthropic, OpenAI…)" value={chg.provider} onChange={(e) => setChg({ ...chg, provider: e.target.value })} />
            <input className={inputCls} placeholder="Period YYYY-MM" value={chg.period} onChange={(e) => setChg({ ...chg, period: e.target.value })} />
            <input className={inputCls} placeholder="Amount ($)" inputMode="decimal" value={chg.amountDollars} onChange={(e) => setChg({ ...chg, amountDollars: e.target.value })} />
            <select className={inputCls} value={chg.source} onChange={(e) => setChg({ ...chg, source: e.target.value as ChargeSource })}>
              <option value="bill">from a bill</option>
              <option value="provider_usage">provider usage page</option>
              <option value="qbo">from QuickBooks</option>
              <option value="owner_reported">owner-reported</option>
              <option value="estimate">estimate (labelled)</option>
            </select>
            <input className={inputCls} placeholder="External ref (invoice id)" value={chg.externalRef} onChange={(e) => setChg({ ...chg, externalRef: e.target.value })} />
            <input className={inputCls} placeholder="Notes" value={chg.notes} onChange={(e) => setChg({ ...chg, notes: e.target.value })} />
          </div>
          <div className="mt-2">
            <button type="button" className={primaryCls} disabled={pending || !chg.provider || !chg.amountDollars} onClick={() => go(() => addMeteredChargeAction(chg), () => setChg({ ...chg, amountDollars: "", externalRef: "", notes: "" }))}>
              Record charge
            </button>
          </div>
        </Card>
      </section>

      <section>
        <Eyebrow>Monthly threshold (notification only)</Eyebrow>
        <Card className="mt-2 px-4 py-3">
          <div className="flex max-w-[420px] items-center gap-2">
            <input className={inputCls} placeholder="Blank = no threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <button type="button" className={btnCls} disabled={pending} onClick={() => go(() => setAlertThresholdAction(threshold))}>
              Save
            </button>
          </div>
          <div className="mt-1 text-[11px] text-ink-4">When known overhead for the month passes this, you get one money notification. Nothing is paused or blocked (DECISIONS.md: no fixed AI budget ceiling).</div>
        </Card>
      </section>

      <section>
        <Eyebrow>Reconciliation proposal</Eyebrow>
        <Card className="mt-2 px-4 py-3 text-[12px] text-ink-3">
          <div>{reconcile.caveat}</div>
          <ul className="mt-2 flex flex-col gap-1">
            {reconcile.lines.map((l) => (
              <li key={l.subscription.id}>
                <strong className="text-ink">{l.subscription.name}</strong> — {l.note}
                {l.candidates.length ? (
                  <ul className="ml-4 text-ink-4">
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
