"use client";

import { useState, useTransition } from "react";
import { runAction } from "@/lib/run-action";

export interface OnlinePaymentRow {
  id: string;
  invoice_number: string;
  client: string;
  slug: string;
  method: "card" | "ach";
  amount_cents: number;
  refundable_cents: number;
  state: string;
  completed_at: string | null;
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Recent online payments on Settings › Payments, each with a Refund form.
 *  Refund asks for approval: it files a refund card on Decisions (and
 *  Telegram); approving it is what refunds in Square. */
export function RefundPayments({ rows, request }: { rows: OnlinePaymentRow[]; request: (attemptId: string, input: { amountCents: number; reason: string }) => Promise<{ ok: boolean; error?: string; decisionId?: string }> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  if (!rows.length) return <p className="mt-2 text-[12px] text-ink-3">No online payments yet.</p>;
  return (
    <ul className="mt-2 flex flex-col divide-y divide-rule">
      {rows.map((r) => (
        <li key={r.id} className="py-2 text-[12.5px] text-ink">
          <div className="flex flex-wrap items-center gap-2">
            <a className="underline decoration-rule" href={`/projects/${r.slug}?tab=Money`}>{r.client}</a>
            <span className="text-ink-3">· Invoice {r.invoice_number} · {r.method === "ach" ? "bank transfer" : "card"} · {usd(r.amount_cents)}{r.completed_at ? ` · ${r.completed_at.slice(0, 10)}` : ""}</span>
            {r.state !== "completed" && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-flag">{r.state}</span>}
            <span className="flex-1" />
            {r.refundable_cents > 0 && open !== r.id && (
              <button
                type="button"
                className="rounded-md border border-rule px-2 py-1 text-[11.5px]"
                onClick={() => {
                  setOpen(r.id);
                  setAmount((r.refundable_cents / 100).toFixed(2));
                  setReason("");
                }}
              >
                Refund…
              </button>
            )}
          </div>
          {open === r.id && (
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
                start(async () => {
                  const res = await runAction(() => request(r.id, { amountCents: cents, reason: reason.trim() }), { fallback: "The refund card wasn't filed." });
                  if (res && (res as { ok?: boolean }).ok !== false) {
                    setNote((n) => ({ ...n, [r.id]: "Refund card filed on Decisions. Approving it refunds in Square." }));
                    setOpen(null);
                  }
                });
              }}
            >
              <label className="flex flex-col gap-1 text-[11px] text-ink-3">
                Amount (up to {usd(r.refundable_cents)})
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-28 rounded-md border border-rule bg-paper px-2 py-1 text-[13px] text-ink" />
              </label>
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] text-ink-3">
                Reason
                <input value={reason} onChange={(e) => setReason(e.target.value)} required className="rounded-md border border-rule bg-paper px-2 py-1 text-[13px] text-ink" />
              </label>
              <button type="submit" disabled={pending} className="rounded-md border border-ink bg-ink px-3 py-1 text-[12px] font-semibold text-paper disabled:opacity-50">
                {pending ? "Filing…" : "Ask to refund"}
              </button>
              <button type="button" onClick={() => setOpen(null)} className="text-[12px] text-ink-3">Cancel</button>
            </form>
          )}
          {note[r.id] && <div className="mt-1 text-[11.5px] text-ink-3">{note[r.id]}</div>}
        </li>
      ))}
    </ul>
  );
}
