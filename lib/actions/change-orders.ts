"use server";

// Change-order write paths (Phase-3 execution, 7-co). Owner-gated. A CO is drafted
// in the project Money tab's "Change orders" section, then sent for signature through the same
// e-sign foundation as estimates/contracts (signature_requests, change_order_id
// link). Signing/declining flips the CO status via lib/actions/esign.ts. Money is
// CENTS. Reads stay in lib/change-orders.ts. Does NOT touch the project contract
// total (Phase-3 decision — owner manages that number).

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { getProjectSignerDefaults } from "@/lib/esign";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import { renderInlineDocPdf } from "@/lib/documents";
import { storeBuffer } from "@/lib/upload-store";
import { coDollarsToCents, fmtCoUsd } from "@/lib/co-types";

type Result = { ok: true; id?: number } | { ok: false; error: string };

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
}

/** Owner: create a draft change order on a project. */
export async function createChangeOrder(slug: string, formData: FormData): Promise<Result> {
  const user = await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "A title is required." };
  const description = String(formData.get("description") ?? "").trim();
  const priceCents = coDollarsToCents(String(formData.get("price") ?? ""));

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO change_orders (project_id, title, description, price_cents, status, created_by)
     VALUES ($1, $2, $3, $4, 'draft', $5)
     RETURNING id`,
    [project.id, title, description, priceCents, user.id],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: Number(ins!.id) };
}

/** Owner: on-demand Qwen draft of the CO scope description. Returns text for the
 *  UI to drop into the textarea (grounds on the title + optional notes; never
 *  invents dollar amounts). Falls back to a plain stub on any AI failure. */
export async function draftChangeOrder(slug: string, title: string, notes: string): Promise<string> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  const { answer } = await ai.ask({
    prompt:
      `Write a concise, professional change-order scope description (2–4 sentences) ` +
      `for a residential carpentry/remodel project. Describe the added or changed work ` +
      `clearly for a homeowner. Do NOT include dollar amounts or a signature line.\n\n` +
      `Change order: ${title}\n${notes ? `Notes: ${notes}` : ""}`,
    context: project ? `Project: ${project.name}` : undefined,
  });
  return answer.trim();
}

/** Owner: send a change order to the client for e-signature. Renders the CO to a
 *  signable body, creates a 'change_order' signature request linked back to the
 *  CO, sets the CO status to 'sent', and notifies. */
export async function sendChangeOrder(slug: string, id: number): Promise<Result> {
  const user = await requireRole("owner");

  const co = await queryOne<{
    id: string;
    project_id: string;
    project_name: string;
    title: string;
    description: string;
    price_cents: number;
    status: string;
  }>(
    `SELECT co.id, co.project_id, p.name AS project_name, co.title, co.description,
            co.price_cents, co.status
       FROM change_orders co JOIN projects p ON p.id = co.project_id
      WHERE co.id = $1 AND p.slug = $2`,
    [id, slug],
  );
  if (!co) return { ok: false, error: "Change order not found." };
  if (co.status === "sent") return { ok: false, error: "This change order is already out for signature." };
  if (co.status === "approved") return { ok: false, error: "This change order is already approved." };

  const body = [
    `CHANGE ORDER — ${co.title}`,
    co.project_name,
    "",
    co.description || "(No scope description provided.)",
    "",
    `Change-order amount: ${fmtCoUsd(co.price_cents)}`,
    "",
    "By signing, you approve this change to the scope of work and the associated price. " +
      "This amount is in addition to your original contract.",
  ].join("\n");

  const signer = await getProjectSignerDefaults(slug);

  // Attach the letterhead PDF so the portal shows a printable document, not
  // just body text. Best-effort — body-only if rendering fails.
  let fileId: string | null = null;
  const pdf = await renderInlineDocPdf({
    title: co.title || "Change order",
    subtitle: co.project_name,
    body,
  }).catch(() => null);
  if (pdf) {
    const stored = await storeBuffer(pdf, {
      filename: `${co.title || "Change order"}.pdf`,
      mime: "application/pdf",
      idPrefix: "sig",
      projectKey: slug,
      tag: "CHANGE ORDER",
      subtitle: "Change order — sent for signature",
    });
    if (stored.ok) fileId = stored.id;
  }

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, change_order_id, doc_type, title, body, file_id, status, signer_name, signer_email, created_by, sent_at)
     VALUES ($1, $2, 'change_order', $3, $4, $5, 'sent', $6, $7, $8, now())
     RETURNING id`,
    [co.project_id, id, co.title, body, fileId, signer.name, signer.email, user.id],
  );
  const reqId = Number(ins!.id);

  await query(
    `INSERT INTO signature_events (request_id, kind, actor, detail)
     VALUES ($1, 'created', $2, $3), ($1, 'sent', $2, $4)`,
    [reqId, user.name || "Owner", co.title, `Sent to ${signer.name || signer.email || "client"}`],
  );

  await query(`UPDATE change_orders SET status = 'sent' WHERE id = $1`, [id]);

  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "mail",
    accent: "ai",
    title: `Change order sent for approval: ${co.title}`,
    subline: `${fmtCoUsd(co.price_cents)} — awaiting client signature`,
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true };
}

/** Owner: delete a change order (drafts + declined only — sent/approved are kept
 *  for the audit trail; void the signature request first if needed). */
export async function deleteChangeOrder(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  const r = await query(
    `DELETE FROM change_orders co
       USING projects p
      WHERE co.id = $1 AND co.project_id = p.id AND p.slug = $2
        AND co.status IN ('draft','declined')`,
    [id, slug],
  );
  if (r.rowCount === 0) return { ok: false, error: "Only draft or declined change orders can be deleted." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}
