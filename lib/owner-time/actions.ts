"use server";

// Owner-only server actions behind /time (A19). Thin: every rule lives in
// lib/owner-time/*; these resolve the session, key the event and revalidate.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { timerAction, type TimerActionBody } from "./server";

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
