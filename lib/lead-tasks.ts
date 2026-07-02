import "server-only";

// Lead follow-up tasks (Phase-7 lead-intake epic). A real per-lead checklist —
// "call back", "send measurement request", "chase the other-bids answer". Read
// here for the Tasks tab; written by lib/actions/lead-tasks.ts.
// Server-only (imports lib/db → pg); never import a VALUE from here into a
// client component (types are fine via `import type`).

import { query } from "./db";

export interface LeadTask {
  id: number;
  title: string;
  done: boolean;
  /** ISO date (YYYY-MM-DD) or null. */
  dueDate: string | null;
}

interface Row {
  id: number;
  title: string;
  done: boolean;
  due_date: string | null;
}

/** A lead's tasks: open first (soonest due first), then completed. */
export async function getLeadTasks(slug: string): Promise<LeadTask[]> {
  const { rows } = await query<Row>(
    `SELECT t.id, t.title, t.done, to_char(t.due_date, 'YYYY-MM-DD') AS due_date
       FROM lead_tasks t JOIN leads l ON l.id = t.lead_id
      WHERE l.slug = $1
      ORDER BY t.done, t.due_date NULLS LAST, t.sort_order, t.id`,
    [slug],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, done: r.done, dueDate: r.due_date }));
}
