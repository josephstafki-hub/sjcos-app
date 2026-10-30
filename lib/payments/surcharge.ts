// Credit card surcharge (Joe, 2026-10-30). Square's own surcharge setting
// only reaches in-person payments (Terminal / Mobile Payments SDK); online
// Payments API charges never get it, so SJC OS adds it here.
//
// The rule: a CREDIT card (not debit, not prepaid) pays enough on top of the
// invoice to cover Square's fee, never more than the cap for its brand.
// Square takes `feePct` of the whole charge, so covering it on a balance B
// takes B·f/(1−f) — 4% fee → 4.17% surcharge — and the cap wins when it is
// lower (Visa allows 3%, Mastercard 4%; debit and prepaid cards none).
// Rounded down to the cent so the surcharge never exceeds the cap.
//
// Pure, no server-only imports: the pay page computes the same figure the
// server charges, and the server re-checks Square's own reading of the card
// before taking the money (lib/payments/service.ts chargeAttempt).

import type { Run } from "../commands/core.ts";

export const SURCHARGE_SETTING_KEY = "payments.card_surcharge";

export interface SurchargeConfig {
  /** What Square charges per card payment, % of the charged total. 0 = surcharge off. */
  feePct: number;
  /** Cap for any credit card brand not listed in brandCapPct. */
  capPct: number;
  /** Per-brand caps, keyed by Square's brand (VISA, MASTERCARD, AMERICAN_EXPRESS, DISCOVER, …). */
  brandCapPct: Record<string, number>;
}

/** Square took a flat 4.0% on both live card payments (Oct 2026); 3% is
 *  Visa's credit surcharge cap and the lowest of the networks'. */
export const DEFAULT_SURCHARGE: SurchargeConfig = { feePct: 4, capPct: 3, brandCapPct: {} };

/** Minnesota (Minn. Stat. 325G.051) allows at most 5%. */
const MAX_CAP_PCT = 5;

export interface CardFacts {
  brand?: string | null;
  cardType?: string | null;
  prepaidType?: string | null;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

function clampPct(n: unknown, max: number): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(0, Math.round(v * 100) / 100));
}

export function parseSurchargeConfig(raw: string | null | undefined): SurchargeConfig {
  if (!raw) return { ...DEFAULT_SURCHARGE, brandCapPct: {} };
  let j: Partial<SurchargeConfig>;
  try {
    j = JSON.parse(raw) as Partial<SurchargeConfig>;
  } catch {
    return { ...DEFAULT_SURCHARGE, brandCapPct: {} };
  }
  const brandCapPct: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.brandCapPct ?? {})) {
    const c = clampPct(v, MAX_CAP_PCT);
    if (k.trim() && c != null) brandCapPct[norm(k)] = c;
  }
  return {
    feePct: clampPct(j.feePct, 20) ?? DEFAULT_SURCHARGE.feePct,
    capPct: clampPct(j.capPct, MAX_CAP_PCT) ?? DEFAULT_SURCHARGE.capPct,
    brandCapPct,
  };
}

export async function loadSurchargeConfig(run: Run): Promise<SurchargeConfig> {
  const [row] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [SURCHARGE_SETTING_KEY]);
  return parseSurchargeConfig(row?.value ?? null);
}

/** Only credit cards carry a surcharge; debit and prepaid cards never do. */
export function surchargeable(card: CardFacts | null | undefined): boolean {
  if (!card) return false;
  return norm(card.cardType) === "CREDIT" && norm(card.prepaidType) !== "PREPAID";
}

/** % of the invoice balance that exactly covers a fee of feePct on the total. */
export function offsetPct(cfg: SurchargeConfig): number {
  if (cfg.feePct <= 0 || cfg.feePct >= 100) return 0;
  return (100 * cfg.feePct) / (100 - cfg.feePct);
}

/** The surcharge % a card of this brand pays (0 when off). */
export function surchargePct(cfg: SurchargeConfig, brand: string | null | undefined): number {
  const cap = cfg.brandCapPct[norm(brand)] ?? cfg.capPct;
  return Math.max(0, Math.min(cap, offsetPct(cfg)));
}

/** The surcharge in cents on `balanceCents` for this card; 0 unless it is a credit card. */
export function surchargeCents(balanceCents: number, cfg: SurchargeConfig, card: CardFacts | null | undefined): number {
  if (!surchargeable(card) || balanceCents <= 0) return 0;
  return Math.floor((balanceCents * surchargePct(cfg, card!.brand)) / 100);
}

/** Highest surcharge % any credit card can pay — what the notices quote. */
export function maxSurchargePct(cfg: SurchargeConfig): number {
  const caps = [cfg.capPct, ...Object.values(cfg.brandCapPct)];
  return Math.max(0, Math.min(Math.max(...caps), offsetPct(cfg)));
}

export function fmtPct(pct: number): string {
  return `${Number(pct.toFixed(2))}%`;
}

/** One-line notice for the invoice email and PDF; null when the surcharge is off. */
export function surchargeNotice(cfg: SurchargeConfig): string | null {
  const max = maxSurchargePct(cfg);
  if (max <= 0) return null;
  const caps = new Set([cfg.capPct, ...Object.values(cfg.brandCapPct)].map((c) => Math.min(c, offsetPct(cfg))));
  const rate = caps.size > 1 ? `a surcharge of up to ${fmtPct(max)}` : `a ${fmtPct(max)} surcharge`;
  return `Credit card payments carry ${rate} to cover card processing fees. Debit cards, bank transfer and check have no fee.`;
}
