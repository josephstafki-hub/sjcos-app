// The staged draft on a work item that's waiting for approval, shaped for the
// places Joe approves it away from the card: the Telegram push and the
// corner popup. Same draft + record lookup lib/approved-draft-send.ts sends
// from, and the same rule (planApprovedSend) for whether Approve emails it —
// so "Approve & send" is only offered when Approve really sends.

import { query } from "./db";
import { parseEmailDraft, planApprovedSend } from "./approved-draft-rules";

export interface WorkItemDraftPreview {
  id: string;
  title: string;
  createdAt: string;
  /** Present when the draft is an email ("To:/Subject:" header block). */
  to: string | null;
  subject: string | null;
  body: string | null;
  /** Approve sends it (To: is this item's lead / project client). */
  sends: boolean;
  /** Why Approve won't email it, when it's an email that won't go. */
  note: string | null;
  href: string;
}

interface Row {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  lead_slug: string | null;
  lead_email: string | null;
  project_slug: string | null;
  project_email: string | null;
  content: string | null;
}

export async function workItemDraftPreviews(opts: { ids?: string[]; limit?: number } = {}): Promise<WorkItemDraftPreview[]> {
  const { rows } = await query<Row>(
    `SELECT w.id, w.title, w.body,
            to_char(w.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
            l.slug AS lead_slug, l.email AS lead_email, p.slug AS project_slug,
            NULLIF(COALESCE(NULLIF(p.client_email, ''), pl.email), '') AS project_email,
            k.content
       FROM work_items w
       LEFT JOIN leads l ON l.id = w.lead_id
       LEFT JOIN projects p ON p.id = w.project_id
       LEFT JOIN leads pl ON pl.id = p.lead_id
       LEFT JOIN LATERAL (
         SELECT uri FROM agent_receipts
          WHERE work_item_id = w.id AND receipt_kind = 'draft' AND uri LIKE 'knowledge_items/%'
          ORDER BY created_at DESC LIMIT 1
       ) r ON true
       LEFT JOIN knowledge_items k ON 'knowledge_items/' || k.id::text = r.uri
      WHERE ($1::uuid[] IS NULL OR w.id = ANY($1::uuid[]))
        AND w.approval_status = 'requested'
        AND w.status NOT IN ('done', 'cancelled')
        AND w.archived_at IS NULL
        AND (w.snoozed_until IS NULL OR w.snoozed_until <= now())
      ORDER BY w.updated_at DESC
      LIMIT $2`,
    [opts.ids?.length ? opts.ids : null, opts.limit ?? 20],
  );
  return rows.map((r) => {
    const draft = r.content ? parseEmailDraft(r.content) : null;
    const record = r.lead_slug ? { kind: "lead" as const, email: r.lead_email } : r.project_slug ? { kind: "project" as const, email: r.project_email } : null;
    const plan = planApprovedSend({ record, draft: r.content });
    return {
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      to: draft?.to ?? null,
      subject: draft?.subject || null,
      body: draft?.body ?? (r.content ? r.content.slice(0, 2000) : r.body?.slice(0, 600) ?? null),
      sends: plan.outcome === "send",
      note: plan.outcome === "send" ? null : plan.outcome === "failed" ? plan.error : draft ? plan.reason : null,
      href: r.lead_slug ? `/leads/${r.lead_slug}` : r.project_slug ? `/projects/${r.project_slug}` : "/today",
    };
  });
}
