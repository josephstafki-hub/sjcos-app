"use server";

// E-signature write paths (Phase-1 foundation). Owner creates + sends a
// signature request from a project; the client signs/declines it in the portal.
// Signing captures intent (consent), the typed signature, timestamp, IP, and UA
// into an append-only signature_events trail (ESIGN-minded). All identity is
// resolved server-side from the session — a portal user can only act on a
// request scoped to their own project.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import type { DocType } from "@/lib/esign-types";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const PREVIEW_CLIENT_SLUG = "henderson"; // owner previewing the client portal

const DOC_TYPE_VALUES: DocType[] = [
  "design",
  "estimate",
  "contract",
  "sow",
  "change_order",
  "other",
];

async function clientMeta(): Promise<{ ip: string; ua: string }> {
  const h = await headers();
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "";
  return { ip, ua: h.get("user-agent") ?? "" };
}

async function logEvent(
  requestId: number,
  kind: string,
  actor: string,
  detail = "",
  meta?: { ip: string; ua: string },
) {
  await query(
    `INSERT INTO signature_events (request_id, kind, actor, ip, user_agent, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, kind, actor, meta?.ip ?? null, meta?.ua ?? null, detail],
  );
}

/** Owner: create a signature request from a project and send it to the client.
 *  Bound as <form action={createSignatureRequest.bind(null, slug)}>. */
export async function createSignatureRequest(
  slug: string,
  formData: FormData,
): Promise<Result> {
  const user = await requireRole("owner");

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const docTypeRaw = String(formData.get("docType") ?? "other") as DocType;
  const docType = DOC_TYPE_VALUES.includes(docTypeRaw) ? docTypeRaw : "other";
  const signerName = String(formData.get("signerName") ?? "").trim();
  const signerEmail = String(formData.get("signerEmail") ?? "").trim();

  if (!title) return { ok: false, error: "A title is required." };
  if (!body) return { ok: false, error: "Add the document text to be signed." };

  const proj = await queryOne<{ id: string }>(
    `SELECT id FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, doc_type, title, body, status, signer_name, signer_email,
        created_by, sent_at)
     VALUES ($1, $2, $3, $4, 'sent', $5, $6, $7, now())
     RETURNING id`,
    [proj.id, docType, title, body, signerName, signerEmail, user.id],
  );
  const id = Number(inserted!.id);

  await logEvent(id, "created", user.name || "Owner", title);
  await logEvent(id, "sent", user.name || "Owner", `Sent to ${signerName || signerEmail || "client"}`);

  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "mail",
    accent: "ai",
    title: `Signature requested: ${title}`,
    subline: `${signerName || "Client"} — awaiting signature`,
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true, id };
}

/** Owner: void a request (cancel before it's signed). */
export async function voidSignatureRequest(slug: string, id: number): Promise<Result> {
  const user = await requireRole("owner");
  const r = await query(
    `UPDATE signature_requests SET status = 'void'
      WHERE id = $1 AND status IN ('draft','sent')`,
    [id],
  );
  if (r.rowCount === 0) return { ok: false, error: "Only unsigned requests can be voided." };
  await logEvent(id, "voided", user.name || "Owner");
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true };
}

/** Resolve the project slug the current portal user is scoped to. */
async function portalProjectSlug(): Promise<string | null> {
  const user = await requireRole("owner", "client");
  return user.role === "owner" ? PREVIEW_CLIENT_SLUG : user.linkSlug ?? null;
}

/** Verify a request belongs to the given project slug and is still awaiting
 *  signature. Returns the signer-facing title for messaging. */
async function loadSignable(id: number, slug: string) {
  return queryOne<{ title: string; status: string; estimate_id: string | null; change_order_id: string | null }>(
    `SELECT sr.title, sr.status, sr.estimate_id, sr.change_order_id
       FROM signature_requests sr
       JOIN projects p ON p.id = sr.project_id
      WHERE sr.id = $1 AND p.slug = $2`,
    [id, slug],
  );
}

/** Client (or owner previewing): sign a sent request. */
export async function signSignatureRequest(id: number, formData: FormData): Promise<Result> {
  const user = await requireRole("owner", "client");
  const slug = await portalProjectSlug();
  if (!slug) return { ok: false, error: "No project linked to this account." };

  const signedName = String(formData.get("signedName") ?? "").trim();
  const consent = String(formData.get("consent") ?? "") === "on";
  if (!signedName) return { ok: false, error: "Type your full name to sign." };
  if (!consent) return { ok: false, error: "You must agree to sign electronically." };

  const doc = await loadSignable(id, slug);
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status !== "sent") return { ok: false, error: "This document is no longer awaiting signature." };

  const meta = await clientMeta();
  await query(
    `UPDATE signature_requests
        SET status = 'signed', signed_name = $2, signed_at = now(),
            consent = true, signed_ip = $3, signed_user_agent = $4
      WHERE id = $1 AND status = 'sent'`,
    [id, signedName, meta.ip, meta.ua],
  );
  await logEvent(id, "signed", signedName, `Signed "${doc.title}" (consent given)`, meta);

  // If this request was generated from an estimate, approve it.
  if (doc.estimate_id) {
    await query(
      `UPDATE estimates SET status = 'approved', approved_at = now() WHERE id = $1`,
      [doc.estimate_id],
    );
  }
  // If it was a change order, approve it (does NOT touch the contract total).
  if (doc.change_order_id) {
    await query(`UPDATE change_orders SET status = 'approved' WHERE id = $1`, [doc.change_order_id]);
  }

  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "star",
    accent: "money",
    title: `Signed: ${doc.title}`,
    subline: `${signedName} signed electronically`,
    href: `/projects/${slug}`,
  });

  revalidatePath("/client-portal");
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Client (or owner previewing): decline a sent request with a reason. */
export async function declineSignatureRequest(id: number, formData: FormData): Promise<Result> {
  await requireRole("owner", "client");
  const slug = await portalProjectSlug();
  if (!slug) return { ok: false, error: "No project linked to this account." };

  const reason = String(formData.get("reason") ?? "").trim();
  const doc = await loadSignable(id, slug);
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status !== "sent") return { ok: false, error: "This document is no longer awaiting signature." };

  const meta = await clientMeta();
  await query(
    `UPDATE signature_requests SET status = 'declined', decline_reason = $2 WHERE id = $1 AND status = 'sent'`,
    [id, reason || "No reason given"],
  );
  await logEvent(id, "declined", doc.title, reason || "No reason given", meta);

  // If generated from an estimate, mark it declined so the owner can revise.
  if (doc.estimate_id) {
    await query(`UPDATE estimates SET status = 'declined' WHERE id = $1`, [doc.estimate_id]);
  }
  // If it was a change order, mark it declined so the owner can revise/resend.
  if (doc.change_order_id) {
    await query(`UPDATE change_orders SET status = 'declined' WHERE id = $1`, [doc.change_order_id]);
  }

  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "mail",
    accent: "flag",
    flagged: true,
    title: `Declined: ${doc.title}`,
    subline: reason ? reason.slice(0, 120) : "Client declined to sign",
    href: `/projects/${slug}`,
  });

  revalidatePath("/client-portal");
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}
