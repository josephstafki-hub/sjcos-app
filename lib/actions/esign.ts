"use server";

// E-signature write paths. Owner creates + sends a signature request from a
// project; the client signs/declines it in the portal — or, sitting with Joe,
// signs it in person on his device (app/sign/[id]). Signing captures intent
// (consent), the signature (typed name, and/or a hand-drawn PNG), timestamp,
// IP, and UA into an append-only signature_events trail (ESIGN-minded). All
// identity is resolved server-side from the session — a portal user can only
// act on a request scoped to their own project; the in-person path runs under
// the owner's session and records the owner as witness.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { query, queryOne } from "@/lib/db";
import { requireRole, requireAccess } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { logClientActivity, ownerHrefForLinkSlug } from "@/lib/client-activity";
import type { PortalScope } from "@/lib/client-portal";
import { finalizeSignedDraft } from "@/lib/doc-drafts";
import { storeBuffer } from "@/lib/upload-store";
import { parseSignatureDataUrl } from "@/lib/signature-image";
import type { DocType, SigMethod } from "@/lib/esign-types";

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
  const user = await requireAccess("projects");

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
  const user = await requireAccess("projects");
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

interface SignableDoc {
  title: string;
  status: string;
  estimate_id: string | null;
  change_order_id: string | null;
}

/** Verify a request belongs to the given portal scope and is still awaiting
 *  signature. The scope slug is a project slug, or 'lead:<slug>' for a
 *  lead-stage session (matching users.link_slug). Returns the signer-facing
 *  title for messaging. */
async function loadSignable(id: number, slug: string) {
  const leadSlug = slug.startsWith("lead:") ? slug.slice("lead:".length) : null;
  return queryOne<SignableDoc>(
    leadSlug
      ? `SELECT sr.title, sr.status, sr.estimate_id, sr.change_order_id
           FROM signature_requests sr
          WHERE sr.id = $1 AND sr.lead_slug = $2`
      : // A project scope also reaches requests created during its lead stage —
        // the client's link upgraded on conversion, the paperwork didn't move.
        `SELECT sr.title, sr.status, sr.estimate_id, sr.change_order_id
           FROM signature_requests sr
          WHERE sr.id = $1
            AND (sr.project_id = (SELECT id FROM projects WHERE slug = $2)
                 OR sr.lead_slug = (SELECT l.slug FROM leads l
                                      JOIN projects p ON p.lead_id = l.id
                                     WHERE p.slug = $2))`,
    [id, leadSlug ?? slug],
  );
}

/** Owner-side link for a portal scope slug (project, or 'lead:<slug>'). */
function ownerHrefForScope(slug: string): string {
  return ownerHrefForLinkSlug(slug);
}

/** Portal scope object for a scope slug (project, or 'lead:<slug>'). */
function scopeFor(slug: string): PortalScope {
  return slug.startsWith("lead:")
    ? { kind: "lead", slug: slug.slice("lead:".length) }
    : { kind: "project", slug };
}

interface ApplySignatureInput {
  id: number;
  doc: SignableDoc;
  signedName: string;
  method: SigMethod;
  /** Hand-drawn signature PNG (drawn / in-person), or null for a typed name. */
  signatureImage: Buffer | null;
  /** In person: the owner/staff member who presented the device. */
  witnessName: string | null;
  meta: { ip: string; ua: string };
  /** files.project_key for the stored signature image (the project slug). */
  projectKey?: string;
}

/** The binding write, shared by every signing path: keep the drawn signature
 *  (if any) as a file, flip the request to signed with the capture details,
 *  log the event, carry the state to the draft / estimate / change order, and
 *  render the executed copy. Returns false if the request was no longer
 *  awaiting signature — someone else got there first — so nothing was written. */
async function applySignature(o: ApplySignatureInput): Promise<boolean> {
  let signatureFileId: string | null = null;
  if (o.signatureImage) {
    const stored = await storeBuffer(o.signatureImage, {
      filename: `signature-${o.id}.png`,
      mime: "image/png",
      idPrefix: "sig",
      projectKey: o.projectKey,
      tag: "SIGNATURE",
      subtitle: `Drawn signature · ${o.signedName} · ${o.doc.title}`,
    });
    if (stored.ok) signatureFileId = stored.id;
    else console.error(`[esign] signature image not stored for request ${o.id}: ${stored.error}`);
  }

  const r = await query(
    `UPDATE signature_requests
        SET status = 'signed', signed_name = $2, signed_at = now(), consent = true,
            signed_ip = $3, signed_user_agent = $4, signed_method = $5,
            signature_file_id = $6, witness_name = $7
      WHERE id = $1 AND status = 'sent'`,
    [o.id, o.signedName, o.meta.ip, o.meta.ua, o.method, signatureFileId, o.witnessName],
  );
  if (r.rowCount === 0) return false;

  const detail =
    o.method === "in_person"
      ? `Signed "${o.doc.title}" in person on SJ Carpentry's device${o.witnessName ? `, presented by ${o.witnessName}` : ""} (consent given)`
      : o.method === "drawn"
        ? `Signed "${o.doc.title}" with a drawn signature (consent given)`
        : `Signed "${o.doc.title}" (consent given)`;
  await logEvent(o.id, "signed", o.signedName, detail, o.meta);

  // A template draft (Documents tab) keys its status chip off document_drafts,
  // not the signature_request — carry the signed state across so the owner sees
  // "Signed" instead of a stuck "Sent for signature". No-op for legacy
  // estimate-generated requests that have no draft row.
  await query(
    `UPDATE document_drafts SET status = 'signed', updated_at = now()
      WHERE signature_request_id = $1`,
    [o.id],
  );

  // Produce the executed copy (signature stamped in + certificate page). The
  // binding signature is already recorded above, so this is an enhancement of
  // the record, never a gate on it — a render failure must not fail the sign.
  try {
    await finalizeSignedDraft(o.id);
  } catch (err) {
    console.error(`[esign] executed-copy render failed for request ${o.id}:`, err);
  }

  // If this request was generated from an estimate, approve it.
  if (o.doc.estimate_id) {
    await query(
      `UPDATE estimates SET status = 'approved', approved_at = now() WHERE id = $1`,
      [o.doc.estimate_id],
    );
  }
  // If it was a change order, approve it (does NOT touch the contract total).
  if (o.doc.change_order_id) {
    await query(`UPDATE change_orders SET status = 'approved' WHERE id = $1`, [o.doc.change_order_id]);
  }
  return true;
}

/** Client (or owner previewing): sign a sent request in the portal. Typed name
 *  + consent are required; a hand-drawn signature (from the pad) is optional
 *  and, when present, is what gets stamped on the executed copy. */
export async function signSignatureRequest(id: number, formData: FormData): Promise<Result> {
  const user = await requireRole("owner", "client");
  const slug = await portalProjectSlug();
  if (!slug) return { ok: false, error: "No project linked to this account." };

  const signedName = String(formData.get("signedName") ?? "").trim();
  const consent = String(formData.get("consent") ?? "") === "on";
  if (!signedName) return { ok: false, error: "Type your full name to sign." };
  if (!consent) return { ok: false, error: "You must agree to sign electronically." };

  const parsed = parseSignatureDataUrl(formData.get("signatureData"));
  if (parsed && !parsed.ok) return { ok: false, error: parsed.error };
  const signatureImage = parsed?.ok ? parsed.png : null;
  const method: SigMethod = signatureImage ? "drawn" : "typed";

  const doc = await loadSignable(id, slug);
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status !== "sent") return { ok: false, error: "This document is no longer awaiting signature." };

  const meta = await clientMeta();
  const done = await applySignature({
    id,
    doc,
    signedName,
    method,
    signatureImage,
    witnessName: null,
    meta,
    projectKey: slug.startsWith("lead:") ? undefined : slug,
  });
  if (!done) return { ok: false, error: "This document is no longer awaiting signature." };

  // Only a real client signature notifies Joe — owner-preview signing is a
  // test click, not news.
  if (user.role === "client") {
    const how = method === "drawn" ? "signed with a drawn signature" : "signed electronically";
    await emit({
      kind: "decision",
      tag: "Signature",
      icon: "star",
      accent: "money",
      title: `Signed: ${doc.title}`,
      subline: `${signedName} ${how}`,
      href: ownerHrefForLinkSlug(slug, { tab: "Documents", focus: `signature-${id}` }),
    });
    await logClientActivity({
      scope: scopeFor(slug),
      kind: "sign",
      summary: `Signed: ${doc.title}`,
      detail: `Signed electronically as ${signedName}${method === "drawn" ? " (drawn signature)" : ""}`,
      entityKind: "signature",
      entityId: id,
      actorName: user.name || signedName,
      href: ownerHrefForLinkSlug(slug, { tab: "Documents", focus: `signature-${id}` }),
    });
  }

  revalidatePath("/client-portal");
  revalidatePath(ownerHrefForScope(slug));
  return { ok: true };
}

/** Owner/staff device: the client signs in person on the in-person screen
 *  (app/sign/[id]). Runs under the OWNER's session — the client needs no
 *  account — so the record names the logged-in user as the witness who
 *  presented the device, and a drawn signature is required (a typed name alone
 *  is the client's own portal flow, not a wet-ink stand-in). Same binding
 *  write and same downstream effects as a portal signature. */
export async function signInPersonAction(id: number, formData: FormData): Promise<Result> {
  const user = await requireAccess("projects");

  const signedName = String(formData.get("signedName") ?? "").trim();
  const consent = String(formData.get("consent") ?? "") === "on";
  if (!signedName) return { ok: false, error: "Enter the signer's full name." };
  if (!consent) return { ok: false, error: "The signer must agree to sign electronically." };

  const parsed = parseSignatureDataUrl(formData.get("signatureData"));
  if (!parsed) return { ok: false, error: "Draw the signature in the box to sign." };
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const doc = await queryOne<SignableDoc & { project_slug: string | null; lead_slug: string | null }>(
    `SELECT sr.title, sr.status, sr.estimate_id, sr.change_order_id, sr.lead_slug,
            p.slug AS project_slug
       FROM signature_requests sr
       LEFT JOIN projects p ON p.id = sr.project_id
      WHERE sr.id = $1`,
    [id],
  );
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status !== "sent") return { ok: false, error: "This document is no longer awaiting signature." };

  const witness = user.name || "SJ Carpentry";
  const linkSlug = doc.project_slug ?? (doc.lead_slug ? `lead:${doc.lead_slug}` : null);
  const meta = await clientMeta();

  // A request that was emailed earlier and is now being signed on the owner's
  // device: note the hand-over in the trail once, so the certificate reads
  // created → sent → presented in person → signed.
  await query(
    `INSERT INTO signature_events (request_id, kind, actor, ip, user_agent, detail)
     SELECT $1, 'presented', $2, $3, $4, $5
      WHERE NOT EXISTS (SELECT 1 FROM signature_events WHERE request_id = $1 AND kind = 'presented')`,
    [id, witness, meta.ip, meta.ua, `Presented in person by ${witness} for ${signedName} to sign`],
  );

  const done = await applySignature({
    id,
    doc,
    signedName,
    method: "in_person",
    signatureImage: parsed.png,
    witnessName: witness,
    meta,
    projectKey: doc.project_slug ?? undefined,
  });
  if (!done) return { ok: false, error: "This document is no longer awaiting signature." };

  const href = linkSlug
    ? ownerHrefForLinkSlug(linkSlug, { tab: "Documents", focus: `signature-${id}` })
    : "/today";
  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "star",
    accent: "money",
    title: `Signed in person: ${doc.title}`,
    subline: `${signedName} signed on your device · witnessed by ${witness}`,
    href,
  });
  if (linkSlug) {
    await logClientActivity({
      scope: scopeFor(linkSlug),
      kind: "sign",
      summary: `Signed in person: ${doc.title}`,
      detail: `Signed as ${signedName} on SJ Carpentry's device, presented by ${witness}`,
      entityKind: "signature",
      entityId: id,
      actorName: signedName,
      href,
    });
    revalidatePath(ownerHrefForScope(linkSlug));
  }
  revalidatePath("/client-portal");
  revalidatePath(`/sign/${id}`);
  return { ok: true };
}

/** Client (or owner previewing): decline a sent request with a reason. */
export async function declineSignatureRequest(id: number, formData: FormData): Promise<Result> {
  const user = await requireRole("owner", "client");
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

  if (user.role === "client") {
    await emit({
      kind: "decision",
      tag: "Signature",
      icon: "mail",
      accent: "flag",
      flagged: true,
      title: `Declined: ${doc.title}`,
      subline: reason ? reason.slice(0, 120) : "Client declined to sign",
      href: ownerHrefForLinkSlug(slug, { tab: "Documents", focus: `signature-${id}` }),
    });
    await logClientActivity({
      scope: scopeFor(slug),
      kind: "decline",
      summary: `Declined to sign: ${doc.title}`,
      detail: reason || "No reason given",
      entityKind: "signature",
      entityId: id,
      actorName: user.name,
      href: ownerHrefForLinkSlug(slug, { tab: "Documents", focus: `signature-${id}` }),
    });
  }

  revalidatePath("/client-portal");
  revalidatePath(ownerHrefForScope(slug));
  return { ok: true };
}
