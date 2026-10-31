import "server-only";

// W08: the client accepted the formal estimate, so the construction agreement
// is drafted from it right away (the "contract" template, filled from that
// estimate) and printed. Sending it is a client-facing send:
//   - with the contract.send_on_acceptance policy ACTIVE, it goes out for
//     signature now (WORKFLOW W08: the accepted offer covers this exact
//     derived document; the contract approval gate still applies);
//   - otherwise it waits on Documents and Joe is told it's ready to send.
// Idempotent: a project that already has a live contract draft or a sent /
// signed contract gets nothing new. Never throws to the caller.

import { query, queryOne } from "@/lib/db";
import type { Run } from "@/lib/commands/core";
import { activePolicy } from "@/lib/commands/policies";
import { createDocDraft, renderDocDraft, submitDocDraftForSignature } from "@/lib/doc-drafts";
import { notifyOwner } from "@/lib/notify-owner";

export const AGREEMENT_POLICY = "contract.send_on_acceptance";

const run: Run = async (sql, params) => (await query(sql, params)).rows as never;

export type AgreementOutcome =
  | { done: "skipped"; why: string }
  | { done: "drafted"; draftId: number; note: string }
  | { done: "sent"; draftId: number; signatureRequestId: number };

export async function prepareAgreementOnAcceptance(signatureRequestId: number): Promise<AgreementOutcome> {
  const sr = await queryOne<{ project_id: string | null; estimate_id: number | null; status: string; slug: string | null; job: string | null; client: string | null }>(
    `SELECT s.project_id, s.estimate_id::int AS estimate_id, s.status, p.slug, p.name AS job, p.client_name AS client
       FROM signature_requests s LEFT JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
    [signatureRequestId],
  );
  if (!sr || sr.status !== "signed" || !sr.project_id || !sr.slug || !sr.estimate_id) return { done: "skipped", why: "not a signed project estimate" };
  const est = await queryOne<{ kind: string }>(`SELECT kind FROM estimates WHERE id = $1`, [sr.estimate_id]);
  if (est?.kind !== "formal") return { done: "skipped", why: "not the formal estimate" };
  const existing = await queryOne<{ n: number }>(
    `SELECT (SELECT count(*) FROM document_drafts WHERE project_id = $1 AND template_key = 'contract' AND status <> 'void')
          + (SELECT count(*) FROM signature_requests WHERE project_id = $1 AND doc_type = 'contract' AND status IN ('sent','signed'))::int AS n`,
    [sr.project_id],
  );
  if (Number(existing?.n ?? 0) > 0) return { done: "skipped", why: "a construction agreement already exists" };

  const who = sr.client?.trim() || sr.job || sr.slug;
  const href = `/projects/${sr.slug}?tab=Documents`;
  const tell = async (title: string, body: string) => {
    await notifyOwner({ kind: "approval_needed", title, body, href }).catch((err) => console.error("[W08] notify failed:", (err as Error).message));
  };

  const created = await createDocDraft("contract", { slug: sr.slug, estimateId: sr.estimate_id }, { createdVia: "workflow:W08", createdBy: null });
  if (!created.ok) {
    await tell(`Construction agreement not drafted · ${who}`, `${who} accepted the estimate, but the agreement couldn't be drafted: ${created.error}`);
    return { done: "skipped", why: created.error };
  }
  if (created.missing.length) {
    const note = `Fill in: ${created.missing.join(", ")}.`;
    await tell(`Construction agreement drafted · ${who}`, `${who} accepted the estimate. The agreement is on Documents. ${note}`);
    return { done: "drafted", draftId: created.id, note };
  }
  const rendered = await renderDocDraft(created.id);
  if (!rendered.ok) {
    const note = `It didn't print: ${rendered.error}`;
    await tell(`Construction agreement drafted · ${who}`, `${who} accepted the estimate. The agreement is on Documents. ${note}`);
    return { done: "drafted", draftId: created.id, note };
  }
  if (!(await activePolicy(run, AGREEMENT_POLICY))) {
    await tell(`Construction agreement ready to send · ${who}`, `${who} accepted the estimate. The agreement is printed on Documents; send it for signature from there.`);
    return { done: "drafted", draftId: created.id, note: "ready to send (policy off)" };
  }
  const owner = await queryOne<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role = 'owner' AND active = true ORDER BY created_at LIMIT 1`);
  const sent = await submitDocDraftForSignature(created.id, { id: owner?.id ?? null, name: owner?.name || "Owner" });
  if (!sent.ok) {
    await tell(`Construction agreement ready to send · ${who}`, `${who} accepted the estimate. The agreement is printed on Documents but didn't go out: ${sent.error}`);
    return { done: "drafted", draftId: created.id, note: sent.error };
  }
  await query(`INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, href) VALUES ('job', 'Contract', 'accent', 'mail', $1, $2, 'Just now', $3)`, [
    `Construction agreement sent to ${who} for signature`,
    "Sent automatically after they accepted the estimate (policy contract.send_on_acceptance).",
    href,
  ]);
  return { done: "sent", draftId: created.id, signatureRequestId: sent.signatureRequestId };
}
