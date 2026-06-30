import "server-only";

// E-signature read layer. Signature requests are project-scoped; the owner
// curates + sends them from the project "Sign-offs" tab, the client signs them
// in the portal. Writes live in lib/actions/esign.ts.

import { query } from "./db";
import type {
  DocType,
  SigStatus,
  SignatureRequestView,
  SignatureEventView,
} from "./esign-types";

function dateLabel(d: Date | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

interface SigRow {
  id: string;
  doc_type: DocType;
  title: string;
  body: string;
  file_id: string | null;
  status: SigStatus;
  signer_name: string;
  signer_email: string;
  signed_name: string | null;
  signed_at: Date | null;
  decline_reason: string | null;
  created_at: Date;
  sent_at: Date | null;
}

// Qualified with the sr alias so the joined queries (projects also has id /
// status / created_at) aren't ambiguous. All three reads alias the table sr.
const SIG_SELECT = `
  sr.id, sr.doc_type, sr.title, sr.body, sr.file_id, sr.status, sr.signer_name,
  sr.signer_email, sr.signed_name, sr.signed_at, sr.decline_reason,
  sr.created_at, sr.sent_at`;

function rowToView(r: SigRow): SignatureRequestView {
  return {
    id: Number(r.id),
    docType: r.doc_type,
    title: r.title,
    body: r.body,
    fileId: r.file_id,
    status: r.status,
    signerName: r.signer_name,
    signerEmail: r.signer_email,
    signedName: r.signed_name,
    signedAtLabel: dateLabel(r.signed_at),
    declineReason: r.decline_reason,
    createdAtLabel: dateLabel(r.created_at) ?? "",
    sentAtLabel: dateLabel(r.sent_at),
  };
}

/** All signature requests for a project (owner view, newest first). */
export async function getProjectSignatureRequests(
  slug: string,
): Promise<SignatureRequestView[]> {
  const { rows } = await query<SigRow>(
    `SELECT ${SIG_SELECT}
       FROM signature_requests sr
       JOIN projects p ON p.id = sr.project_id
      WHERE p.slug = $1
      ORDER BY sr.created_at DESC`,
    [slug],
  );
  return rows.map(rowToView);
}

/** Non-draft, non-void requests a client sees in their portal (to sign + history). */
export async function getClientSignatures(
  slug: string,
): Promise<SignatureRequestView[]> {
  const { rows } = await query<SigRow>(
    `SELECT ${SIG_SELECT}
       FROM signature_requests sr
       JOIN projects p ON p.id = sr.project_id
      WHERE p.slug = $1
        AND sr.status IN ('sent','signed','declined')
      ORDER BY (sr.status = 'sent') DESC, sr.created_at DESC`,
    [slug],
  );
  return rows.map(rowToView);
}

/** Prefill the signer name/email for a project's request form: the project's
 *  client_name + the linked client account's email (if any). */
export async function getProjectSignerDefaults(
  slug: string,
): Promise<{ name: string; email: string }> {
  const { rows } = await query<{ client_name: string | null; email: string | null }>(
    `SELECT p.client_name, u.email
       FROM projects p
       LEFT JOIN users u ON u.role = 'client' AND u.link_slug = p.slug
      WHERE p.slug = $1`,
    [slug],
  );
  return { name: rows[0]?.client_name ?? "", email: rows[0]?.email ?? "" };
}

/** A single request plus its audit trail (owner detail). */
export async function getSignatureRequest(
  id: number,
): Promise<{ request: SignatureRequestView; events: SignatureEventView[] } | null> {
  const { rows } = await query<SigRow>(
    `SELECT ${SIG_SELECT} FROM signature_requests sr WHERE sr.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;

  const { rows: ev } = await query<{
    kind: SignatureEventView["kind"];
    actor: string;
    detail: string;
    created_at: Date;
  }>(
    `SELECT kind, actor, detail, created_at
       FROM signature_events WHERE request_id = $1 ORDER BY created_at`,
    [id],
  );

  return {
    request: rowToView(rows[0]),
    events: ev.map((e) => ({
      kind: e.kind,
      actor: e.actor,
      detail: e.detail,
      atLabel: dateLabel(e.created_at) ?? "",
    })),
  };
}
