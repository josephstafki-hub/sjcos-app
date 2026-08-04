"use server";

import { requireUser } from "@/lib/dal";
import { getLiveChanges, type LiveChanges } from "@/lib/live";

/** Poll target for components/shell/LiveUpdates.tsx — the cheap "did anything
 *  change since my cursor" read (one MAX(id) on app_change_log). Any signed-in
 *  role may ask; the answer carries no row data, just table names. */
export async function pollLiveChanges(since: number | null): Promise<LiveChanges> {
  await requireUser();
  return getLiveChanges(since);
}
