"use client";

// Square checkout (A20). Tokenization is entirely client-side through Square's
// Web Payments SDK — this component never sees a card number or bank
// credentials, only the opaque source id it forwards to
// /api/payments/square/create. The server decides the amount. An attempt
// nonce is minted once per invoice revision and kept in sessionStorage, so a
// refresh or a second tap re-uses the same server attempt (no double charge).
// A DECLINED attempt charged nothing, so its nonce is dropped and the next tap
// (fixed card number, another card) starts a fresh attempt.
//
// In the fake environment (no Square account) the SDK is not loaded and a
// test source id is sent instead, so the whole flow can be exercised end to
// end without credentials.
//
// Credit card surcharge (lib/payments/surcharge.ts): the SDK reports the card
// type when it tokenizes, so a credit card gets a confirm step showing the
// surcharge and the new total before anything is charged. The server
// recomputes the same figure and checks Square's own reading of the card.

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { fmtPct, surchargeCents, surchargeNotice, surchargePct, type CardFacts, type SurchargeConfig } from "@/lib/payments/surcharge";

type Method = "card" | "ach";

interface SquareCard {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<{ status: string; token?: string; details?: { card?: CardFacts }; errors?: { message?: string }[] }>;
  destroy?: () => Promise<void>;
}
interface SquareAch {
  tokenize(opts: { accountHolderName: string; intent: "CHARGE"; amount: string; currency: "USD" }): Promise<{ status: string; token?: string; errors?: { message?: string }[] }>;
}
interface SquarePayments {
  card(): Promise<SquareCard>;
  ach(): Promise<SquareAch>;
}
declare global {
  interface Window {
    Square?: { payments(appId: string, locationId: string): SquarePayments };
  }
}

const SDK_URL = { sandbox: "https://sandbox.web.squarecdn.com/v1/square.js", production: "https://web.squarecdn.com/v1/square.js" } as const;

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const BRAND: Record<string, string> = { VISA: "Visa", MASTERCARD: "Mastercard", AMERICAN_EXPRESS: "American Express", DISCOVER: "Discover", DISCOVER_DINERS: "Diners Club", JCB: "JCB", CHINA_UNIONPAY: "UnionPay" };

const nonceKey = (invoiceId: number, revision: number) => `sjc-pay-nonce:${invoiceId}:rev${revision}`;

function forgetNonce(invoiceId: number, revision: number): void {
  try {
    window.sessionStorage.removeItem(nonceKey(invoiceId, revision));
  } catch {
    /* no storage: every tap already gets a fresh nonce */
  }
}

function nonceFor(invoiceId: number, revision: number): string {
  const key = nonceKey(invoiceId, revision);
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
    window.sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return `n-${Date.now()}`;
  }
}

export function PayInvoice({
  invoiceId,
  revision,
  amountCents,
  applicationId,
  locationId,
  environment,
  allowCard,
  allowAch,
  surcharge,
}: {
  invoiceId: number;
  revision: number;
  amountCents: number;
  applicationId: string;
  locationId: string;
  environment: "sandbox" | "production" | "fake";
  allowCard: boolean;
  allowAch: boolean;
  surcharge: SurchargeConfig;
}) {
  const [method, setMethod] = useState<Method>(allowCard ? "card" : "ach");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(environment === "fake");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ state: string; message: string } | null>(null);
  // A tokenized credit card waiting for the client to accept the surcharge.
  const [confirm, setConfirm] = useState<{ sourceId: string; card: CardFacts; surchargeCents: number } | null>(null);
  // Square voided a surcharged card as debit/prepaid: the retry goes without it.
  const [noSurcharge, setNoSurcharge] = useState(false);
  const notice = surchargeNotice(surcharge);
  const payments = useRef<SquarePayments | null>(null);
  const card = useRef<SquareCard | null>(null);

  // Load the SDK only when a real environment is connected.
  useEffect(() => {
    if (environment === "fake") return;
    let cancelled = false;
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL[environment]}"]`);
    const onLoad = async () => {
      if (cancelled || !window.Square) return;
      try {
        payments.current = window.Square.payments(applicationId, locationId);
        setSdkReady(true);
      } catch (e) {
        setError((e as Error).message || "Could not start the payment form.");
      }
    };
    if (existing && window.Square) void onLoad();
    else {
      const s = existing ?? document.createElement("script");
      if (!existing) {
        s.src = SDK_URL[environment];
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener("load", onLoad);
      s.addEventListener("error", () => setError("Could not load the payment form. Try again shortly."));
    }
    return () => {
      cancelled = true;
    };
  }, [environment, applicationId, locationId]);

  // Attach the card form when the card method is chosen.
  useEffect(() => {
    if (environment === "fake" || !sdkReady || method !== "card" || !payments.current) return;
    let active = true;
    (async () => {
      try {
        const c = await payments.current!.card();
        if (!active) return;
        await c.attach("#sjc-square-card");
        card.current = c;
      } catch (e) {
        setError((e as Error).message || "Could not show the card form.");
      }
    })();
    return () => {
      active = false;
      void card.current?.destroy?.();
      card.current = null;
    };
  }, [environment, sdkReady, method]);

  async function tokenize(): Promise<{ sourceId: string; card: CardFacts | null }> {
    if (environment === "fake") return method === "card" ? { sourceId: "cnon:card-ok", card: { brand: "VISA", cardType: "CREDIT", prepaidType: "NOT_PREPAID" } } : { sourceId: "bauth:ok", card: null };
    if (!payments.current) throw new Error("Payment form is not ready.");
    if (method === "card") {
      if (!card.current) throw new Error("Card form is not ready.");
      const r = await card.current.tokenize();
      if (r.status !== "OK" || !r.token) throw new Error(r.errors?.[0]?.message || "Card details were not accepted.");
      return { sourceId: r.token, card: r.details?.card ?? null };
    }
    if (!holder.trim()) throw new Error("Enter the account holder's name.");
    const ach = await payments.current.ach();
    const r = await ach.tokenize({ accountHolderName: holder.trim(), intent: "CHARGE", amount: (amountCents / 100).toFixed(2), currency: "USD" });
    if (r.status !== "OK" || !r.token) throw new Error(r.errors?.[0]?.message || "Bank details were not accepted.");
    return { sourceId: r.token, card: null };
  }

  /** Pay tapped: tokenize; a credit card stops at the surcharge confirm step. */
  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await tokenize();
      const card = noSurcharge ? null : t.card;
      const s = method === "card" ? surchargeCents(amountCents, surcharge, card) : 0;
      if (s > 0 && card) {
        setConfirm({ sourceId: t.sourceId, card, surchargeCents: s });
        return;
      }
      await charge(t.sourceId, method === "card" ? card : null, 0);
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSurcharge() {
    if (busy || !confirm) return;
    setBusy(true);
    setError(null);
    try {
      await charge(confirm.sourceId, confirm.card, confirm.surchargeCents);
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
    } finally {
      setConfirm(null);
      setBusy(false);
    }
  }

  async function charge(sourceId: string, cardFacts: CardFacts | null, expectedSurchargeCents: number) {
    const res = await fetch("/api/payments/square/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, method, sourceId, nonce: nonceFor(invoiceId, revision), expectedAmountCents: amountCents, expectedRevision: revision, card: cardFacts, expectedSurchargeCents }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; code?: string; detail?: string; state?: string; message?: string };
    // Declined now, or a tap that landed on an earlier declined attempt:
    // nothing was charged, so let them try again with a fresh attempt.
    if (body.code === "declined" || (body.ok && body.state === "failed")) {
      forgetNonce(invoiceId, revision);
      if (body.detail === "SURCHARGE_CARD_MISMATCH") {
        setNoSurcharge(true);
        throw new Error(`${body.error} Nothing was charged. Tap Pay again to pay ${fmt(amountCents)} with no surcharge.`);
      }
      throw new Error(`${body.error || body.message || "The payment did not go through."} Nothing was charged; you can try again.`);
    }
    if (!res.ok || !body.ok) throw new Error(body.error || "Payment could not be started.");
    setDone({ state: body.state ?? "unknown", message: body.message ?? "" });
  }

  if (done) {
    return (
      <Card kind={done.state === "completed" ? "money" : done.state === "failed" ? "flag" : "soft"} className="p-3">
        <div className="text-[13.5px] text-ink">{done.message}</div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{done.state.replace("_", " ")}</div>
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex gap-2">
        {allowCard && (
          <button type="button" onClick={() => { setMethod("card"); setConfirm(null); }} className={`rounded-md border px-2.5 py-1 text-[12px] ${method === "card" ? "border-ink bg-ink text-paper" : "border-rule text-ink-2"}`}>
            Card
          </button>
        )}
        {allowAch && (
          <button type="button" onClick={() => { setMethod("ach"); setConfirm(null); }} className={`rounded-md border px-2.5 py-1 text-[12px] ${method === "ach" ? "border-ink bg-ink text-paper" : "border-rule text-ink-2"}`}>
            Bank transfer (ACH)
          </button>
        )}
      </div>

      <div className="mt-3">
        {method === "card" ? (
          <>
            {environment === "fake" ? (
              <p className="text-[12px] text-ink-3">Test mode — no card details are collected; a test payment is recorded.</p>
            ) : (
              <div id="sjc-square-card" className="min-h-[48px]" />
            )}
            {notice && !noSurcharge && <p className="mt-2 text-[11px] text-ink-3">{notice}</p>}
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Account holder name</span>
            <input value={holder} onChange={(e) => setHolder(e.target.value)} className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent" placeholder="As it appears on the account" />
            <span className="text-[11px] text-ink-3">Bank transfers pay the full open balance ({fmt(amountCents)}) and take 3–5 business days to clear. The invoice stays open until then.</span>
          </label>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}

      {confirm ? (
        <div className="mt-3 rounded-md border border-rule p-2.5">
          <div className="text-[12.5px] text-ink">
            {BRAND[String(confirm.card.brand ?? "").toUpperCase()] ?? "This"} credit card carries a {fmtPct(surchargePct(surcharge, confirm.card.brand))} surcharge to cover card processing fees.
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-[12.5px]">
            <span className="text-ink-3">Invoice</span>
            <span className="text-right tabular-nums text-ink">{fmt(amountCents)}</span>
            <span className="text-ink-3">Credit card surcharge</span>
            <span className="text-right tabular-nums text-ink">{fmt(confirm.surchargeCents)}</span>
            <span className="font-semibold text-ink">Total charged</span>
            <span className="text-right font-semibold tabular-nums text-ink">{fmt(amountCents + confirm.surchargeCents)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={confirmSurcharge} disabled={busy} className="inline-flex items-center rounded-md border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-paper disabled:opacity-50">
              {busy ? "Processing…" : `Pay ${fmt(amountCents + confirm.surchargeCents)}`}
            </button>
            <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="text-[12px] text-ink-2 underline disabled:opacity-50">
              Use a different card or bank transfer
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={pay} disabled={busy || !sdkReady} className="mt-3 inline-flex items-center rounded-md border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-paper disabled:opacity-50">
          {busy ? "Processing…" : `Pay ${fmt(amountCents)}`}
        </button>
      )}
      <p className="mt-2 text-[10.5px] text-ink-3">Processed by Square. SJ Carpentry never sees your card or bank details.</p>
    </Card>
  );
}
