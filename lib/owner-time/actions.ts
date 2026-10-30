"use server";

// Owner-only server actions behind /time (A19). Thin: every rule lives in
// lib/owner-time/*; these resolve the session, key the event and revalidate.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { timerAction, type TimerActionBody } from "./server";
import { userPrincipal, withTransaction } from "@/lib/commands/db";
import { resolveDecision, stageDecision } from "@/lib/commands/decisions";
import { setOwnerLaborRate } from "./costing";

type Result = { ok: true; info?: string } | { ok: false; error: string };

async function run(body: TimerActionBody): Promise<Result> {
  const user = await requireRole("owner");
  const r = await timerAction({ id: user.id, name: user.name }, body);
  revalidatePath("/time");
  if (!r.ok) return r;
  return { ok: true, info: r.applied ? undefined : "Already recorded (replayed event)." };
}

export async function startTimerAction(projectId: string | null, category: "site" | "design" | "estimating" | "admin" | "other", note: string): Promise<Result> {
  return run({ action: "start", projectId: projectId || null, category, note: note || undefined, deviceId: "web" });
}
export async function stopTimerAction(): Promise<Result> {
  return run({ action: "stop" });
}
export async function confirmClockInAction(intervalId: string, projectId: string | null): Promise<Result> {
  return run({ action: "confirm_clock_in", intervalId, projectId });
}
export async function clockOutAction(intervalId: string, acceptSuggested: boolean): Promise<Result> {
  return run({ action: "clock_out", intervalId, acceptSuggested });
}
export async function correctIntervalAction(intervalId: string, patch: { startAt?: string; endAt?: string | null; projectId?: string | null; category?: "site" | "design" | "estimating" | "admin" | "other"; state?: "confirmed" | "discarded"; note?: string }): Promise<Result> {
  return run({ action: "correct", intervalId, ...patch });
}

/** Joe sets his own labour rate for a kind of work, from a date (A19). It
 *  values his verified hours on a job's costs; it never bills anyone. The
 *  rate is a dated assumption he approved, so it goes through an owner_rate
 *  decision (his own, approved at once) and setOwnerLaborRate. */
export async function setLaborRateAction(category: "site" | "design" | "estimating" | "admin" | "other", dollarsPerHour: string, effectiveFrom: string): Promise<Result> {
  const user = await requireRole("owner");
  const rateCents = Math.round(Number(String(dollarsPerHour).replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(rateCents) || rateCents <= 0) return { ok: false, error: "Enter the rate in dollars per hour." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return { ok: false, error: "Pick the date the rate starts." };
  const principal = userPrincipal(user);
  const r = await withTransaction(async (run) => {
    const { decision } = await stageDecision(run, {
      kind: "owner_rate",
      action: "set_owner_rate",
      title: `${category} rate $${(rateCents / 100).toFixed(2)}/h from ${effectiveFrom}`,
      summary: { effect: "Values Joe's verified hours on job costs from this date. Bills nobody." },
      targetKind: "owner_rate",
      targetId: `${category}:${effectiveFrom}`,
      amountCents: rateCents,
      content: { category, rateCents, effectiveFrom },
      dedupeKey: `owner_rate:${category}:${effectiveFrom}`,
      requestedBy: principal,
    });
    const res = await resolveDecision(run, { id: decision.id, outcome: "approved", principal, via: "app" });
    if (!res.ok && res.code !== "already_resolved") return { ok: false as const, error: res.reason };
    return setOwnerLaborRate(run, { category, rateCents, effectiveFrom, decisionId: decision.id, approvedBy: user.id, note: "set on /time" });
  });
  revalidatePath("/time");
  return r.ok ? { ok: true, info: `${category} rate saved.` } : { ok: false, error: "reason" in r ? r.reason : r.error };
}
