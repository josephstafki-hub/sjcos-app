"use server";

import { revalidatePath } from "next/cache";
import { requireAccess, requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { query, queryOne } from "@/lib/db";
import { maybeAdvanceRunbook } from "@/lib/runbook-engine";
import { emit } from "@/lib/notify";
import {
  openWorkItemsSql,
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
  await requireAccess("today");
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
  const user = await requireAccess("today");
  if (!(await mayWorkItem(user, workItemId))) return { completed: false, next: null };

  const { rows } = await query<{ status: string }>(
    `SELECT status FROM work_items WHERE id = $1`,
    [workItemId],
  );
  const status = rows[0]?.status;
  if (!status || !["done", "cancelled"].includes(status)) {
    return { completed: false, next: null };
  }

  // promoted_at is the owner's 5-slot rail (db/schema.sql). A staff member's
  // rail is just the top of their own backlog, so there is no slot to backfill
  // and nothing of Joe's to write.
  if (user.role !== "owner") return { completed: true, next: null };

  const backlog = openWorkItemsSql(user);
  const { rows: nextRows } = await query<TodayWorkItemRow>(
    `${backlog.sql}
       AND w.promoted_at IS NULL
       AND (w.snoozed_until IS NULL OR w.snoozed_until <= now())${OPEN_WORK_ITEMS_ORDER_SQL} LIMIT 1`,
    backlog.params,
  );
  const nextRow = nextRows[0];
  if (!nextRow) return { completed: true, next: null };

  await query(`UPDATE work_items SET promoted_at = now() WHERE id = $1`, [nextRow.id]);
  return { completed: true, next: workItemCandidate(nextRow) };
}

/** May this person act on this to-do at all? The owner may act on any; a staff
 *  member only on one assigned to them. Without this a card id lifted from
 *  someone else's queue would let a team member close Joe's work — the ids
 *  arrive from the client, so the check has to be here and not just in the
 *  query that built the card. */
async function mayWorkItem(
  user: { id: string; role: string },
  workItemId: string,
): Promise<boolean> {
  if (user.role === "owner") return true;
  const row = await queryOne<{ one: number }>(
    `SELECT 1 AS one FROM work_items WHERE id = $1 AND assigned_user_id = $2`,
    [workItemId, user.id],
  );
  return Boolean(row);
}

// ─── Today feed chip actions (Phase 2) ───────────────────────────────────────
// These back the deterministic, app-rendered chips on the Today feed cards.
// Each returns the fresh queue via getQueueSnapshot() (buildQueue is the single
// source of ranking/promotion truth), so the client can swap both lists in one
// state update. Owner-only, and the mutations are idempotent so a double-click
// or a concurrent completion elsewhere can't corrupt anything.

/** Re-read the live Priorities + Waiting queue (no schedule/brief/header). */
export async function refreshTodayQueue(): Promise<QueueSnapshot> {
  return getQueueSnapshot(await requireAccess("today"));
}

/** Owner clicked "Mark done" on a card. Marks the work_item done and returns
 *  the fresh queue (the freed slot backfills inside getQueueSnapshot). Skips
 *  the write if the item is already done/cancelled. */
export async function completeTodayItem(workItemId: string): Promise<QueueSnapshot> {
  const user = await requireAccess("today");
  if (!(await mayWorkItem(user, workItemId))) return getQueueSnapshot(user);
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
  return getQueueSnapshot(user);
}

/** Owner clicked "Snooze 3d". Pushes due_at out, sets snoozed_until so the
 *  item is excluded from auto-promotion until the window passes, and demotes
 *  it (promoted_at = NULL) so it drops back to Waiting on me; the freed slot
 *  backfills from the rest of the backlog. No-op write if the item is already
 *  done/cancelled. */
export async function snoozeTodayItem(workItemId: string, days = 3): Promise<QueueSnapshot> {
  const user = await requireAccess("today");
  if (!(await mayWorkItem(user, workItemId))) return getQueueSnapshot(user);
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
  return getQueueSnapshot(user);
}

// ─── Assignment (owner only) ─────────────────────────────────────────────────

/** Hand a to-do to a team member, or take it back (userId null = the owner's
 *  own). Owner-only by requireRole, not requireAccess: holding the Today area
 *  lets you work your queue, never re-deal someone else's (Joe, 2026-09-27 —
 *  "my account will be the one that is able to do that").
 *
 *  The card stays on Joe's Today either way; what changes is whose Today it
 *  ALSO appears on, and the "Assigned to <name>" line. The assignee gets a
 *  notification addressed to them so a hand-off isn't silent. */
export async function assignTodayItem(
  workItemId: string,
  userId: string | null,
): Promise<QueueSnapshot> {
  const owner = await requireRole("owner");

  // Only an active internal login can hold a to-do — never a sub or client
  // portal account, and never a deactivated one.
  if (userId) {
    const ok = await queryOne<{ name: string }>(
      `SELECT name FROM users WHERE id = $1 AND active AND role IN ('owner','staff')`,
      [userId],
    );
    if (!ok) return getQueueSnapshot(owner);
  }

  const row = await queryOne<{ title: string; assigned_user_id: string | null }>(
    `SELECT title, assigned_user_id FROM work_items WHERE id = $1`,
    [workItemId],
  );
  if (!row) return getQueueSnapshot(owner);

  // Storing the owner's own id would work, but NULL is what every other writer
  // (detectors, MCP, runbooks) leaves behind for "Joe's", so keep one spelling.
  const next = userId && userId !== owner.id ? userId : null;
  if (next === row.assigned_user_id) return getQueueSnapshot(owner);

  await query(
    `UPDATE work_items SET assigned_user_id = $2, updated_at = now() WHERE id = $1`,
    [workItemId, next],
  );

  if (next) {
    await emit({
      kind: "job",
      tag: "Assigned",
      accent: "accent",
      icon: "star",
      title: `Joe assigned you: ${row.title}`,
      subline: "It's on your Today now.",
      href: "/today",
      audienceUserId: next,
    });
  }

  revalidatePath("/today");
  revalidatePath("/engine");
  return getQueueSnapshot(owner);
}
