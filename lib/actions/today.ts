"use server";

import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { query, queryOne } from "@/lib/db";
import { maybeAdvanceRunbook } from "@/lib/runbook-engine";
import {
  OPEN_WORK_ITEMS_SQL,
  OPEN_WORK_ITEMS_ORDER_SQL,
  workItemCandidate,
  getQueueSnapshot,
  type TodayPriority,
  type TodayWorkItemRow,
  type QueueSnapshot,
} from "@/lib/today";

/** Ask the AI to re-rank today's priorities. Returns the given titles in the
 *  model's recommended order. Robust to free-form replies (we extract the item
 *  numbers); degrades to the original order if the model gives nothing usable
 *  (e.g. the mock provider), so the button is always safe to press. */
export async function reprioritizeToday(titles: string[]): Promise<string[]> {
  await requireRole("owner");
  if (titles.length <= 1) return titles;

  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  try {
    const { suggestions } = await ai.suggest({
      kind: "reprioritize",
      context:
        `These are today's tasks for a remodeling business owner. Re-rank ` +
        `them by urgency and impact, most important first. Reply with just ` +
        `the item numbers in the new order, e.g. "3, 1, 2".\n\n${numbered}`,
    });
    const order: number[] = [];
    for (const m of suggestions.join(" ").matchAll(/\d+/g)) {
      const idx = Number(m[0]) - 1;
      if (idx >= 0 && idx < titles.length && !order.includes(idx)) order.push(idx);
    }
    for (let i = 0; i < titles.length; i++) if (!order.includes(i)) order.push(i);
    return order.map((i) => titles[i]);
  } catch {
    return titles;
  }
}

export interface PrioritySwapResult {
  /** True once the clicked work item's status is actually done/cancelled
   *  (it may have been closed elsewhere — by Hermes, or on its own detail
   *  page — since the card was last rendered). */
  completed: boolean;
  /** The next-ranked backlog item promoted to fill the freed slot, or null
   *  if the item isn't done yet, or the backlog is empty. */
  next: Omit<TodayPriority, "rank"> | null;
}

/** Called when a Priorities card is clicked. If the underlying work item is
 *  actually done/cancelled, promotes the next unpromoted backlog item (marks
 *  it "read" via promoted_at) so the freed slot can be filled without a full
 *  page reload. If the item isn't done yet, the caller should just navigate
 *  to its href as normal. */
export async function checkPriorityCompletion(workItemId: string): Promise<PrioritySwapResult> {
  await requireRole("owner");

  const { rows } = await query<{ status: string }>(
    `SELECT status FROM work_items WHERE id = $1`,
    [workItemId],
  );
  const status = rows[0]?.status;
  if (!status || !["done", "cancelled"].includes(status)) {
    return { completed: false, next: null };
  }

  const { rows: nextRows } = await query<TodayWorkItemRow>(
    `${OPEN_WORK_ITEMS_SQL}
       AND w.promoted_at IS NULL
       AND (w.snoozed_until IS NULL OR w.snoozed_until <= now())${OPEN_WORK_ITEMS_ORDER_SQL} LIMIT 1`,
  );
  const nextRow = nextRows[0];
  if (!nextRow) return { completed: true, next: null };

  await query(`UPDATE work_items SET promoted_at = now() WHERE id = $1`, [nextRow.id]);
  return { completed: true, next: workItemCandidate(nextRow) };
}

// ─── Today feed chip actions (Phase 2) ───────────────────────────────────────
// These back the deterministic, app-rendered chips on the Today feed cards.
// Each returns the fresh queue via getQueueSnapshot() (buildQueue is the single
// source of ranking/promotion truth), so the client can swap both lists in one
// state update. Owner-only, and the mutations are idempotent so a double-click
// or a concurrent completion elsewhere can't corrupt anything.

/** Re-read the live Priorities + Waiting queue (no schedule/brief/header). */
export async function refreshTodayQueue(): Promise<QueueSnapshot> {
  await requireRole("owner");
  return getQueueSnapshot();
}

/** Owner clicked "Mark done" on a card. Marks the work_item done and returns
 *  the fresh queue (the freed slot backfills inside getQueueSnapshot). Skips
 *  the write if the item is already done/cancelled. */
export async function completeTodayItem(workItemId: string): Promise<QueueSnapshot> {
  await requireRole("owner");
  const cur = await queryOne<{ status: string }>(
    `SELECT status FROM work_items WHERE id = $1`,
    [workItemId],
  );
  if (cur && !["done", "cancelled"].includes(cur.status)) {
    await query(
      `UPDATE work_items SET status = 'done', completed_at = now(), updated_at = now()
        WHERE id = $1 AND status NOT IN ('done','cancelled')`,
      [workItemId],
    );
    await maybeAdvanceRunbook(workItemId); // W6: no-op unless this is a runbook step
  }
  return getQueueSnapshot();
}

/** Owner clicked "Snooze 3d". Pushes due_at out, sets snoozed_until so the
 *  item is excluded from auto-promotion until the window passes, and demotes
 *  it (promoted_at = NULL) so it drops back to Waiting on me; the freed slot
 *  backfills from the rest of the backlog. No-op write if the item is already
 *  done/cancelled. */
export async function snoozeTodayItem(workItemId: string, days = 3): Promise<QueueSnapshot> {
  await requireRole("owner");
  const n = Math.min(30, Math.max(1, Math.round(days)));
  await query(
    `UPDATE work_items
        SET due_at = GREATEST(now(), COALESCE(due_at, now())) + make_interval(days => $2),
            snoozed_until = now() + make_interval(days => $2),
            promoted_at = NULL,
            updated_at = now()
      WHERE id = $1 AND status NOT IN ('done','cancelled')`,
    [workItemId, n],
  );
  return getQueueSnapshot();
}
