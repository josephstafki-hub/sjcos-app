"use client";

// Square checkout (A20). Tokenization is entirely client-side through Square's
// Web Payments SDK — this component never sees a card number or bank
// credentials, only the opaque source id it forwards to
// /api/payments/square/create. The server decides the amount. An attempt
// nonce is minted once per invoice revision and kept in sessionStorage, so a
// refresh or a second tap re-uses the same server attempt (no double charge).
//
// In the fake environment (no Square account) the SDK is not loaded and a
// test source id is sent instead, so the whole flow can be exercised end to
// end without credentials.

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";

type Method = "card" | "ach";

interface SquareCard {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<{ status: string; token?: string; errors?: { message?: string }[] }>;
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

function nonceFor(invoiceId: number, revision: number): string {
  const key = `sjc-pay-nonce:${invoiceId}:rev${revision}`;
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
}: {
  invoiceId: number;
  revision: number;
  amountCents: number;
  applicationId: string;
  locationId: string;
  environment: "sandbox" | "production" | "fake";
  allowCard: boolean;
  allowAch: boolean;
}) {
  const [method, setMethod] = useState<Method>(allowCard ? "card" : "ach");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(environment === "fake");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ state: string; message: string } | null>(null);
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

  async function tokenize(): Promise<string> {
    if (environment === "fake") return method === "card" ? "cnon:card-ok" : "bauth:ok";
    if (!payments.current) throw new Error("Payment form is not ready.");
    if (method === "card") {
      if (!card.current) throw new Error("Card form is not ready.");
      const r = await card.current.tokenize();
      if (r.status !== "OK" || !r.token) throw new Error(r.errors?.[0]?.message || "Card details were not accepted.");
      return r.token;
    }
    if (!holder.trim()) throw new Error("Enter the account holder's name.");
    const ach = await payments.current.ach();
    const r = await ach.tokenize({ accountHolderName: holder.trim(), intent: "CHARGE", amount: (amountCents / 100).toFixed(2), currency: "USD" });
    if (r.status !== "OK" || !r.token) throw new Error(r.errors?.[0]?.message || "Bank details were not accepted.");
    return r.token;
  }

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const sourceId = await tokenize();
      const res = await fetch("/api/payments/square/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, method, sourceId, nonce: nonceFor(invoiceId, revision), expectedAmountCents: amountCents, expectedRevision: revision }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; state?: string; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || "Payment could not be started.");
      setDone({ state: body.state ?? "unknown", message: body.message ?? "" });
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
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
          <button type="button" onClick={() => setMethod("card")} className={`rounded-md border px-2.5 py-1 text-[12px] ${method === "card" ? "border-ink bg-ink text-paper" : "border-rule text-ink-2"}`}>
            Card
          </button>
        )}
        {allowAch && (
          <button type="button" onClick={() => setMethod("ach")} className={`rounded-md border px-2.5 py-1 text-[12px] ${method === "ach" ? "border-ink bg-ink text-paper" : "border-rule text-ink-2"}`}>
            Bank transfer (ACH)
          </button>
        )}
      </div>

      <div className="mt-3">
        {method === "card" ? (
          environment === "fake" ? (
            <p className="text-[12px] text-ink-3">Test mode — no card details are collected; a test payment is recorded.</p>
          ) : (
            <div id="sjc-square-card" className="min-h-[48px]" />
          )
        ) : (
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Account holder name</span>
            <input value={holder} onChange={(e) => setHolder(e.target.value)} className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent" placeholder="As it appears on the account" />
            <span className="text-[11px] text-ink-3">Bank transfers pay the full open balance ({fmt(amountCents)}) and take 3–5 business days to clear. The invoice stays open until then.</span>
          </label>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}

      <button type="button" onClick={pay} disabled={busy || !sdkReady} className="mt-3 inline-flex items-center rounded-md border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-paper disabled:opacity-50">
        {busy ? "Processing…" : `Pay ${fmt(amountCents)}`}
      </button>
      <p className="mt-2 text-[10.5px] text-ink-3">Processed by Square. SJ Carpentry never sees your card or bank details.</p>
    </Card>
  );
}
