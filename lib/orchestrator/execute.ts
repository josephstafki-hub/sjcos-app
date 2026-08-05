import "server-only";

import { query, queryOne } from "@/lib/db";
import type { PendingProposal } from "./proposals";

// The whitelisted executors behind approved Qwen proposals. Plain library
// functions doing direct query() calls — deliberately NOT the "use server"
// actions: those call requireRole(), which reads request cookies, and these
// run inside a post-response background continuation where no request context
// can be trusted to exist. Auth was enforced at the sendMessageAction entry;
// Claude approval is the second gate. Every write mirrors the SQL of its
// owner-facing action (lib/actions/today.ts) so behavior can't drift, and
// query() bumps app_change_log so the live view refreshes on its own.

export interface ExecuteResult {
  ok: boolean;
  /** One human line for the transcript ("Marked done: Order the vanity"). */
  summary: string;
  entityKind: string;
  entityId: string | null;
}

async function workItemTitle(id: string): Promise<string | null> {
  const row = await queryOne<{ title: string }>(`SELECT title FROM work_items WHERE id = $1`, [id]);
  return row?.title ?? null;
}

export async function executeProposal(p: PendingProposal): Promise<ExecuteResult> {
  try {
    switch (p.kind) {
      case "mark_done": {
        const id = p.payload.work_item_id as string;
        const title = await workItemTitle(id);
        if (!title) return { ok: false, summary: "Work item not found.", entityKind: "work_item", entityId: id };
        await query(
          `UPDATE work_items SET status = 'done', completed_at = now(), updated_at = now()
            WHERE id = $1 AND status NOT IN ('done','cancelled')`,
          [id],
        );
        return { ok: true, summary: `Marked done: ${title}`, entityKind: "work_item", entityId: id };
      }
      case "snooze": {
        const id = p.payload.work_item_id as string;
        const days = Math.min(30, Math.max(1, Math.round(Number(p.payload.days ?? 3))));
        const title = await workItemTitle(id);
        if (!title) return { ok: false, summary: "Work item not found.", entityKind: "work_item", entityId: id };
        await query(
          `UPDATE work_items
              SET due_at = GREATEST(now(), COALESCE(due_at, now())) + make_interval(days => $2),
                  snoozed_until = now() + make_interval(days => $2),
                  promoted_at = NULL,
                  updated_at = now()
            WHERE id = $1 AND status NOT IN ('done','cancelled')`,
          [id, days],
        );
        return { ok: true, summary: `Snoozed ${days}d: ${title}`, entityKind: "work_item", entityId: id };
      }
      case "update_status": {
        const id = p.payload.work_item_id as string;
        const status = p.payload.status as string;
        const title = await workItemTitle(id);
        if (!title) return { ok: false, summary: "Work item not found.", entityKind: "work_item", entityId: id };
        await query(
          `UPDATE work_items SET status = $2, updated_at = now(),
                  completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END
            WHERE id = $1 AND status NOT IN ('done','cancelled')`,
          [id, status],
        );
        return { ok: true, summary: `Status → ${status}: ${title}`, entityKind: "work_item", entityId: id };
      }
      case "create_work_item": {
        const title = p.payload.title as string;
        const body = (p.payload.body as string | undefined) ?? "";
        const row = await queryOne<{ id: string }>(
          `INSERT INTO work_items (title, body, source_kind, created_by)
           VALUES ($1, $2, 'agent', 'qwen-proposal') RETURNING id`,
          [title, body],
        );
        return { ok: true, summary: `Created work item: ${title}`, entityKind: "work_item", entityId: row?.id ?? null };
      }
      case "capture_knowledge": {
        const content = p.payload.content as string;
        const kind = (p.payload.kind as string | undefined) ?? "note";
        const row = await queryOne<{ id: string }>(
          `INSERT INTO knowledge_items (content, kind, source, created_by)
           VALUES ($1, $2, 'agent', 'qwen-proposal') RETURNING id`,
          [content, kind],
        );
        return { ok: true, summary: `Captured knowledge (${kind})`, entityKind: "knowledge_item", entityId: row?.id ?? null };
      }
      default:
        return { ok: false, summary: `Unknown proposal kind.`, entityKind: "", entityId: null };
    }
  } catch (err) {
    return {
      ok: false,
      summary: `Failed: ${(err as Error).message}`,
      entityKind: p.entityKind,
      entityId: (p.payload.work_item_id as string | undefined) ?? null,
    };
  }
}
