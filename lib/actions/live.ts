"use server";

import { getCurrentUser } from "@/lib/dal";
import type { BackgroundFailure } from "@/lib/background-result";
import { getLiveChanges, type LiveChanges } from "@/lib/live";

/** Poll target for components/shell/LiveUpdates.tsx — the cheap "did anything
 *  change since my cursor" read (one MAX(id) on app_change_log). Any signed-in
 *  role may ask; the answer carries no row data, just table names. */
export async function pollLiveChanges(since: number | null): Promise<LiveChanges | BackgroundFailure> {
  if (!await getCurrentUser()) return { ok: false, code: "SIGN_IN_AGAIN" };
  return getLiveChanges(since);
}
