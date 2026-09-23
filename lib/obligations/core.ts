// Obligations (A01): the business identity of "something we owe someone",
// separate from the message/thread that surfaced it. Pure module — every
// function takes a `run(sql, params)` so node --test drives it against the
// disposable harness and lib/comms-shared / lib/detectors wrap it over the
// pool. Migration db/migrations/0002_obligations.sql.
//
// Identity rules (DESIGN.md "Safe transactions and permanent intents"):
//   • an obligation is keyed by STABLE provider ids (provider + account +
//     thread id + message id), never by title text;
//   • one thread can carry many obligations; one obligation can span threads;
//   • a NEW message id in an old thread that no obligation lists is a new
//     obligation (a fresh promise), not a bump of the old one;
//   • a reply on a thread resolves only the obligation whose source it
//     answers; other promises in the same thread stay open;
//   • age or absence from a scan never proves resolution;
//   • a source we cannot tie to a stable id becomes a 'review' obligation.

import type { Run } from "../commands/core.ts";

export type ObligationStatus = "open" | "waiting" | "done" | "cancelled" | "review";

export interface Obligation {
  id: string;
  kind: string;
  title: string;
  status: ObligationStatus;
  owner_kind: "human" | "agent";
  owner_key: string | null;
  lead_id: string | null;
  project_id: string | null;
  next_action: string;
  due_at: string | null;
  deadline_at: string | null;
  deadline_source: string | null;
  resolution: Record<string, unknown>;
  resolved_at: string | null;
  resolved_by: string | null;
  source_message_ids: string[];
  review_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SourceRef {
  /** gmail / sms / call / detector / portal / manual */
  provider: string;
  /** Mailbox address / phone number; part of identity across accounts. */
  account?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  role?: "origin" | "reply" | "evidence" | "reference";
  occurredAt?: string | Date | null;
  summary?: string | null;
}

export type ResolutionEvidence =
  | { kind: "reply_sent"; intent_id?: string | null; message_id?: string | null; thread_id?: string | null }
  | { kind: "business_response"; message_id?: string | null; thread_id?: string | null; source_event_id?: string | null }
  | { kind: "detector_cleared"; detector_key: string; dedup_key: string }
  | { kind: "work_item_done"; work_item_id: string; receipt_id?: string | null }
  | { kind: "manual"; actor: string; reason: string }
  | { kind: "record"; table: string; id: string; revision?: string | null };

export const OBLIGATION_COLS = `id, kind, title, status, owner_kind, owner_key, lead_id, project_id, next_action,
  due_at::text AS due_at, deadline_at::text AS deadline_at, deadline_source, resolution, resolved_at::text AS resolved_at,
  resolved_by, source_message_ids, review_reason, created_by, created_at::text AS created_at, updated_at::text AS updated_at`;

function acct(s: SourceRef): string {
  return (s.account ?? "").trim().toLowerCase();
}

function occurred(s: SourceRef): string | null {
  if (!s.occurredAt) return null;
  return s.occurredAt instanceof Date ? s.occurredAt.toISOString() : String(s.occurredAt);
}

/** Every obligation that has a source row on this provider thread (any role). */
export async function findObligationsByThread(run: Run, s: SourceRef): Promise<Obligation[]> {
  if (!s.threadId) return [];
  return run<Obligation>(
    `SELECT ${OBLIGATION_COLS} FROM obligations o
      WHERE EXISTS (SELECT 1 FROM obligation_sources os
                     WHERE os.obligation_id = o.id AND os.provider = $1 AND os.account = $2 AND os.thread_id = $3)
      ORDER BY created_at`,
    [s.provider, acct(s), s.threadId],
  );
}

/** The obligation a specific message id belongs to (as origin or listed in
 *  source_message_ids), or null. Message ids outrank thread ids. */
export async function findObligationByMessage(run: Run, s: SourceRef): Promise<Obligation | null> {
  if (!s.messageId) return null;
  const rows = await run<Obligation>(
    `SELECT ${OBLIGATION_COLS} FROM obligations o
      WHERE $3 = ANY(o.source_message_ids)
         OR EXISTS (SELECT 1 FROM obligation_sources os
                     WHERE os.obligation_id = o.id AND os.provider = $1 AND os.account = $2 AND os.message_id = $3
                       AND os.role = 'origin')
      ORDER BY created_at LIMIT 1`,
    [s.provider, acct(s), s.messageId],
  );
  return rows[0] ?? null;
}

/** Attach a source row to an obligation (idempotent on the unique key). */
export async function attachSource(run: Run, obligationId: string, s: SourceRef): Promise<{ attached: boolean }> {
  const rows = await run<{ id: string }>(
    `INSERT INTO obligation_sources (obligation_id, provider, account, thread_id, message_id, role, occurred_at, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (obligation_id, provider, account, thread_id, message_id, role) DO NOTHING
     RETURNING id`,
    [obligationId, s.provider, acct(s), s.threadId ?? null, s.messageId ?? null, s.role ?? "origin", occurred(s), (s.summary ?? "").slice(0, 500)],
  );
  if (rows.length && s.messageId && (s.role ?? "origin") === "origin") {
    await run(
      `UPDATE obligations SET source_message_ids = array_append(source_message_ids, $2), updated_at = now()
        WHERE id = $1 AND NOT ($2 = ANY(source_message_ids))`,
      [obligationId, s.messageId],
    );
  }
  return { attached: rows.length > 0 };
}

export interface CreateOrTouchInput {
  source: SourceRef;
  kind?: string;
  title: string;
  ownerKind?: "human" | "agent";
  ownerKey?: string | null;
  leadId?: string | null;
  projectId?: string | null;
  nextAction?: string | null;
  dueAt?: string | Date | null;
  deadlineAt?: string | Date | null;
  deadlineSource?: string | null;
  createdBy?: string;
}

export type CreateOrTouchResult =
  | { action: "created"; obligation: Obligation }
  | { action: "touched"; obligation: Obligation }
  | { action: "review"; obligation: Obligation; reason: string };

/**
 * Find the obligation this source identifies, or create it. Keyed ONLY by
 * stable ids:
 *   1. message id already owned by an obligation → touch that one;
 *   2. no message id but a thread id → the single OPEN obligation on that
 *      thread with no message-level identity (legacy thread-keyed items);
 *      several candidates → ambiguous → review;
 *   3. a message id on a thread with open obligations that do not list it →
 *      a NEW obligation (a new promise in an old thread);
 *   4. no stable id at all → a NEW obligation in 'review'.
 * Touching never resets owner, status, next action, due or deadline: it only
 * stamps updated_at and attaches the source row.
 */
export async function createOrTouchObligation(run: Run, input: CreateOrTouchInput): Promise<CreateOrTouchResult> {
  const s = input.source;
  const hasStableId = Boolean(s.threadId || s.messageId);

  if (s.messageId) {
    const byMsg = await findObligationByMessage(run, s);
    if (byMsg) {
      await attachSource(run, byMsg.id, { ...s, role: s.role ?? "reference" });
      await run(`UPDATE obligations SET updated_at = now() WHERE id = $1`, [byMsg.id]);
      return { action: "touched", obligation: (await getObligation(run, byMsg.id))! };
    }
  } else if (s.threadId) {
    const onThread = (await findObligationsByThread(run, s)).filter((o) => o.status !== "done" && o.status !== "cancelled");
    const threadKeyed = onThread.filter((o) => o.source_message_ids.length === 0);
    if (threadKeyed.length === 1) {
      await attachSource(run, threadKeyed[0].id, { ...s, role: "reference" });
      await run(`UPDATE obligations SET updated_at = now() WHERE id = $1`, [threadKeyed[0].id]);
      return { action: "touched", obligation: (await getObligation(run, threadKeyed[0].id))! };
    }
    if (threadKeyed.length > 1) {
      const created = await insertObligation(run, input, "review", `thread ${s.threadId} has ${threadKeyed.length} open obligations and this source carries no message id`);
      return { action: "review", obligation: created, reason: created.review_reason! };
    }
  }

  if (!hasStableId) {
    const created = await insertObligation(run, input, "review", "source carries no stable provider identity (no thread or message id)");
    return { action: "review", obligation: created, reason: created.review_reason! };
  }
  const created = await insertObligation(run, input, "open", null);
  return { action: "created", obligation: created };
}

async function insertObligation(run: Run, input: CreateOrTouchInput, status: ObligationStatus, reviewReason: string | null): Promise<Obligation> {
  const s = input.source;
  const rows = await run<Obligation>(
    `INSERT INTO obligations (kind, title, status, owner_kind, owner_key, lead_id, project_id, next_action, due_at, deadline_at,
                              deadline_source, source_message_ids, review_reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14)
     RETURNING ${OBLIGATION_COLS}`,
    [
      input.kind ?? "reply",
      input.title.slice(0, 200),
      status,
      input.ownerKind ?? "human",
      input.ownerKey ?? (input.ownerKind === "agent" ? null : "human-joe"),
      input.leadId ?? null,
      input.projectId ?? null,
      input.nextAction ?? "",
      toIso(input.dueAt),
      toIso(input.deadlineAt),
      input.deadlineSource ?? null,
      s.messageId ? [s.messageId] : [],
      reviewReason,
      input.createdBy ?? "system",
    ],
  );
  const o = rows[0];
  await run(
    `INSERT INTO obligation_sources (obligation_id, provider, account, thread_id, message_id, role, occurred_at, summary)
     VALUES ($1, $2, $3, $4, $5, 'origin', $6, $7)
     ON CONFLICT (obligation_id, provider, account, thread_id, message_id, role) DO NOTHING`,
    [o.id, s.provider, acct(s), s.threadId ?? null, s.messageId ?? null, occurred(s), (s.summary ?? "").slice(0, 500)],
  );
  return o;
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export async function getObligation(run: Run, id: string): Promise<Obligation | null> {
  const rows = await run<Obligation>(`SELECT ${OBLIGATION_COLS} FROM obligations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Mark done with typed evidence. Refuses (returns ok:false) without evidence.
 *  Idempotent: an already-done obligation is left alone. */
export async function resolveObligation(
  run: Run,
  id: string,
  evidence: ResolutionEvidence,
  resolvedBy: string,
): Promise<{ ok: true; obligation: Obligation; changed: boolean } | { ok: false; error: string }> {
  if (!evidence || typeof evidence !== "object" || !("kind" in evidence) || !evidence.kind) {
    return { ok: false, error: "resolution evidence required" };
  }
  if (evidence.kind === "manual" && (!evidence.actor?.trim() || !evidence.reason?.trim())) {
    return { ok: false, error: "manual resolution needs actor and reason" };
  }
  const cur = await getObligation(run, id);
  if (!cur) return { ok: false, error: `no obligation ${id}` };
  if (cur.status === "done") return { ok: true, obligation: cur, changed: false };
  const rows = await run<Obligation>(
    `UPDATE obligations SET status = 'done', resolution = $2::jsonb, resolved_at = now(), resolved_by = $3, review_reason = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${OBLIGATION_COLS}`,
    [id, JSON.stringify(evidence), resolvedBy],
  );
  return { ok: true, obligation: rows[0], changed: true };
}

/** Reopen rules: a done/cancelled obligation reopens only with a reason and a
 *  NEW source (a later message id not already recorded); replaying an old
 *  message never resurrects done work. */
export async function reopenObligation(
  run: Run,
  id: string,
  opts: { reason: string; source?: SourceRef | null; by: string },
): Promise<{ ok: true; obligation: Obligation; reopened: boolean } | { ok: false; error: string }> {
  const cur = await getObligation(run, id);
  if (!cur) return { ok: false, error: `no obligation ${id}` };
  if (cur.status !== "done" && cur.status !== "cancelled") return { ok: true, obligation: cur, reopened: false };
  if (opts.source?.messageId && cur.source_message_ids.includes(opts.source.messageId)) {
    return { ok: false, error: `message ${opts.source.messageId} already belongs to this obligation; a replay is not a reopen` };
  }
  if (!opts.reason?.trim()) return { ok: false, error: "reopen needs a reason" };
  const rows = await run<Obligation>(
    `UPDATE obligations SET status = 'open', resolution = resolution || $2::jsonb, resolved_at = NULL, resolved_by = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${OBLIGATION_COLS}`,
    [id, JSON.stringify({ reopened_at: new Date().toISOString(), reopened_by: opts.by, reopen_reason: opts.reason })],
  );
  if (opts.source) await attachSource(run, id, { ...opts.source, role: "origin" });
  return { ok: true, obligation: (await getObligation(run, id)) ?? rows[0], reopened: true };
}

export interface ReplyInput {
  /** The reply itself (provider + thread + message id of the reply). */
  reply: SourceRef;
  /** Provider message id the reply answers (In-Reply-To), when known. */
  inReplyToMessageId?: string | null;
  /** Who answered: us (our outbound) or them (the counterparty). */
  direction: "outbound" | "inbound";
  by: string;
}

export type ReplyOutcome = {
  resolved: Obligation[];
  /** Open obligations on the same thread that this reply did NOT answer. */
  untouched: Obligation[];
  /** Set when the reply matched no obligation: a new inbound message with
   *  nothing to resolve. Callers file a NEW obligation for it. */
  unmatched: boolean;
};

/**
 * Per-obligation reply handling. A reply resolves ONLY the obligation whose
 * origin message it answers (In-Reply-To first; when that is unknown and the
 * thread has exactly one open obligation, that one). Other promises on the
 * thread stay open. An outbound reply from us resolves a 'reply' obligation;
 * an inbound reply from them resolves a 'waiting' obligation (we were waiting
 * on them) and is otherwise a new item for the caller to file.
 */
export async function handleReply(run: Run, input: ReplyInput): Promise<ReplyOutcome> {
  const onThread = (await findObligationsByThread(run, input.reply)).filter((o) => o.status !== "done" && o.status !== "cancelled");
  let target: Obligation | null = null;
  if (input.inReplyToMessageId) {
    target = onThread.find((o) => o.source_message_ids.includes(input.inReplyToMessageId!)) ?? null;
    if (!target) {
      const byMsg = await findObligationByMessage(run, { ...input.reply, messageId: input.inReplyToMessageId });
      if (byMsg && byMsg.status !== "done" && byMsg.status !== "cancelled") target = byMsg;
    }
  }
  const eligible = onThread.filter((o) => (input.direction === "outbound" ? o.status === "open" || o.status === "review" : o.status === "waiting"));
  if (!target && eligible.length === 1) target = eligible[0];
  if (!target) return { resolved: [], untouched: onThread, unmatched: true };
  if (input.direction === "outbound" && target.status === "waiting") {
    // We wrote again while waiting on them — a nudge, not a resolution.
    await attachSource(run, target.id, { ...input.reply, role: "reference" });
    return { resolved: [], untouched: onThread, unmatched: false };
  }
  await attachSource(run, target.id, { ...input.reply, role: "reply" });
  const evidence: ResolutionEvidence =
    input.direction === "outbound"
      ? { kind: "reply_sent", message_id: input.reply.messageId ?? null, thread_id: input.reply.threadId ?? null }
      : { kind: "business_response", message_id: input.reply.messageId ?? null, thread_id: input.reply.threadId ?? null };
  const r = await resolveObligation(run, target.id, evidence, input.by);
  const resolved = r.ok ? [r.obligation] : [];
  return { resolved, untouched: onThread.filter((o) => o.id !== target!.id), unmatched: false };
}

/** Flip an open obligation to 'waiting' (we replied, ball is in their court). */
export async function markWaiting(run: Run, id: string, nextAction?: string | null): Promise<Obligation | null> {
  const rows = await run<Obligation>(
    `UPDATE obligations SET status = 'waiting', next_action = COALESCE($2, next_action), updated_at = now()
      WHERE id = $1 AND status IN ('open','review') RETURNING ${OBLIGATION_COLS}`,
    [id, nextAction ?? null],
  );
  return rows[0] ?? (await getObligation(run, id));
}

/** Flag an obligation for a person: unknown identity, ambiguous thread, etc. */
export async function flagForReview(run: Run, id: string, reason: string): Promise<void> {
  await run(`UPDATE obligations SET status = 'review', review_reason = $2, updated_at = now() WHERE id = $1 AND status NOT IN ('done','cancelled')`, [id, reason]);
}

export interface ListObligationsFilter {
  status?: ObligationStatus | ObligationStatus[] | null;
  leadId?: string | null;
  projectId?: string | null;
  kind?: string | null;
  limit?: number;
}

export async function listObligations(run: Run, f: ListObligationsFilter = {}): Promise<Obligation[]> {
  const statuses = f.status == null ? null : Array.isArray(f.status) ? f.status : [f.status];
  return run<Obligation>(
    `SELECT ${OBLIGATION_COLS} FROM obligations
      WHERE ($1::text[] IS NULL OR status = ANY($1::text[]))
        AND ($2::uuid IS NULL OR lead_id = $2::uuid)
        AND ($3::uuid IS NULL OR project_id = $3::uuid)
        AND ($4::text IS NULL OR kind = $4)
      ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'open' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, updated_at DESC
      LIMIT $5`,
    [statuses, f.leadId ?? null, f.projectId ?? null, f.kind ?? null, Math.min(Math.max(f.limit ?? 50, 1), 500)],
  );
}
