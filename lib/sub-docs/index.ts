// Subcontractor paperwork collection (A12, VALIDATION V15/V19). Pure `run`.
//
//   detectMissingOrExpiring — per sub (and per job when a project requires a
//                             document) from subs.coi_expires_at + accepted
//                             sub_documents; opens sub_document_requests.
//   requestDocument         — the ask, to the trusted sub contact only, under
//                             policy routine.followup (intent) or staged as a
//                             decision when the policy is inactive.
//   ingestSubDocument       — a file arrives: exact version bound to sub/job;
//                             unreadable / wrong job / expired / duplicate are
//                             exceptions with reasons. Receipt ≠ acceptance.
//   acceptDocument          — reviewer records validated metadata (never the
//                             TIN) → accepted; open request satisfied; contact
//                             stops. Missing interpretation escalates to Joe.
//   receiveSubDocument      — a sub-portal upload: ingest, and a COI goes
//                             under_review with one to-do for Joe. The date
//                             the sub typed is their claim, not coverage.
//   confirmSubDocument      — Joe's own reading: accepts with the expiry date
//                             he confirms (owner only).
//   rejectDocument          — not accepted, with a reason; the sub is asked
//                             again unless another copy is waiting on Joe or
//                             their accepted one is still good.
//   canAccessSubDocument    — portal boundary: a sub sees only its own docs;
//                             restricted docs never leave the owner surface.

import type { Run } from "../commands/core.ts";
import { stageDecision, type Decision } from "../commands/decisions.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { humanOf, principalLabel, type Principal } from "../commands/principal.ts";
import { routineSendAllowed } from "../leads/routine.ts";

export type SubDocType = "w9" | "coi" | "agreement" | "other";
export type SubDocStatus = "received" | "under_review" | "accepted" | "rejected" | "expired" | "superseded";

/** A sub's COI status, worked out from its tracked expiry date on every read.
 *  subs.coi_status is stamped when a COI is accepted and goes stale as the
 *  days pass (a "current" COI that expired last month still says current).
 *  `alias` is the subs table alias in the query. */
export const coiStatusSql = (alias: string) =>
  `CASE WHEN ${alias}.coi_expires_at IS NULL THEN 'missing'
        WHEN ${alias}.coi_expires_at < CURRENT_DATE THEN 'expired'
        WHEN ${alias}.coi_expires_at - CURRENT_DATE <= 30 THEN 'expiring'
        ELSE 'current' END`;

/** A W-9 that counts as on file: not rejected, expired or superseded. */
export const w9OnFileSql = (alias: string) =>
  `EXISTS (SELECT 1 FROM sub_documents sd WHERE sd.sub_slug = ${alias}.slug AND sd.doc_type = 'w9' AND sd.status IN ('received','under_review','accepted'))`;

export interface SubDocumentRow {
  id: number;
  sub_slug: string;
  doc_type: SubDocType;
  file_id: string | null;
  expires_at: string | null;
  version: number;
  status: SubDocStatus;
  validated_metadata: Record<string, unknown> | null;
  reviewed_by: string | null;
  review_note: string;
  project_id: string | null;
  restricted: boolean;
  checksum: string | null;
  exception: { reason: string; detail: string } | null;
  created_at: string;
}

const DOC_COLS = `id, sub_slug, doc_type, file_id, expires_at::text AS expires_at, version, status, validated_metadata, reviewed_by, review_note,
  project_id, restricted, checksum, exception, created_at::text AS created_at`;

export interface RequirementRow {
  subSlug: string;
  docType: SubDocType;
  projectId: string | null;
  reason: "missing" | "expiring" | "expired" | "job_requirement";
  detail: string;
}

export interface DetectResult {
  requirements: RequirementRow[];
  openedRequestIds: number[];
}

/** Company-level rule: every sub needs a W-9 and a current COI. Per-job
 *  requirements come from `jobRequirements` (project id → doc types), which
 *  the caller derives from the project's rules (default: none). */
export async function detectMissingOrExpiring(
  run: Run,
  opts: { subSlugs?: string[] | null; expiringWithinDays?: number; jobRequirements?: { projectId: string; subSlug: string; docTypes: SubDocType[] }[]; openRequests?: boolean } = {},
): Promise<DetectResult> {
  const within = opts.expiringWithinDays ?? 30;
  const subs = await run<{ slug: string; coi_expires_at: string | null }>(
    `SELECT slug, coi_expires_at::text AS coi_expires_at FROM subs WHERE ($1::text[] IS NULL OR slug = ANY($1::text[])) ORDER BY slug`,
    [opts.subSlugs ?? null],
  );
  const accepted = await run<{ sub_slug: string; doc_type: SubDocType; project_id: string | null; expires_at: string | null }>(
    `SELECT sub_slug, doc_type, project_id, expires_at::text AS expires_at FROM sub_documents WHERE status = 'accepted'`,
  );
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + within * 86_400_000).toISOString().slice(0, 10);
  const has = (slug: string, type: SubDocType, projectId: string | null) =>
    accepted.filter((a) => a.sub_slug === slug && a.doc_type === type && (projectId == null || a.project_id == null || a.project_id === projectId));
  const requirements: RequirementRow[] = [];
  for (const s of subs) {
    if (!has(s.slug, "w9", null).length) requirements.push({ subSlug: s.slug, docType: "w9", projectId: null, reason: "missing", detail: "No accepted W-9 on file." });
    const cois = has(s.slug, "coi", null);
    const bestExpiry = [...cois.map((c) => c.expires_at), s.coi_expires_at].filter((x): x is string => Boolean(x)).sort().pop() ?? null;
    if (!cois.length) requirements.push({ subSlug: s.slug, docType: "coi", projectId: null, reason: "missing", detail: bestExpiry ? `subs.coi_expires_at says ${bestExpiry} but no accepted COI document is on file.` : "No accepted certificate of insurance." });
    else if (bestExpiry && bestExpiry < today) requirements.push({ subSlug: s.slug, docType: "coi", projectId: null, reason: "expired", detail: `COI expired ${bestExpiry}.` });
    else if (bestExpiry && bestExpiry <= soon) requirements.push({ subSlug: s.slug, docType: "coi", projectId: null, reason: "expiring", detail: `COI expires ${bestExpiry}.` });
  }
  for (const jr of opts.jobRequirements ?? []) {
    for (const t of jr.docTypes) {
      if (!has(jr.subSlug, t, jr.projectId).length) requirements.push({ subSlug: jr.subSlug, docType: t, projectId: jr.projectId, reason: "job_requirement", detail: `Job requires an accepted ${t}.` });
    }
  }
  const openedRequestIds: number[] = [];
  if (opts.openRequests !== false) {
    for (const r of requirements) {
      const [row] = await run<{ id: number }>(
        `INSERT INTO sub_document_requests (sub_slug, doc_type, project_id, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sub_slug, doc_type, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE state = 'open' DO NOTHING
         RETURNING id`,
        [r.subSlug, r.docType, r.projectId, r.reason],
      );
      if (row) openedRequestIds.push(Number(row.id));
    }
  }
  return { requirements, openedRequestIds };
}

const DOC_LABEL: Record<SubDocType, string> = { w9: "W-9", coi: "certificate of insurance", agreement: "signed sub agreement", other: "document" };

export interface RequestDocumentInput {
  requestId: number;
  principal: Principal;
  at?: Date;
  /** Override the drafted body (must stay factual; no invented calls). */
  body?: string | null;
  commandId?: string | null;
}

export type RequestDocumentResult =
  | { ok: true; mode: "sent"; intentId: string; policyRef: string; contact: string; body: string }
  | { ok: true; mode: "staged"; decision: Decision; reason: string; contact: string; body: string }
  | { ok: false; reason: string };

function draftRequestBody(subName: string, docType: SubDocType, reason: string, projectName: string | null, rejectedBecause?: string | null): string {
  const doc = DOC_LABEL[docType];
  const sign = `Thanks,\nJoe\nSJ Carpentry LLC\n612-361-6585`;
  if (rejectedBecause) {
    const because = /[.!?]$/.test(rejectedBecause) ? rejectedBecause : `${rejectedBecause}.`;
    return `Hi ${subName.split(" ")[0]},\n\nThanks for sending your ${doc}. I wasn't able to accept that one: ${because}\n\nCould you send over an updated copy when you get a chance? A reply to this email with the file attached is perfect.\n\n${sign}`;
  }
  const why =
    reason === "expiring" ? `the ${doc} we have on file is about to expire` : reason === "expired" ? `the ${doc} we have on file has expired` : projectName ? `we need a current ${doc} for ${projectName}` : `we don't have a current ${doc} on file`;
  return `Hi ${subName.split(" ")[0]},\n\nQuick one: ${why}. Could you send over an updated copy when you get a chance? A reply to this email with the file attached is perfect.\n\n${sign}`;
}

/** Ask the sub for the document. Stops on receipt (the request is satisfied
 *  by ingest/accept), respects cadence and opt-outs, uses the trusted record. */
export async function requestDocument(run: Run, input: RequestDocumentInput): Promise<RequestDocumentResult> {
  const [req] = await run<{ id: number; sub_slug: string; doc_type: SubDocType; project_id: string | null; reason: string; state: string; attempts: number; requested_at: string | null; sub_name: string; email: string | null; phone: string | null; project_name: string | null }>(
    `SELECT r.id, r.sub_slug, r.doc_type, r.project_id, r.reason, r.state, r.attempts, r.requested_at::text AS requested_at,
            s.name AS sub_name, s.email, s.phone, p.name AS project_name
       FROM sub_document_requests r JOIN subs s ON s.slug = r.sub_slug LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1 FOR UPDATE OF r`,
    [input.requestId],
  );
  if (!req) return { ok: false, reason: "No such request." };
  if (req.state !== "open") return { ok: false, reason: `Request is ${req.state}; no further contact.` };
  const contact = (req.email ?? "").trim().toLowerCase();
  if (!contact) return { ok: false, reason: `${req.sub_name} has no email on the sub record; add one or ask by phone.` };
  const body = (input.body ?? "").trim() || draftRequestBody(req.sub_name, req.doc_type, req.reason, req.project_name);
  const subject = `${DOC_LABEL[req.doc_type].replace(/^./, (ch) => ch.toUpperCase())} for SJ Carpentry${req.project_name ? ` · ${req.project_name}` : ""}`;
  const recent = await run<{ created_at: string }>(
    `SELECT created_at::text AS created_at FROM action_intents WHERE recipient = $1 AND kind = 'send_email' AND policy_ref IS NOT NULL AND created_at > now() - interval '7 days'`,
    [contact],
  );
  const [pending] = await run<{ id: string }>(`SELECT id FROM decisions WHERE status = 'pending' AND target_kind = 'sub_document_request' AND target_id = $1`, [String(req.id)]);
  const verdict = await routineSendAllowed(run, {
    channel: "email",
    recipient: contact,
    projectId: req.project_id,
    at: input.at,
    recentSends: recent.map((r) => r.created_at),
    signals: { pendingOwnerDecision: Boolean(pending) },
  });
  const attempt = Number(req.attempts) + 1;
  if (verdict.ok) {
    const { intent } = await enqueueIntent(run, {
      operationKey: `subdoc:${req.id}:request:${attempt}`,
      kind: "send_email",
      targetKind: "sub_document_request",
      targetId: req.id,
      recipient: contact,
      projectId: req.project_id,
      payload: { to: contact, subject, bodyText: body, subSlug: req.sub_slug, docType: req.doc_type },
      policyRef: verdict.policyRef,
      commandId: input.commandId ?? null,
      principal: input.principal,
    });
    await run(
      `UPDATE sub_document_requests SET requested_at = now(), contact_used = $2, policy_ref = $3, last_intent_id = $4, attempts = $5, next_at = now() + interval '3 days', updated_at = now() WHERE id = $1`,
      [req.id, contact, verdict.policyRef, intent.id, attempt],
    );
    return { ok: true, mode: "sent", intentId: intent.id, policyRef: verdict.policyRef, contact, body };
  }
  const staged = await stageDecision(run, {
    kind: "routine_message",
    action: "send_email",
    title: `Ask ${req.sub_name} for a ${DOC_LABEL[req.doc_type]}`.slice(0, 300),
    summary: { recipients: [{ name: req.sub_name, address: contact, role: "sub" }], inclusions: [subject], effect: `Emails the request to ${contact}. Held because: ${verdict.reason}`, body },
    targetKind: "sub_document_request",
    targetId: req.id,
    recipient: contact,
    content: { to: contact, subject, body },
    projectId: req.project_id,
    dedupeKey: `subdoc:${req.id}:request`,
    requestedBy: input.principal,
  });
  await run(`UPDATE sub_document_requests SET contact_used = $2, decision_id = $3, updated_at = now() WHERE id = $1`, [req.id, contact, staged.decision.id]);
  return { ok: true, mode: "staged", decision: staged.decision, reason: verdict.reason, contact, body };
}

export interface IngestInput {
  subSlug: string;
  docType: SubDocType;
  fileId: string;
  checksum?: string | null;
  projectId?: string | null;
  /** What the sender said the file is for (subject/body hint) — used to spot wrong-job files. */
  claimedProjectId?: string | null;
  expiresAt?: string | null;
  readable?: boolean;
  source?: string;
  principal: Principal;
}

export type IngestResult =
  | { ok: true; document: SubDocumentRow; version: number; requestIds: number[] }
  | { ok: false; exception: "unreadable" | "wrong_job" | "expired" | "duplicate" | "unknown_sub" | "missing_file"; reason: string; documentId: number | null };

/** Bind an arriving file to the exact sub/job as a new version. Exceptions
 *  are recorded on a row (so the evidence is kept) and returned with reasons. */
export async function ingestSubDocument(run: Run, input: IngestInput): Promise<IngestResult> {
  const [sub] = await run<{ slug: string; name: string }>(`SELECT slug, name FROM subs WHERE slug = $1`, [input.subSlug]);
  if (!sub) return { ok: false, exception: "unknown_sub", reason: `No sub with slug ${input.subSlug}.`, documentId: null };
  const [file] = await run<{ id: string; storage_path: string | null }>(`SELECT id, storage_path FROM files WHERE id = $1`, [input.fileId]);
  if (!file) return { ok: false, exception: "missing_file", reason: "That file id does not exist.", documentId: null };
  const today = new Date().toISOString().slice(0, 10);
  const label = principalLabel(input.principal);
  const record = async (status: SubDocStatus, exception: { reason: string; detail: string } | null, version: number) => {
    const [row] = await run<SubDocumentRow>(
      `INSERT INTO sub_documents (sub_slug, doc_type, file_id, expires_at, version, status, project_id, checksum, exception, source, restricted)
       VALUES ($1, $2, $3, NULLIF($4, '')::date, $5, $6, $7, $8, $9::jsonb, $10, true) RETURNING ${DOC_COLS}`,
      [sub.slug, input.docType, file.id, input.expiresAt ?? "", version, status, input.projectId ?? null, input.checksum ?? null, exception ? JSON.stringify(exception) : null, input.source ?? label],
    );
    return { ...row, id: Number(row.id), version: Number(row.version) };
  };
  const [{ v }] = await run<{ v: number }>(`SELECT COALESCE(max(version), 0)::int AS v FROM sub_documents WHERE sub_slug = $1 AND doc_type = $2`, [sub.slug, input.docType]);
  const version = Number(v) + 1;

  if (input.readable === false || !file.storage_path) {
    const doc = await record("rejected", { reason: "unreadable", detail: "File could not be read (empty, corrupt, or unsupported)." }, version);
    return { ok: false, exception: "unreadable", reason: `Rejected: the ${DOC_LABEL[input.docType]} from ${sub.name} could not be read. Ask for a clean copy.`, documentId: doc.id };
  }
  if (input.claimedProjectId && input.projectId && input.claimedProjectId !== input.projectId) {
    const doc = await record("rejected", { reason: "wrong_job", detail: `File says project ${input.claimedProjectId}; request is for ${input.projectId}.` }, version);
    return { ok: false, exception: "wrong_job", reason: `Rejected: this file is for a different job than the one requested.`, documentId: doc.id };
  }
  if (input.checksum) {
    // A rejected or expired copy is not "on file": the same file again (say,
    // with the expiry date corrected) is a fresh arrival, not a duplicate.
    const [dupe] = await run<{ id: number; version: number; status: string }>(
      `SELECT id, version, status FROM sub_documents WHERE sub_slug = $1 AND doc_type = $2 AND checksum = $3 AND status NOT IN ('rejected', 'expired') ORDER BY version DESC LIMIT 1`,
      [sub.slug, input.docType, input.checksum],
    );
    if (dupe) {
      const doc = await record("rejected", { reason: "duplicate", detail: `Identical to version ${dupe.version} (document ${dupe.id}, ${dupe.status}).` }, version);
      return { ok: false, exception: "duplicate", reason: `Duplicate of version ${dupe.version}, which is ${dupe.status}; nothing new to review.`, documentId: doc.id };
    }
  }
  if (input.expiresAt && input.expiresAt < today) {
    const doc = await record("expired", { reason: "expired", detail: `Expired ${input.expiresAt}.` }, version);
    return { ok: false, exception: "expired", reason: `The ${DOC_LABEL[input.docType]} from ${sub.name} expired on ${input.expiresAt}; a current one is still needed.`, documentId: doc.id };
  }
  const doc = await record("received", null, version);
  const reqs = await run<{ id: number }>(
    `SELECT id FROM sub_document_requests WHERE sub_slug = $1 AND doc_type = $2 AND state = 'open' AND (project_id IS NULL OR project_id = $3::uuid OR $3::uuid IS NULL)`,
    [sub.slug, input.docType, input.projectId ?? null],
  );
  // Receipt pauses the chase (next_at cleared) but does not satisfy it.
  for (const r of reqs) await run(`UPDATE sub_document_requests SET next_at = NULL, updated_at = now() WHERE id = $1`, [r.id]);
  return { ok: true, document: doc, version, requestIds: reqs.map((r) => Number(r.id)) };
}

export interface CoiMetadata {
  insurer: string;
  policyNumber: string;
  limits: Record<string, number | string>;
  effectiveDate: string;
  expiryDate: string;
  additionalInsured?: boolean;
}
export interface W9Metadata {
  /** Presence only — the TIN itself is never stored. */
  tinPresent: boolean;
  legalName: string;
  entityType?: string;
  signed: boolean;
}

export type AcceptResult =
  | { ok: true; document: SubDocumentRow; satisfiedRequestIds: number[] }
  | { ok: false; reason: string; escalatedDecisionId?: string | null };

/** Reviewer accepts a received document with validated metadata. Refuses the
 *  TIN, refuses missing/expired metadata, escalates when interpretation is
 *  missing (escalate=true stages a decision with the evidence). */
export async function acceptDocument(
  run: Run,
  input: { documentId: number; metadata: Record<string, unknown> | null; note?: string; principal: Principal; escalateIfUnclear?: boolean },
): Promise<AcceptResult> {
  const human = humanOf(input.principal);
  if (!human || (human.role !== "owner" && human.role !== "staff")) return { ok: false, reason: "Only the owner or staff can accept a sub document." };
  const doc = await lockDocument(run, input.documentId);
  if (!doc) return { ok: false, reason: "No such document." };
  if (doc.status !== "received" && doc.status !== "under_review") return { ok: false, reason: `Document is ${doc.status}.` };
  const meta = input.metadata;
  const today = new Date().toISOString().slice(0, 10);
  const unclear = async (why: string): Promise<AcceptResult> => {
    await run(`UPDATE sub_documents SET status = 'under_review', review_note = $2, updated_at = now() WHERE id = $1`, [doc.id, why]);
    if (!input.escalateIfUnclear) return { ok: false, reason: why };
    const staged = await stageDecision(run, {
      kind: "other",
      action: "review_sub_document",
      title: `Read ${doc.sub_name}'s ${DOC_LABEL[doc.doc_type]} — ${why}`.slice(0, 300),
      summary: { attachments: doc.file_id ? [{ label: DOC_LABEL[doc.doc_type], fileId: doc.file_id, revision: `v${doc.version}` }] : [], gaps: [why], effect: "Confirm the document's coverage/validity by hand; acceptance is recorded only from your reading." },
      targetKind: "sub_document",
      targetId: doc.id,
      projectId: doc.project_id,
      href: `/subs/${doc.sub_slug}`,
      dedupeKey: `subdoc:review:${doc.id}`,
      requestedBy: input.principal,
    });
    return { ok: false, reason: why, escalatedDecisionId: staged.decision.id };
  };
  if (!meta) return unclear("No validated metadata was read from the file; a person must interpret it.");
  if (JSON.stringify(meta).match(/"tin"\s*:|"ssn"\s*:|"ein"\s*:/i)) return { ok: false, reason: "Refusing to store a TIN/SSN/EIN; record only tinPresent: true." };
  let expiresAt: string | null = doc.expires_at;
  if (doc.doc_type === "coi") {
    const m = meta as Partial<CoiMetadata>;
    if (!m.insurer || !m.policyNumber || !m.effectiveDate || !m.expiryDate || !m.limits) return unclear("COI metadata incomplete (insurer, policy number, limits, effective and expiry dates are required).");
    if (m.expiryDate < today) return { ok: false, reason: `COI expired ${m.expiryDate}; cannot accept as coverage.` };
    expiresAt = m.expiryDate;
  } else if (doc.doc_type === "w9") {
    const m = meta as Partial<W9Metadata>;
    if (m.tinPresent !== true || !m.legalName || m.signed !== true) return unclear("W-9 metadata incomplete (needs tinPresent, legalName, signed).");
  }
  return markAccepted(run, doc, { metadata: meta, reviewerId: human.userId, note: input.note ?? "", expiresAt });
}

type LockedDocument = SubDocumentRow & { sub_name: string };

/** The document row, locked for this transaction, with the sub's name. */
async function lockDocument(run: Run, documentId: number): Promise<LockedDocument | null> {
  const [doc] = await run<LockedDocument>(
    `SELECT ${DOC_COLS.replace(/(^|, )id,/, "$1sub_documents.id,")}, (SELECT name FROM subs s WHERE s.slug = sub_documents.sub_slug) AS sub_name FROM sub_documents WHERE id = $1 FOR UPDATE`,
    [documentId],
  );
  return doc ? { ...doc, id: Number(doc.id), version: Number(doc.version) } : null;
}

/** The one place a document becomes accepted: older copies are superseded,
 *  an accepted COI sets the sub's tracked expiry + coi_status, open requests
 *  are satisfied, and Joe's review to-dos / cards on it are closed. */
async function markAccepted(
  run: Run,
  doc: LockedDocument,
  input: { metadata: Record<string, unknown>; reviewerId: string | null; note: string; expiresAt: string | null },
): Promise<AcceptResult> {
  const [updated] = await run<SubDocumentRow>(
    `UPDATE sub_documents SET status = 'accepted', validated_metadata = $2::jsonb, reviewed_by = $3, reviewed_at = now(), review_note = $4, expires_at = COALESCE($5::date, expires_at), updated_at = now()
      WHERE id = $1 RETURNING ${DOC_COLS}`,
    [doc.id, JSON.stringify(input.metadata), input.reviewerId, input.note, input.expiresAt],
  );
  await run(`UPDATE sub_documents SET status = 'superseded', updated_at = now() WHERE sub_slug = $1 AND doc_type = $2 AND id <> $3 AND status = 'accepted' AND (project_id IS NOT DISTINCT FROM $4)`, [doc.sub_slug, doc.doc_type, doc.id, doc.project_id]);
  // An older copy still waiting on review is moot once a newer one is accepted.
  const stale = await run<{ id: number }>(
    `UPDATE sub_documents SET status = 'superseded', updated_at = now()
      WHERE sub_slug = $1 AND doc_type = $2 AND id <> $3 AND version < $5 AND status IN ('received','under_review') AND (project_id IS NOT DISTINCT FROM $4)
      RETURNING id`,
    [doc.sub_slug, doc.doc_type, doc.id, doc.project_id, doc.version],
  );
  if (doc.doc_type === "coi" && input.expiresAt) {
    await run(
      `UPDATE subs SET coi_expires_at = $2::date, coi_status = CASE WHEN $2::date < CURRENT_DATE THEN 'expired' WHEN $2::date - CURRENT_DATE <= 30 THEN 'expiring' ELSE 'current' END, updated_at = now() WHERE slug = $1`,
      [doc.sub_slug, input.expiresAt],
    );
  }
  const satisfied = await run<{ id: number }>(
    `UPDATE sub_document_requests SET state = 'satisfied', satisfied_by = $3, stop_reason = 'accepted document', next_at = NULL, updated_at = now()
      WHERE sub_slug = $1 AND doc_type = $2 AND state = 'open' AND (project_id IS NULL OR project_id = $4::uuid OR $4::uuid IS NULL) RETURNING id`,
    [doc.sub_slug, doc.doc_type, doc.id, doc.project_id],
  );
  for (const r of satisfied) {
    await run(`UPDATE decisions SET status = 'revoked', decision_note = 'document accepted' WHERE status = 'pending' AND target_kind = 'sub_document_request' AND target_id = $1`, [String(r.id)]);
  }
  await closeReview(run, [doc.id, ...stale.map((s) => Number(s.id))], "document accepted");
  return { ok: true, document: { ...updated, id: Number(updated.id), version: Number(updated.version) }, satisfiedRequestIds: satisfied.map((r) => Number(r.id)) };
}

// ── Joe's review of a portal upload ─────────────────────────────────────────

/** work_items.source_kind / source_id of the review to-do for one document. */
export const REVIEW_SOURCE_KIND = "sub_document";
export const reviewSourceId = (documentId: number) => `subdoc:${documentId}:review`;

/** Close the review to-dos (and any pending review cards) on these documents. */
async function closeReview(run: Run, documentIds: number[], note: string): Promise<void> {
  if (!documentIds.length) return;
  await run(
    `UPDATE work_items SET status = 'done', completed_at = now(), blocked_reason = NULL, updated_at = now()
      WHERE source_kind = $1 AND source_id = ANY($2::text[]) AND status NOT IN ('done','cancelled')`,
    [REVIEW_SOURCE_KIND, documentIds.map(reviewSourceId)],
  );
  await run(
    `UPDATE decisions SET status = 'revoked', decision_note = $2 WHERE status = 'pending' AND target_kind = 'sub_document' AND target_id = ANY($1::text[])`,
    [documentIds.map(String), note],
  );
}

export interface ReceiveInput extends IngestInput {
  /** The sub's current job, linked on Joe's review to-do. The document itself
   *  stays company-level: one COI covers the sub on every job. */
  jobProjectId?: string | null;
  /** files.created_by-style tag for the to-do's "filed by". */
  createdBy?: string;
}

export type ReceiveResult =
  | { ok: true; document: SubDocumentRow; requestIds: number[]; reviewItemId: string | null }
  | Extract<IngestResult, { ok: false }>;

/** A sub-portal upload. The file is recorded as received (ingestSubDocument:
 *  versioned, exceptions kept, the chase paused). A COI then goes
 *  under_review with one to-do for Joe. Nothing about the sub's insurance
 *  status changes here: the expiry date the sub typed is their claim, not
 *  coverage. Only an acceptance (acceptDocument / confirmSubDocument) makes a
 *  COI count, and only a rejection asks the sub again. */
export async function receiveSubDocument(run: Run, input: ReceiveInput): Promise<ReceiveResult> {
  let checksum = input.checksum ?? null;
  if (!checksum) {
    const [f] = await run<{ sha256: string | null }>(`SELECT sha256 FROM files WHERE id = $1`, [input.fileId]);
    checksum = f?.sha256 ?? null;
  }
  const got = await ingestSubDocument(run, { ...input, checksum });
  if (!got.ok) return got;
  if (got.document.doc_type !== "coi") return { ok: true, document: got.document, requestIds: got.requestIds, reviewItemId: null };

  const [doc] = await run<SubDocumentRow>(`UPDATE sub_documents SET status = 'under_review', updated_at = now() WHERE id = $1 RETURNING ${DOC_COLS}`, [got.document.id]);
  const [sub] = await run<{ name: string }>(`SELECT name FROM subs WHERE slug = $1`, [doc.sub_slug]);
  const [job] = input.jobProjectId ? await run<{ id: string; slug: string; name: string }>(`SELECT id, slug, name FROM projects WHERE id = $1`, [input.jobProjectId]) : [];
  const name = sub?.name ?? doc.sub_slug;
  const typed = doc.expires_at ? `typed an expiry date of ${doc.expires_at}` : "did not type an expiry date";
  const body = [
    `${name} uploaded a COI (certificate of insurance) from the sub portal and ${typed}. It does not count as current until you accept it.`,
    `Open the certificate and check the dates and coverage. Then, on the sub's Paperwork tab: Accept it with the expiry date you confirm, or Reject it with a reason (they're asked for a new one).`,
    doc.file_id ? `Certificate: /api/files/${doc.file_id}` : null,
    `Sub: /subs/${doc.sub_slug}`,
    job ? `Job: ${job.name} — /projects/${job.slug}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const [item] = await run<{ id: string }>(
    `INSERT INTO work_items (title, body, status, priority, assignee_kind, assignee_key, project_id, source_kind, source_id, requires_approval, created_by)
     SELECT $1, $2, 'waiting_on_human', 'normal', 'human', 'human-joe', $3, $4, $5, false, $6
      WHERE NOT EXISTS (SELECT 1 FROM work_items WHERE source_kind = $4 AND source_id = $5 AND status NOT IN ('done','cancelled'))
     RETURNING id`,
    [
      `Review ${name}'s COI${doc.expires_at ? ` (says it expires ${doc.expires_at})` : ""}`.slice(0, 200),
      body,
      job?.id ?? null,
      REVIEW_SOURCE_KIND,
      reviewSourceId(Number(doc.id)),
      input.createdBy ?? "sub-docs",
    ],
  );
  return { ok: true, document: { ...doc, id: Number(doc.id), version: Number(doc.version) }, requestIds: got.requestIds, reviewItemId: item?.id ?? null };
}

/** Joe's own reading of a received document: accepted with the expiry date he
 *  confirms (for a COI, required and not in the past). The owner signed in,
 *  not an agent acting for him — this is his word, so it skips the
 *  field-by-field metadata acceptDocument asks of a reviewer; what he
 *  confirmed is recorded as the metadata. */
export async function confirmSubDocument(
  run: Run,
  input: { documentId: number; subSlug?: string | null; expiresAt?: string | null; note?: string; principal: Principal },
): Promise<AcceptResult> {
  const human = input.principal.kind === "user" ? input.principal : null;
  if (!human || human.role !== "owner") return { ok: false, reason: "Only Joe can accept a sub's paperwork here." };
  const doc = await lockDocument(run, input.documentId);
  if (!doc || (input.subSlug && doc.sub_slug !== input.subSlug)) return { ok: false, reason: "No such document." };
  if (doc.status !== "received" && doc.status !== "under_review") return { ok: false, reason: `This document is already ${doc.status}.` };
  const expiresAt = (input.expiresAt ?? "").trim() || null;
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return { ok: false, reason: "Enter the expiry date as a date." };
  if (doc.doc_type === "coi") {
    if (!expiresAt) return { ok: false, reason: "Enter the expiry date shown on the certificate." };
    const today = new Date().toISOString().slice(0, 10);
    if (expiresAt < today) return { ok: false, reason: `That date (${expiresAt}) has already passed — a lapsed COI can't be accepted. Reject it instead.` };
  }
  const metadata = { expiryDate: expiresAt, confirmedByOwner: true, subTypedExpiry: doc.expires_at };
  return markAccepted(run, doc, { metadata, reviewerId: human.userId, note: input.note ?? "", expiresAt });
}

export type RejectResult =
  | {
      ok: true;
      document: SubDocumentRow;
      /** Whether the sub was asked for a new copy, and how. */
      ask:
        | { mode: "sent"; contact: string; intentId: string }
        | { mode: "staged"; contact: string; decisionId: string; reason: string }
        | { mode: "skipped"; reason: string };
    }
  | { ok: false; reason: string };

/** Not accepted, with the reason. The review to-do closes and the sub is asked
 *  for a new copy through requestDocument (sent under the routine policy, or
 *  staged for Joe's OK) — unless another copy is already waiting on review,
 *  or their accepted one is still good, in which case nobody is chased. */
export async function rejectDocument(
  run: Run,
  input: { documentId: number; subSlug?: string | null; reason: string; principal: Principal; at?: Date; askAgain?: boolean },
): Promise<RejectResult> {
  const human = humanOf(input.principal);
  if (!human || (human.role !== "owner" && human.role !== "staff")) return { ok: false, reason: "Only the owner or staff can reject a sub document." };
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) return { ok: false, reason: "Say why it can't be accepted." };
  const doc = await lockDocument(run, input.documentId);
  if (!doc || (input.subSlug && doc.sub_slug !== input.subSlug)) return { ok: false, reason: "No such document." };
  if (doc.status !== "received" && doc.status !== "under_review") return { ok: false, reason: `This document is already ${doc.status}.` };

  const [updated] = await run<SubDocumentRow>(
    `UPDATE sub_documents SET status = 'rejected', exception = $2::jsonb, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${DOC_COLS}`,
    [doc.id, JSON.stringify({ reason: "other", detail: reason }), reason, human.userId],
  );
  await closeReview(run, [doc.id], "document rejected");
  const document = { ...updated, id: Number(updated.id), version: Number(updated.version) };
  if (input.askAgain === false) return { ok: true, document, ask: { mode: "skipped", reason: "Not asked again." } };

  const [waiting] = await run<{ id: number }>(
    `SELECT id FROM sub_documents WHERE sub_slug = $1 AND doc_type = $2 AND id <> $3 AND status = 'under_review' LIMIT 1`,
    [doc.sub_slug, doc.doc_type, doc.id],
  );
  if (waiting) return { ok: true, document, ask: { mode: "skipped", reason: `Another ${DOC_LABEL[doc.doc_type]} from ${doc.sub_name} is already waiting for your review, so they weren't asked again.` } };
  const { requirements } = await detectMissingOrExpiring(run, { subSlugs: [doc.sub_slug], openRequests: false });
  const need = requirements.find((r) => r.docType === doc.doc_type && r.projectId == null);
  if (!need) return { ok: true, document, ask: { mode: "skipped", reason: `${doc.sub_name}'s accepted ${DOC_LABEL[doc.doc_type]} is still good, so they weren't asked again.` } };

  // Re-open (or reuse) the company-level request and resume its chase.
  await run(
    `INSERT INTO sub_document_requests (sub_slug, doc_type, project_id, reason)
     VALUES ($1, $2, NULL, $3)
     ON CONFLICT (sub_slug, doc_type, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE state = 'open' DO NOTHING`,
    [doc.sub_slug, doc.doc_type, need.reason],
  );
  const [req] = await run<{ id: number }>(
    `UPDATE sub_document_requests SET next_at = now(), updated_at = now() WHERE sub_slug = $1 AND doc_type = $2 AND project_id IS NULL AND state = 'open' RETURNING id`,
    [doc.sub_slug, doc.doc_type],
  );
  const asked = await requestDocument(run, {
    requestId: Number(req.id),
    principal: input.principal,
    at: input.at,
    body: draftRequestBody(doc.sub_name, doc.doc_type, need.reason, null, reason),
  });
  if (!asked.ok) return { ok: true, document, ask: { mode: "skipped", reason: asked.reason } };
  if (asked.mode === "sent") return { ok: true, document, ask: { mode: "sent", contact: asked.contact, intentId: asked.intentId } };
  return { ok: true, document, ask: { mode: "staged", contact: asked.contact, decisionId: asked.decision.id, reason: asked.reason } };
}

export interface OwnerSubDocument {
  id: number;
  docType: SubDocType;
  fileId: string | null;
  /** The expiry on the row (typed by the sub, or confirmed by Joe), YYYY-MM-DD. */
  expiresAt: string | null;
  expiresLabel: string | null;
  status: SubDocStatus;
  reviewNote: string;
  when: string;
}

/** The sub's documents with their review status, newest first, plus the
 *  sub's tracked COI status, for the owner's sub page. */
export async function subPaperworkForOwner(
  run: Run,
  subSlug: string,
): Promise<{ coiStatus: string | null; coiExpiresLabel: string | null; documents: OwnerSubDocument[] }> {
  const [sub] = await run<{ coi_status: string; coi_label: string | null }>(
    `SELECT ${coiStatusSql("subs")} AS coi_status, to_char(coi_expires_at, 'FMMon FMDD, YYYY') AS coi_label FROM subs WHERE slug = $1`,
    [subSlug],
  );
  const rows = await run<{ id: number; doc_type: SubDocType; file_id: string | null; expires_at: string | null; expires_label: string | null; status: SubDocStatus; review_note: string; when_label: string }>(
    `SELECT id, doc_type, file_id, expires_at::text AS expires_at, to_char(expires_at, 'FMMon FMDD, YYYY') AS expires_label,
            status, review_note, to_char(created_at, 'FMMon FMDD') AS when_label
       FROM sub_documents WHERE sub_slug = $1
      ORDER BY created_at DESC, id DESC LIMIT 30`,
    [subSlug],
  );
  return {
    coiStatus: sub?.coi_status ?? null,
    coiExpiresLabel: sub?.coi_label ?? null,
    documents: rows.map((r) => ({
      id: Number(r.id),
      docType: r.doc_type,
      fileId: r.file_id,
      expiresAt: r.expires_at,
      expiresLabel: r.expires_label,
      status: r.status,
      reviewNote: r.review_note,
      when: r.when_label,
    })),
  };
}

/** Portal boundary. Owner/staff-with-subs: any. A sub: only its own rows,
 *  and never a restricted row's file through the portal (owner route only). */
export async function canAccessSubDocument(run: Run, principal: Principal, documentId: number, opts: { via: "owner_route" | "portal" }): Promise<{ ok: true; document: SubDocumentRow } | { ok: false; status: 403 | 404; reason: string }> {
  const [doc] = await run<SubDocumentRow>(`SELECT ${DOC_COLS} FROM sub_documents WHERE id = $1`, [documentId]);
  if (!doc) return { ok: false, status: 404, reason: "not found" };
  const human = humanOf(principal);
  if (!human) return { ok: false, status: 403, reason: "no person" };
  if (human.role === "owner") return { ok: true, document: doc };
  if (human.role === "staff") return human.permissions.includes("subs") ? { ok: true, document: doc } : { ok: false, status: 403, reason: "no subs permission" };
  if (human.role === "sub") {
    if (human.linkSlug !== doc.sub_slug) return { ok: false, status: 404, reason: "not found" }; // never confirm another sub's ids exist
    if (opts.via === "portal" && doc.restricted) return { ok: false, status: 403, reason: "restricted document; served only through the owner route" };
    return { ok: true, document: doc };
  }
  return { ok: false, status: 403, reason: "portal role cannot read sub documents" };
}

export async function listOpenRequests(run: Run, opts: { subSlug?: string | null } = {}): Promise<{ id: number; sub_slug: string; doc_type: SubDocType; project_id: string | null; reason: string; attempts: number; next_at: string | null; state: string }[]> {
  const rows = await run<{ id: number; sub_slug: string; doc_type: SubDocType; project_id: string | null; reason: string; attempts: number; next_at: string | null; state: string }>(
    `SELECT id, sub_slug, doc_type, project_id, reason, attempts, next_at::text AS next_at, state FROM sub_document_requests WHERE state = 'open' AND ($1::text IS NULL OR sub_slug = $1) ORDER BY id`,
    [opts.subSlug ?? null],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), attempts: Number(r.attempts) }));
}
