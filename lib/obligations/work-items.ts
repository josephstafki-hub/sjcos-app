// Protected source refresh for work items (A01). Every source-driven filer —
// the inbox scan (scripts/upsert-inbox-work-items.mjs), comms (fileCommsWorkItem
// in lib/comms-shared.ts) and the detectors (lib/detectors.ts) — files through
// refreshSourcedWorkItem so the rules live in one place:
//
//   • identity is (source_kind, source_id) + the provider message id, never
//     the title: a same-title source with a different stable id is a separate
//     item;
//   • a NEW provider message id on a thread that already has an item is NEW
//     work (a new promise), even if the old item is still open;
//   • a replay of a source whose item is done/cancelled does NOT resurrect it
//     (no message id = no new promise) and does not create a twin;
//   • a refresh of an open item touches ONLY source facts: body/title while
//     no agent or person has worked the card, last_seen_in_scan_at, and
//     lead/project links that were empty. It NEVER resets owner/assignee,
//     status, priority, approval_status, due_at, snoozed_until or promoted_at;
//   • a source with no stable identity at all becomes a review item.
//
// Pure: takes `run(sql, params)`; callers wrap it in their own connection.

import { createHash } from "node:crypto";
import type { Run } from "../commands/core.ts";
import { createOrTouchObligation, type Obligation, type SourceRef } from "./core.ts";

export interface SourcedWorkItemInput {
  /** email / sms / call / schedule / comms / … */
  sourceKind: string;
  /** Stable provider id (Gmail THREAD id, sms thread id, call id, dedup key). Null = unknown identity → review item. */
  sourceId: string | null;
  /** Provider message id when the source is one specific message (Gmail message id). */
  messageId?: string | null;
  /** Provider/account for the obligation source row. Defaults from sourceKind. */
  provider?: string | null;
  account?: string | null;
  title: string;
  body: string;
  status?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assigneeKind?: "human" | "agent";
  assigneeKey?: string | null;
  leadId?: string | null;
  projectId?: string | null;
  dueAt?: string | Date | null;
  expectedSkillSlug?: string | null;
  requiresApproval?: boolean;
  createdBy?: string;
  /** Stamp last_seen_in_scan_at (inbox scan batches). */
  stampScan?: boolean;
  obligationKind?: string;
  occurredAt?: string | Date | null;
  /** The source id names a recurring CONDITION (e.g. 'tendlc:rejected'), not
   *  a message: a done item on it does not block a fresh occurrence. Default
   *  false — a replayed message-less source never resurrects done work. */
  recurring?: boolean;
}

export type SourcedWorkItemResult =
  | { action: "created"; id: string; obligationId: string | null }
  | { action: "refreshed"; id: string; obligationId: string | null }
  | { action: "kept_done"; id: string; obligationId: string | null }
  | { action: "review"; id: string; obligationId: string | null; reason: string };

interface WiRow {
  id: string;
  status: string;
  obligation_id: string | null;
  created_at: string;
}

const PROVIDER_BY_KIND: Record<string, string> = { email: "gmail", sms: "sms", call: "call", schedule: "detector", comms: "comms" };

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export function unidentifiedSourceId(input: Pick<SourcedWorkItemInput, "sourceKind" | "title" | "leadId" | "projectId">): string {
  const h = createHash("sha1").update([input.sourceKind, input.title.trim().toLowerCase(), input.leadId ?? "", input.projectId ?? ""].join("|")).digest("hex");
  return `unidentified:${h.slice(0, 20)}`;
}

/** The newest work item on a stable source id (any status). */
async function latestBySource(run: Run, sourceKind: string, sourceId: string): Promise<WiRow | null> {
  const rows = await run<WiRow>(
    `SELECT id, status, obligation_id, created_at::text AS created_at FROM work_items
      WHERE source_kind = $1 AND source_id = $2
      ORDER BY (status NOT IN ('done','cancelled')) DESC, created_at DESC LIMIT 1`,
    [sourceKind, sourceId],
  );
  return rows[0] ?? null;
}

/** Only source facts. Guarded by "untouched": no agent runs/receipts, no
 *  enrichment, and no owner edit since creation (updated_at == created_at is
 *  too strict because the scan itself bumps it, so we key on agent traces). */
async function refreshFacts(run: Run, id: string, input: SourcedWorkItemInput): Promise<void> {
  await run(
    `UPDATE work_items
        SET body = CASE
              WHEN EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.work_item_id = work_items.id)
                OR EXISTS (SELECT 1 FROM agent_receipts rr WHERE rr.work_item_id = work_items.id)
                OR enriched_at IS NOT NULL
              THEN body ELSE $2 END,
            title = CASE
              WHEN EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.work_item_id = work_items.id)
                OR EXISTS (SELECT 1 FROM agent_receipts rr WHERE rr.work_item_id = work_items.id)
                OR enriched_at IS NOT NULL
              THEN title ELSE $3 END,
            lead_id = COALESCE(lead_id, $4),
            project_id = COALESCE(project_id, $5),
            last_seen_in_scan_at = CASE WHEN $6 THEN now() ELSE last_seen_in_scan_at END,
            updated_at = now()
      WHERE id = $1`,
    [id, input.body, input.title.slice(0, 200), input.leadId ?? null, input.projectId ?? null, input.stampScan ?? false],
  );
}

async function insertItem(run: Run, input: SourcedWorkItemInput, sourceId: string, obligationId: string | null, review: string | null): Promise<string> {
  const rows = await run<{ id: string }>(
    `INSERT INTO work_items
       (title, body, status, priority, assignee_kind, assignee_key, due_at, lead_id, project_id,
        source_kind, source_id, expected_skill_slug, requires_approval, created_by, last_seen_in_scan_at,
        obligation_id, blocked_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,
             CASE WHEN $15 THEN now() ELSE NULL END, $16, $17)
     RETURNING id`,
    [
      input.title.slice(0, 200),
      input.body,
      review ? "waiting_on_human" : (input.status ?? "waiting_on_human"),
      input.priority ?? "normal",
      input.assigneeKind ?? "human",
      input.assigneeKey ?? (input.assigneeKind === "agent" ? null : "human-joe"),
      iso(input.dueAt),
      input.leadId ?? null,
      input.projectId ?? null,
      input.sourceKind,
      sourceId,
      input.expectedSkillSlug ?? null,
      input.requiresApproval ?? true,
      input.createdBy ?? "source-refresh",
      input.stampScan ?? false,
      obligationId,
      review,
    ],
  );
  return rows[0].id;
}

function sourceRef(input: SourcedWorkItemInput, sourceId: string | null): SourceRef {
  return {
    provider: input.provider ?? PROVIDER_BY_KIND[input.sourceKind] ?? input.sourceKind,
    account: input.account ?? "",
    threadId: sourceId,
    messageId: input.messageId ?? null,
    role: "origin",
    occurredAt: input.occurredAt ?? null,
    summary: input.title,
  };
}

async function obligationFor(run: Run, input: SourcedWorkItemInput, sourceId: string | null): Promise<{ obligation: Obligation; action: string }> {
  const r = await createOrTouchObligation(run, {
    source: sourceRef(input, sourceId),
    kind: input.obligationKind ?? (input.sourceKind === "schedule" ? "detector" : "reply"),
    title: input.title,
    ownerKind: input.assigneeKind ?? "human",
    ownerKey: input.assigneeKey ?? (input.assigneeKind === "agent" ? null : "human-joe"),
    leadId: input.leadId ?? null,
    projectId: input.projectId ?? null,
    dueAt: input.dueAt ?? null,
    createdBy: input.createdBy ?? "source-refresh",
  });
  return { obligation: r.obligation, action: r.action };
}

/** Open work item already executing an obligation, if any. */
async function itemForObligation(run: Run, obligationId: string): Promise<WiRow | null> {
  const rows = await run<WiRow>(
    `SELECT id, status, obligation_id, created_at::text AS created_at FROM work_items
      WHERE obligation_id = $1 ORDER BY (status NOT IN ('done','cancelled')) DESC, created_at DESC LIMIT 1`,
    [obligationId],
  );
  return rows[0] ?? null;
}

export async function refreshSourcedWorkItem(run: Run, input: SourcedWorkItemInput): Promise<SourcedWorkItemResult> {
  // ── Unknown identity → review item, keyed by a synthetic id so a re-scan
  //    does not file a twin every run. Never merged with a real id.
  if (!input.sourceId && !input.messageId) {
    const synthetic = unidentifiedSourceId(input);
    const existing = await latestBySource(run, input.sourceKind, synthetic);
    if (existing) {
      if (existing.status === "done" || existing.status === "cancelled") return { action: "kept_done", id: existing.id, obligationId: existing.obligation_id };
      await refreshFacts(run, existing.id, input);
      return { action: "refreshed", id: existing.id, obligationId: existing.obligation_id };
    }
    const { obligation } = await obligationFor(run, input, null);
    const reason = "unknown source identity; review";
    const id = await insertItem(run, input, synthetic, obligation.id, reason);
    return { action: "review", id, obligationId: obligation.id, reason };
  }

  const sourceId = input.sourceId ?? `msg:${input.messageId}`;

  // ── Message-level identity: the obligation decides. A message id nobody
  //    owns is a new promise even on a thread with open work.
  if (input.messageId) {
    const { obligation, action } = await obligationFor(run, input, sourceId);
    const existing = await itemForObligation(run, obligation.id);
    if (existing) {
      if (existing.status === "done" || existing.status === "cancelled") return { action: "kept_done", id: existing.id, obligationId: obligation.id };
      await refreshFacts(run, existing.id, input);
      return { action: "refreshed", id: existing.id, obligationId: obligation.id };
    }
    if (action === "review") {
      const id = await insertItem(run, input, sourceId, obligation.id, obligation.review_reason ?? "review");
      return { action: "review", id, obligationId: obligation.id, reason: obligation.review_reason ?? "review" };
    }
    const id = await insertItem(run, input, sourceId, obligation.id, null);
    return { action: "created", id, obligationId: obligation.id };
  }

  // ── Thread-level identity (legacy inbox scan shape): one item per source id.
  const existing = await latestBySource(run, input.sourceKind, sourceId);
  if (existing && (existing.status === "done" || existing.status === "cancelled") && !input.recurring) {
    return { action: "kept_done", id: existing.id, obligationId: existing.obligation_id };
  }
  if (existing && existing.status !== "done" && existing.status !== "cancelled") {
    await refreshFacts(run, existing.id, input);
    if (existing.obligation_id) await run(`UPDATE obligations SET updated_at = now() WHERE id = $1`, [existing.obligation_id]);
    return { action: "refreshed", id: existing.id, obligationId: existing.obligation_id };
  }
  const { obligation, action } = await obligationFor(run, input, sourceId);
  if (action === "review") {
    const id = await insertItem(run, input, sourceId, obligation.id, obligation.review_reason ?? "review");
    return { action: "review", id, obligationId: obligation.id, reason: obligation.review_reason ?? "review" };
  }
  const id = await insertItem(run, input, sourceId, obligation.id, null);
  return { action: "created", id, obligationId: obligation.id };
}

/** Scan-absence review (replaces the old 14-day auto-cancel): items not seen
 *  by their scan for `days` go to waiting_on_human with a review reason, at
 *  most once, and are never cancelled. Returns the ids flagged this pass. */
export async function flagUnseenForReview(run: Run, opts: { sourceKind: string; createdBy: string; days?: number }): Promise<string[]> {
  const days = opts.days ?? 14;
  const rows = await run<{ id: string }>(
    `UPDATE work_items wi
        SET status = 'waiting_on_human',
            blocked_reason = 'not seen in scan; review',
            scan_review_flagged_at = now(),
            updated_at = now()
      WHERE wi.source_kind = $1
        AND wi.created_by = $2
        AND wi.status NOT IN ('done','cancelled')
        AND wi.scan_review_flagged_at IS NULL
        AND wi.last_seen_in_scan_at < now() - ($3::int * interval '1 day')
        AND wi.updated_at < now() - ($3::int * interval '1 day')
      RETURNING wi.id`,
    [opts.sourceKind, opts.createdBy, days],
  );
  for (const r of rows) {
    await run(
      `UPDATE obligations o SET status = 'review', review_reason = 'not seen in scan; review', updated_at = now()
        FROM work_items wi WHERE wi.id = $1 AND o.id = wi.obligation_id AND o.status IN ('open','waiting')`,
      [r.id],
    );
  }
  return rows.map((r) => r.id);
}
