// Email-backed to-dos (A01). An email that needs something from Joe becomes a
// work item tied to an obligation keyed on the Gmail message (and thread), so:
//   - the same email filed twice (Hermes re-reading the inbox) is one to-do;
//   - when a reply goes out on that thread, the obligation resolves
//     (handleReply) and its to-do completes with that as evidence.
// Before this, Hermes filed email to-dos as plain work items with no message
// identity, so duplicates piled up and nothing closed them when Joe replied.
//
// Pure: `run(sql, params)` only. Callers: MCP create_work_item (email given)
// and the lead-thread sync pass (settleEmailReplies over the threads it read).

import type { Run } from "../commands/core.ts";
import { completeWorkItem } from "../completion/complete.ts";
import { createOrTouchObligation, handleReply, type Obligation } from "./core.ts";

export interface EmailRef {
  messageId: string;
  threadId?: string | null;
  from?: string | null;
  receivedAt?: string | null;
}

export interface EmailWorkItemInput {
  email: EmailRef;
  title: string;
  body?: string;
  priority?: string;
  projectId?: string | null;
  leadId?: string | null;
  requiresApproval?: boolean;
  createdBy?: string;
}

/** The obligation for one email, and the open to-do already filed for it
 *  (if any). Callers that build their own work-item row use this. */
export async function prepareEmailWorkItem(run: Run, input: Pick<EmailWorkItemInput, "email" | "title" | "projectId" | "leadId" | "createdBy">): Promise<{ existingId: string | null; obligationId: string }> {
  const msg = input.email.messageId.trim();
  const [existing] = await run<{ id: string; obligation_id: string | null }>(
    `SELECT id, obligation_id FROM work_items WHERE source_kind = 'email' AND source_id = $1 AND status NOT IN ('done','cancelled') LIMIT 1`,
    [msg],
  );
  const ob = await createOrTouchObligation(run, {
    source: { provider: "gmail", threadId: input.email.threadId ?? null, messageId: msg, role: "origin", occurredAt: input.email.receivedAt ?? null, summary: input.email.from ? `from ${input.email.from}` : null },
    kind: "reply",
    title: input.title.slice(0, 300),
    leadId: input.leadId ?? null,
    projectId: input.projectId ?? null,
    createdBy: input.createdBy ?? "agent",
  });
  return { existingId: existing?.id ?? null, obligationId: existing?.obligation_id ?? ob.obligation.id };
}

/** File (or find) the to-do for one email. Returns the existing open to-do
 *  when this message was already filed. */
export async function fileEmailWorkItem(run: Run, input: EmailWorkItemInput): Promise<{ id: string; duplicate: boolean; obligationId: string }> {
  const prep = await prepareEmailWorkItem(run, input);
  if (prep.existingId) return { id: prep.existingId, duplicate: true, obligationId: prep.obligationId };
  const [row] = await run<{ id: string }>(
    `INSERT INTO work_items (title, body, priority, assignee_kind, project_id, lead_id, requires_approval, source_kind, source_id, obligation_id, created_by)
     VALUES ($1, $2, $3, 'human', $4, $5, $6, 'email', $7, $8, $9) RETURNING id`,
    [input.title, input.body ?? "", input.priority ?? "normal", input.projectId ?? null, input.leadId ?? null, input.requiresApproval ?? false, input.email.messageId.trim(), prep.obligationId, input.createdBy ?? "agent"],
  );
  return { id: row.id, duplicate: false, obligationId: prep.obligationId };
}

/** For threads just read from Gmail: the latest message on a thread with an
 *  open email obligation settles it (our reply resolves a 'reply'; theirs
 *  resolves a 'waiting'), and the obligation's open to-dos complete with that
 *  as the evidence. Idempotent: a settled obligation is skipped next time. */
export async function settleEmailReplies(
  run: Run,
  threads: { id: string; outbound: boolean; date: number }[],
  by: string,
): Promise<{ resolved: number; closedItems: number }> {
  if (!threads.length) return { resolved: 0, closedItems: 0 };
  const open = await run<{ thread_id: string }>(
    `SELECT DISTINCT os.thread_id FROM obligation_sources os JOIN obligations o ON o.id = os.obligation_id
      WHERE os.provider = 'gmail' AND os.thread_id = ANY($1::text[]) AND o.status NOT IN ('done','cancelled')`,
    [threads.map((t) => t.id)],
  );
  const withOpen = new Set(open.map((o) => o.thread_id));
  let resolved = 0;
  let closedItems = 0;
  for (const t of threads) {
    if (!withOpen.has(t.id)) continue;
    const out = await handleReply(run, { reply: { provider: "gmail", threadId: t.id, occurredAt: new Date(t.date), role: "reply" }, direction: t.outbound ? "outbound" : "inbound", by });
    for (const ob of out.resolved as Obligation[]) {
      resolved++;
      const items = await run<{ id: string }>(`SELECT id FROM work_items WHERE obligation_id = $1 AND status NOT IN ('done','cancelled')`, [ob.id]);
      for (const it of items) {
        const r = await completeWorkItem(run, { workItemId: it.id, principal: { kind: "service", name: by }, evidence: { kind: "business_response", obligation_id: ob.id, label: t.outbound ? "Replied by email" : "They answered by email" } });
        if (r.ok && !r.alreadyDone) closedItems++;
      }
    }
  }
  return { resolved, closedItems };
}
