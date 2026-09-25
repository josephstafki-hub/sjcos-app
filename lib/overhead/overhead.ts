// Overhead (A18) — fixed subscriptions vs metered charges. Pure `run` style.
//
// DECISIONS.md "Overhead": track AI/services as overhead; reported
// subscriptions Anthropic $200/month and OpenAI $10/month (seeded by
// migration 0018 as owner_reported). "AI budget": no fixed ceiling; thresholds
// only notify. Rules this module keeps:
//   • a subscription fee never implies API credits — metered usage is its own
//     table and its own line in the summary;
//   • reconciliation matches on external_ref ONLY (bill / QBO id); it never
//     dedupes on amount, and a second import of the same ref is refused by the
//     UNIQUE index (DuplicateOverheadError), as is the same (name, vendor,
//     started_on) reported twice by hand;
//   • a provider with a subscription but no metered record for the month is
//     reported as "metered usage unknown", not $0.

import type { Run } from "../commands/core.ts";

export type Cadence = "monthly" | "yearly";
export type SubscriptionSource = "owner_reported" | "bill" | "qbo";
export type ChargeSource = "owner_reported" | "bill" | "qbo" | "provider_usage" | "estimate";

export interface Subscription {
  id: string;
  name: string;
  vendor: string;
  amount_cents: number;
  cadence: Cadence;
  source: SubscriptionSource;
  started_on: string;
  ended_on: string | null;
  external_ref: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface MeteredCharge {
  id: string;
  provider: string;
  period: string;
  amount_cents: number;
  source: ChargeSource;
  external_ref: string | null;
  notes: string;
  created_at: string;
}

export class DuplicateOverheadError extends Error {
  constructor(what: string) {
    super(`Refused: ${what} is already recorded. Duplicate imports are rejected on external_ref and on (name, vendor, started_on); nothing was written.`);
    this.name = "DuplicateOverheadError";
  }
}

const SUB_COLS = `id::text AS id, name, vendor, amount_cents, cadence, source, started_on::text AS started_on, ended_on::text AS ended_on, external_ref, notes, created_at::text AS created_at, updated_at::text AS updated_at`;
const CHG_COLS = `id::text AS id, provider, period, amount_cents, source, external_ref, notes, created_at::text AS created_at`;

function isUnique(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function listSubscriptions(run: Run, opts: { includeEnded?: boolean } = {}): Promise<Subscription[]> {
  return run<Subscription>(`SELECT ${SUB_COLS} FROM overhead_subscriptions WHERE $1::boolean OR ended_on IS NULL ORDER BY vendor, name`, [Boolean(opts.includeEnded)]);
}

export interface SubscriptionInput {
  name: string;
  vendor: string;
  amountCents: number;
  cadence?: Cadence;
  source?: SubscriptionSource;
  startedOn?: string;
  endedOn?: string | null;
  externalRef?: string | null;
  notes?: string;
}

export async function addSubscription(run: Run, input: SubscriptionInput): Promise<Subscription> {
  if (!input.name.trim() || !input.vendor.trim()) throw new Error("name and vendor are required");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) throw new Error("amountCents must be a non-negative integer (cents)");
  try {
    const [row] = await run<Subscription>(
      `INSERT INTO overhead_subscriptions (name, vendor, amount_cents, cadence, source, started_on, ended_on, external_ref, notes)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, NULLIF($8, ''), $9) RETURNING ${SUB_COLS}`,
      [input.name.trim(), input.vendor.trim(), input.amountCents, input.cadence ?? "monthly", input.source ?? "owner_reported", input.startedOn ?? null, input.endedOn ?? null, input.externalRef ?? null, input.notes ?? ""],
    );
    return row;
  } catch (e) {
    if (isUnique(e)) throw new DuplicateOverheadError(input.externalRef ? `subscription ${input.externalRef}` : `${input.name} / ${input.vendor} starting ${input.startedOn ?? "today"}`);
    throw e;
  }
}

export async function updateSubscription(run: Run, id: string, patch: Partial<SubscriptionInput>): Promise<Subscription | null> {
  try {
    const [row] = await run<Subscription>(
      `UPDATE overhead_subscriptions SET
         name = COALESCE($2, name), vendor = COALESCE($3, vendor), amount_cents = COALESCE($4, amount_cents),
         cadence = COALESCE($5, cadence), source = COALESCE($6, source), started_on = COALESCE($7::date, started_on),
         ended_on = CASE WHEN $8::text = '' THEN NULL ELSE COALESCE($8::date, ended_on) END,
         external_ref = CASE WHEN $9::text = '' THEN NULL ELSE COALESCE($9, external_ref) END,
         notes = COALESCE($10, notes), updated_at = now()
       WHERE id = $1 RETURNING ${SUB_COLS}`,
      [id, patch.name?.trim() ?? null, patch.vendor?.trim() ?? null, patch.amountCents ?? null, patch.cadence ?? null, patch.source ?? null, patch.startedOn ?? null, patch.endedOn === null ? "" : (patch.endedOn ?? null), patch.externalRef === null ? "" : (patch.externalRef ?? null), patch.notes ?? null],
    );
    return row ?? null;
  } catch (e) {
    if (isUnique(e)) throw new DuplicateOverheadError(`that external_ref or (name, vendor, started_on)`);
    throw e;
  }
}

export async function endSubscription(run: Run, id: string, endedOn?: string): Promise<Subscription | null> {
  const [row] = await run<Subscription>(`UPDATE overhead_subscriptions SET ended_on = COALESCE($2::date, CURRENT_DATE), updated_at = now() WHERE id = $1 RETURNING ${SUB_COLS}`, [id, endedOn ?? null]);
  return row ?? null;
}

export async function deleteSubscription(run: Run, id: string): Promise<boolean> {
  const rows = await run(`DELETE FROM overhead_subscriptions WHERE id = $1 RETURNING id`, [id]);
  return rows.length === 1;
}

export interface MeteredChargeInput {
  provider: string;
  /** 'YYYY-MM' */
  period: string;
  amountCents: number;
  source?: ChargeSource;
  externalRef?: string | null;
  notes?: string;
}

export async function addMeteredCharge(run: Run, input: MeteredChargeInput): Promise<MeteredCharge> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new Error("period must be YYYY-MM");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) throw new Error("amountCents must be a non-negative integer (cents)");
  try {
    const [row] = await run<MeteredCharge>(
      `INSERT INTO metered_charges (provider, period, amount_cents, source, external_ref, notes)
       VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6) RETURNING ${CHG_COLS}`,
      [input.provider.trim(), input.period, input.amountCents, input.source ?? "owner_reported", input.externalRef ?? null, input.notes ?? ""],
    );
    return row;
  } catch (e) {
    if (isUnique(e)) throw new DuplicateOverheadError(`metered charge ${input.externalRef}`);
    throw e;
  }
}

export async function deleteMeteredCharge(run: Run, id: string): Promise<boolean> {
  const rows = await run(`DELETE FROM metered_charges WHERE id = $1 RETURNING id`, [id]);
  return rows.length === 1;
}

export async function listMeteredCharges(run: Run, opts: { period?: string; limit?: number } = {}): Promise<MeteredCharge[]> {
  return run<MeteredCharge>(`SELECT ${CHG_COLS} FROM metered_charges WHERE $1::text IS NULL OR period = $1 ORDER BY period DESC, provider LIMIT $2`, [opts.period ?? null, opts.limit ?? 200]);
}

// ── Summary ─────────────────────────────────────────────────────────────────

/** Monthly-equivalent cents for a subscription (yearly ÷ 12, rounded). */
export function monthlyEquivalentCents(amountCents: number, cadence: Cadence): number {
  return cadence === "yearly" ? Math.round(amountCents / 12) : amountCents;
}

/** True when the subscription is live during the month 'YYYY-MM'. */
export function activeInMonth(sub: Pick<Subscription, "started_on" | "ended_on">, month: string): boolean {
  const start = sub.started_on.slice(0, 7);
  const end = sub.ended_on ? sub.ended_on.slice(0, 7) : null;
  return start <= month && (end === null || end >= month);
}

export interface OverheadSummary {
  month: string;
  fixed: { monthly_cents: number; lines: (Subscription & { monthly_equivalent_cents: number })[] };
  metered: { cents: number; by_provider: { provider: string; cents: number; source: string[] }[]; unknown_providers: string[] };
  total_known_cents: number;
  alert: { threshold_cents: number | null; exceeded: boolean };
  caveats: string[];
}

export function currentMonth(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** Pure summary over rows already loaded. */
export function summarizeOverhead(subs: Subscription[], charges: MeteredCharge[], month: string, thresholdCents: number | null): OverheadSummary {
  const live = subs.filter((s) => activeInMonth(s, month)).map((s) => ({ ...s, monthly_equivalent_cents: monthlyEquivalentCents(s.amount_cents, s.cadence) }));
  const fixedCents = live.reduce((a, s) => a + s.monthly_equivalent_cents, 0);
  const byProv = new Map<string, { cents: number; source: Set<string> }>();
  for (const c of charges.filter((c) => c.period === month)) {
    const key = c.provider.toLowerCase();
    const cur = byProv.get(key) ?? { cents: 0, source: new Set<string>() };
    cur.cents += c.amount_cents;
    cur.source.add(c.source);
    byProv.set(key, cur);
  }
  const meteredCents = [...byProv.values()].reduce((a, v) => a + v.cents, 0);
  const subVendors = new Set(live.map((s) => s.vendor.toLowerCase()));
  const unknown = [...subVendors].filter((v) => !byProv.has(v)).sort();
  const total = fixedCents + meteredCents;
  const caveats = [
    "Fixed subscriptions and metered API charges are separate lines; a subscription does not include API credits.",
    ...live.filter((s) => s.source === "owner_reported").map((s) => `${s.name} (${s.vendor}) is owner-reported and not yet reconciled to a bill or QBO.`),
    ...(unknown.length ? [`Metered usage for ${unknown.join(", ")} this month is unknown (no charge recorded) — total is a floor.`] : []),
    ...(charges.some((c) => c.period === month && c.source === "estimate") ? ["At least one metered line is an estimate, not a bill."] : []),
  ];
  return {
    month,
    fixed: { monthly_cents: fixedCents, lines: live },
    metered: { cents: meteredCents, by_provider: [...byProv.entries()].map(([provider, v]) => ({ provider, cents: v.cents, source: [...v.source].sort() })).sort((a, b) => a.provider.localeCompare(b.provider)), unknown_providers: unknown },
    total_known_cents: total,
    alert: { threshold_cents: thresholdCents, exceeded: thresholdCents !== null && total > thresholdCents },
    caveats,
  };
}

export const ALERT_SETTING_KEY = "overhead.alert_monthly_cents";
const ALERT_LAST_KEY = "overhead.alert_last_notified_month";

export async function getAlertThreshold(run: Run): Promise<number | null> {
  const [row] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [ALERT_SETTING_KEY]);
  if (!row || row.value.trim() === "") return null;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function setAlertThreshold(run: Run, cents: number | null): Promise<void> {
  if (cents === null) {
    await run(`DELETE FROM app_settings WHERE key = $1`, [ALERT_SETTING_KEY]);
    return;
  }
  if (!Number.isInteger(cents) || cents < 0) throw new Error("threshold must be a non-negative integer (cents)");
  await run(`INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [ALERT_SETTING_KEY, String(cents)]);
}

export async function overheadSummary(run: Run, month = currentMonth()): Promise<OverheadSummary> {
  const subs = await listSubscriptions(run, { includeEnded: true });
  const charges = await listMeteredCharges(run, { limit: 1000 });
  const threshold = await getAlertThreshold(run);
  return summarizeOverhead(subs, charges, month, threshold);
}

/** Threshold check that ONLY notifies (a money notification, once per month).
 *  Never blocks a run, never pauses a lane. Returns whether it notified. */
export async function checkOverheadAlert(run: Run, month = currentMonth()): Promise<{ exceeded: boolean; notified: boolean; summary: OverheadSummary }> {
  const summary = await overheadSummary(run, month);
  if (!summary.alert.exceeded) return { exceeded: false, notified: false, summary };
  const [last] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [ALERT_LAST_KEY]);
  if (last?.value === month) return { exceeded: true, notified: false, summary };
  await run(
    `INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href)
     VALUES ('money', 'Overhead', 'money', 'money', $1, $2, 'Just now', true, '/settings/overhead')`,
    [`Overhead for ${month} is over the threshold`, `$${(summary.total_known_cents / 100).toFixed(2)} known so far against $${((summary.alert.threshold_cents ?? 0) / 100).toFixed(2)}. Notification only — nothing was paused.`],
  );
  await run(`INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [ALERT_LAST_KEY, month]);
  return { exceeded: true, notified: true, summary };
}

// ── Reconciliation proposal ─────────────────────────────────────────────────

export interface ReconcileLine {
  subscription: Subscription;
  status: "matched" | "no_external_ref" | "unmatched";
  /** Expenses whose source_ref equals the subscription's external_ref — the only automatic match. */
  matches: { id: string; expense_date: string; vendor_label: string; amount_cents: number; source_ref: string }[];
  /** Same-vendor expenses shown for the owner to link by hand; NEVER auto-linked — amount is not identity. */
  candidates: { id: string; expense_date: string; vendor_label: string; amount_cents: number; source_ref: string }[];
  note: string;
}

export async function reconcileWithExpenses(run: Run, opts: { sinceDate?: string } = {}): Promise<{ lines: ReconcileLine[]; caveat: string }> {
  const subs = await listSubscriptions(run, { includeEnded: false });
  const lines: ReconcileLine[] = [];
  for (const s of subs) {
    const matches = s.external_ref
      ? await run<ReconcileLine["matches"][number]>(
          `SELECT id::text AS id, expense_date::text AS expense_date, vendor_label, amount_cents, source_ref FROM expenses WHERE source_ref = $1 ORDER BY expense_date DESC LIMIT 24`,
          [s.external_ref],
        )
      : [];
    const candidates = await run<ReconcileLine["candidates"][number]>(
      `SELECT id::text AS id, expense_date::text AS expense_date, vendor_label, amount_cents, source_ref FROM expenses
        WHERE lower(vendor_label) LIKE '%' || lower($1) || '%' AND ($2::date IS NULL OR expense_date >= $2)
          AND ($3::text IS NULL OR source_ref <> $3)
        ORDER BY expense_date DESC LIMIT 12`,
      [s.vendor, opts.sinceDate ?? null, s.external_ref],
    );
    const status: ReconcileLine["status"] = !s.external_ref ? "no_external_ref" : matches.length ? "matched" : "unmatched";
    lines.push({
      subscription: s,
      status,
      matches,
      candidates,
      note:
        status === "matched"
          ? `Linked by external_ref ${s.external_ref}; ${matches.length} expense(s) share that ref — not double-counted.`
          : status === "no_external_ref"
            ? `Owner-reported only. Set external_ref from the bill or QBO to reconcile; ${candidates.length} same-vendor expense(s) shown for hand review (amount is not identity).`
            : `external_ref ${s.external_ref} has no matching expense yet; nothing auto-linked.`,
    });
  }
  return { lines, caveat: "Automatic matching uses external_ref only. Same-vendor candidates are informational; the owner links them. Nothing is deduped on amount." };
}
