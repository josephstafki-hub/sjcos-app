// Outgoing payment rail adapter (INTEGRATIONS "Purchase, vendor payment and
// refunds"). No provider has been selected, so the only implementation is the
// manual path: an approved payment becomes 'manual_pending' with an owner
// execution step and is never called paid until verified confirmation.
//
// A future rail implements PaymentRail.execute() and is selected by
// vendor_payment_config.rail = 'future' + provider. It must be idempotent on
// `idempotencyKey` (bill id + decision id) and must return 'unknown' — never
// 'failed' — for a timeout after transmission.

import type { Run } from "../commands/core.ts";

export interface RailPaymentInput {
  billId: number;
  decisionId: string;
  amountCents: number;
  currency: string;
  destination: Record<string, unknown>;
  /** `bill:<id>:pay:decision:<id>` — the rail must not disburse twice for one key. */
  idempotencyKey: string;
}

export type RailResult =
  | { kind: "manual_required"; instructions: string }
  | { kind: "accepted"; providerRef: string }
  | { kind: "confirmed"; providerRef: string }
  | { kind: "unknown"; providerRef?: string | null; error?: string }
  | { kind: "failed"; error: string; retryable: boolean };

export interface PaymentRail {
  name: "none" | "manual" | string;
  execute(input: RailPaymentInput): Promise<RailResult>;
}

export const noPaymentRail: PaymentRail = {
  name: "none",
  async execute(input) {
    return {
      kind: "manual_required",
      instructions: `No outgoing payment rail is configured. Pay ${input.currency} ${(input.amountCents / 100).toFixed(2)} for bill #${input.billId} by hand (check / bank transfer / card) and record the confirmation with its reference.`,
    };
  },
};

export interface VendorPaymentConfig {
  rail: "none" | "manual" | "future";
  provider: string | null;
  notes: string;
}

export async function loadVendorPaymentConfig(run: Run): Promise<VendorPaymentConfig> {
  const [row] = await run<VendorPaymentConfig>(`SELECT rail, provider, notes FROM vendor_payment_config WHERE id = 1`);
  return row ?? { rail: "none", provider: null, notes: "" };
}

/** The rail for the current configuration. 'future' with no registered
 *  provider implementation refuses loudly rather than pretending. */
export async function loadPaymentRail(run: Run, registry: Record<string, PaymentRail> = {}): Promise<PaymentRail> {
  const cfg = await loadVendorPaymentConfig(run);
  if (cfg.rail === "none" || cfg.rail === "manual") return { ...noPaymentRail, name: cfg.rail };
  const impl = cfg.provider ? registry[cfg.provider] : undefined;
  if (!impl) throw new Error(`vendor_payment_config.rail is 'future' but provider "${cfg.provider ?? ""}" has no adapter; payments stay manual until one is registered.`);
  return impl;
}
