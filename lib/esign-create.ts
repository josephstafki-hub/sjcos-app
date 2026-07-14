import "server-only";

// Shared helper: insert a 'sent' signature_request + its audit events, and
// optionally notify the owner. Extracted so both the estimate-based generators
// (lib/actions/documents.ts) and the template drafts (lib/doc-drafts.ts) create
// signable requests the same way. The send path is owner-gated by the callers —
// this helper only writes the row; it does not decide who may call it.

import { query, queryOne } from "./db";
import { emit } from "./notify";
import type { DocType } from "./esign-types";

export interface SentRequestInput {
  projectId: string | null;
  leadSlug?: string | null;
  estimateId?: number | null;
  changeOrderId?: number | null;
  docType: DocType;
  title: string;
  body: string;
  fileId: string | null;
  ownerName: string;
  ownerId: string | null;
  signerName: string;
  signerEmail: string;
  /** Owner notification (skipped when omitted). */
  notify?: { subline: string; href: string };
}

export async function insertSentRequest(o: SentRequestInput): Promise<number> {
  const ins = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, lead_slug, estimate_id, change_order_id, doc_type, title, body,
        file_id, status, signer_name, signer_email, created_by, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',$9,$10,$11, now())
     RETURNING id`,
    [
      o.projectId,
      o.leadSlug ?? null,
      o.estimateId ?? null,
      o.changeOrderId ?? null,
      o.docType,
      o.title,
      o.body,
      o.fileId,
      o.signerName,
      o.signerEmail,
      o.ownerId,
    ],
  );
  const id = Number(ins!.id);
  await query(
    `INSERT INTO signature_events (request_id, kind, actor, detail)
     VALUES ($1, 'created', $2, $3), ($1, 'sent', $2, $4)`,
    [id, o.ownerName, o.title, `Sent to ${o.signerName || o.signerEmail || "client"}`],
  );
  if (o.notify) {
    await emit({
      kind: "decision",
      tag: "Signature",
      icon: "mail",
      accent: "ai",
      title: `Sent for signature: ${o.title}`,
      subline: o.notify.subline,
      href: o.notify.href,
    });
  }
  return id;
}
