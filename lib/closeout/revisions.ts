// Immutable document revisions (A17 / DESIGN "Maintain immutable design/
// document versions"). A signed or released artifact is pinned by content
// hash. Editing it creates a NEW revision; anything bound to the old hash
// (a decision's artifact_revision / content_hash, an intent) is invalid.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { getDecision } from "../commands/decisions.ts";

export type DocKind = "signature_request" | "document_draft" | "plan_design_version" | "marketing_draft" | "weekly_summary";

export interface DocumentRevision {
  id: string;
  doc_kind: string;
  doc_id: string;
  revision: number;
  content_hash: string;
  pinned_by: string;
  pinned_at: string;
}

const COLS = `id, doc_kind, doc_id, revision, content_hash, pinned_by, pinned_at::text AS pinned_at`;

/** Pin `content` as the current revision. Same content → same revision (no
 *  new row). Changed content → next revision number. */
export async function pinRevision(run: Run, docKind: DocKind, docId: string | number, content: unknown, pinnedBy: string): Promise<{ revision: DocumentRevision; created: boolean }> {
  const hash = hashInput(content);
  const id = String(docId);
  const [existing] = await run<DocumentRevision>(`SELECT ${COLS} FROM document_revisions WHERE doc_kind = $1 AND doc_id = $2 AND content_hash = $3`, [docKind, id, hash]);
  if (existing) return { revision: existing, created: false };
  const [row] = await run<DocumentRevision>(
    `INSERT INTO document_revisions (doc_kind, doc_id, revision, content_hash, pinned_by)
     VALUES ($1, $2, COALESCE((SELECT max(revision) FROM document_revisions WHERE doc_kind = $1 AND doc_id = $2), 0) + 1, $3, $4)
     RETURNING ${COLS}`,
    [docKind, id, hash, pinnedBy],
  );
  return { revision: row, created: true };
}

export async function currentRevision(run: Run, docKind: DocKind, docId: string | number): Promise<DocumentRevision | null> {
  const [row] = await run<DocumentRevision>(`SELECT ${COLS} FROM document_revisions WHERE doc_kind = $1 AND doc_id = $2 ORDER BY revision DESC LIMIT 1`, [docKind, String(docId)]);
  return row ?? null;
}

export async function listRevisions(run: Run, docKind: DocKind, docId: string | number): Promise<DocumentRevision[]> {
  return run<DocumentRevision>(`SELECT ${COLS} FROM document_revisions WHERE doc_kind = $1 AND doc_id = $2 ORDER BY revision`, [docKind, String(docId)]);
}

/** Artifact revision label a decision/intent binds to. */
export function revisionRef(r: DocumentRevision): string {
  return `${r.doc_kind}:${r.doc_id}:rev${r.revision}:${r.content_hash.slice(0, 12)}`;
}

/** Is this hash still the CURRENT revision of the document? */
export async function revisionIsCurrent(run: Run, docKind: DocKind, docId: string | number, contentHash: string): Promise<boolean> {
  const cur = await currentRevision(run, docKind, docId);
  return !!cur && cur.content_hash === contentHash;
}

/** A decision bound to a document revision is valid only while that revision
 *  is current. Returns the reason when it is not. */
export async function decisionBindsCurrentRevision(run: Run, decisionId: string, docKind: DocKind, docId: string | number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const d = await getDecision(run, decisionId);
  if (!d) return { ok: false, reason: "No such decision." };
  const cur = await currentRevision(run, docKind, docId);
  if (!cur) return { ok: false, reason: "Document has no pinned revision." };
  if (d.artifact_revision !== revisionRef(cur)) return { ok: false, reason: `Decision was for ${d.artifact_revision ?? "an unpinned revision"}; the document is now ${revisionRef(cur)}. A fresh decision is required.` };
  return { ok: true };
}

/** Pin a signed signature_request by its signed content (body + file + signer). */
export async function pinSignedSignatureRequest(run: Run, signatureRequestId: number): Promise<DocumentRevision> {
  const [sr] = await run<{ id: string; body: string; file_id: string | null; signed_name: string | null; signed_at: string | null; status: string; title: string }>(
    `SELECT id, body, file_id, signed_name, signed_at::text AS signed_at, status, title FROM signature_requests WHERE id = $1`,
    [signatureRequestId],
  );
  if (!sr) throw new Error("No such signature request.");
  if (sr.status !== "signed") throw new Error("Only a signed document is pinned by signature.");
  const { revision } = await pinRevision(run, "signature_request", sr.id, { title: sr.title, body: sr.body, fileId: sr.file_id, signedName: sr.signed_name, signedAt: sr.signed_at }, `signature:${sr.id}`);
  return revision;
}
