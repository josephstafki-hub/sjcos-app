"use server";

// Owner-only overhead writes (A18). Reads and the math live in overhead.ts.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { withMeasureTx } from "@/lib/measure/server";
import {
  addMeteredCharge,
  addSubscription,
  deleteMeteredCharge,
  deleteSubscription,
  endSubscription,
  setAlertThreshold,
  updateSubscription,
  type Cadence,
  type ChargeSource,
  type SubscriptionSource,
} from "@/lib/overhead/overhead";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/settings/overhead");
  revalidatePath("/engine/measure");
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Dollars typed by the owner → integer cents. Refuses blanks and negatives. */
function toCents(dollars: string): number {
  const n = Number(String(dollars).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a dollar amount (0 or more).");
  return Math.round(n * 100);
}

export async function addSubscriptionAction(input: { name: string; vendor: string; amountDollars: string; cadence: Cadence; source: SubscriptionSource; startedOn?: string; externalRef?: string; notes?: string }): Promise<Result> {
  await requireRole("owner");
  try {
    const row = await withMeasureTx((run) =>
      addSubscription(run, { name: input.name, vendor: input.vendor, amountCents: toCents(input.amountDollars), cadence: input.cadence, source: input.source, startedOn: input.startedOn || undefined, externalRef: input.externalRef?.trim() || null, notes: input.notes ?? "" }),
    );
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function updateSubscriptionAction(id: string, patch: { name?: string; vendor?: string; amountDollars?: string; cadence?: Cadence; source?: SubscriptionSource; startedOn?: string; endedOn?: string | null; externalRef?: string | null; notes?: string }): Promise<Result> {
  await requireRole("owner");
  try {
    const row = await withMeasureTx((run) =>
      updateSubscription(run, id, {
        ...patch,
        amountCents: patch.amountDollars !== undefined ? toCents(patch.amountDollars) : undefined,
        externalRef: patch.externalRef === undefined ? undefined : (patch.externalRef?.trim() || null),
      }),
    );
    if (!row) return { ok: false, error: "That subscription no longer exists." };
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function endSubscriptionAction(id: string, endedOn?: string): Promise<Result> {
  await requireRole("owner");
  try {
    const row = await withMeasureTx((run) => endSubscription(run, id, endedOn));
    if (!row) return { ok: false, error: "That subscription no longer exists." };
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function deleteSubscriptionAction(id: string): Promise<Result> {
  await requireRole("owner");
  try {
    const ok = await withMeasureTx((run) => deleteSubscription(run, id));
    if (!ok) return { ok: false, error: "That subscription no longer exists." };
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function addMeteredChargeAction(input: { provider: string; period: string; amountDollars: string; source: ChargeSource; externalRef?: string; notes?: string }): Promise<Result> {
  await requireRole("owner");
  try {
    const row = await withMeasureTx((run) => addMeteredCharge(run, { provider: input.provider, period: input.period, amountCents: toCents(input.amountDollars), source: input.source, externalRef: input.externalRef?.trim() || null, notes: input.notes ?? "" }));
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function deleteMeteredChargeAction(id: string): Promise<Result> {
  await requireRole("owner");
  try {
    const ok = await withMeasureTx((run) => deleteMeteredCharge(run, id));
    if (!ok) return { ok: false, error: "That charge no longer exists." };
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setAlertThresholdAction(dollars: string): Promise<Result> {
  await requireRole("owner");
  try {
    const cents = dollars.trim() === "" ? null : toCents(dollars);
    await withMeasureTx((run) => setAlertThreshold(run, cents));
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
