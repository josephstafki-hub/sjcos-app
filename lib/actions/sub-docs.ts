"use server";

// Sub compliance-document uploads (Phase-3 execution, 6-docs). A sub uploads
// their W-9 / COI / signed agreement from the portal (or the owner does).
// Receiving a document is not accepting it: a COI lands under review with a
// to-do for Joe, and the expiry date the sub typed is only their claim. The
// sub's coi_status / coi_expires_at (what lib/reminders.ts and the
// coi-expiring detector watch) change only when Joe accepts it — so the
// reminders keep running until then. Joe accepts (with the date he confirms)
// or rejects (with a reason; the sub is asked again) on the sub's page.
// Identity mirrors lib/actions/sub-portal.ts: a sub always writes as themselves.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { storeUpload } from "@/lib/upload-store";
import { getSub } from "@/lib/subs";
import { getSubCurrentProject } from "@/lib/sub-portal";
import { withTransaction, userPrincipal } from "@/lib/commands/db";
import { confirmSubDocument, receiveSubDocument, rejectDocument, type ReceiveResult } from "@/lib/sub-docs";
import { SUB_DOC_LABEL, type SubDocType } from "@/lib/sub-doc-types";

type Result = { ok: boolean; error?: string };

const DOC_TYPES: SubDocType[] = ["w9", "coi", "agreement", "other"];

/** What the sub reads when an upload can't be taken as-is. */
function uploadRefusal(r: Extract<ReceiveResult, { ok: false }>, expires: string): string {
  switch (r.exception) {
    case "expired":
      return `That expiry date (${expires}) has already passed. Upload a current certificate, or fix the date.`;
    case "duplicate":
      return "That exact file is already uploaded.";
    case "unreadable":
      return "That file couldn't be read. Try a clean PDF or photo.";
    default:
      return r.reason;
  }
}

function revalidateSub(slug: string) {
  revalidatePath("/sub-portal");
  revalidatePath("/subs");
  revalidatePath(`/subs/${slug}`);
  revalidatePath("/today");
  revalidatePath("/engine");
}

/** Upload a sub compliance document. A COI goes to Joe for review; it does
 *  NOT change the sub's insurance status (see the header). */
export async function uploadSubDocument(slug: string, formData: FormData): Promise<Result> {
  const user = await requireRole("owner", "sub");
  const subSlug = (user.role === "sub" ? user.linkSlug : slug) || null;
  if (!subSlug) return { ok: false, error: "No sub identity on this account." };

  const docTypeRaw = String(formData.get("docType") ?? "other") as SubDocType;
  const docType = DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : "other";
  const expires = String(formData.get("expires") ?? "").trim();
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { ok: false, error: "Enter the expiry date as a date." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const sub = await getSub(subSlug);
  const name = sub?.name ?? subSlug;

  const stored = await storeUpload(file, {
    idPrefix: "subdoc",
    tag: `SUB DOC · ${SUB_DOC_LABEL[docType]}`,
    subtitle: `${SUB_DOC_LABEL[docType]} · ${name}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const job = await getSubCurrentProject(subSlug);
  const got = await withTransaction((run) =>
    receiveSubDocument(run, {
      subSlug,
      docType,
      fileId: stored.id,
      expiresAt: expires || null,
      jobProjectId: job?.id ?? null,
      source: "sub portal",
      createdBy: "sub-portal",
      principal: userPrincipal(user),
    }),
  );
  if (!got.ok) return { ok: false, error: uploadRefusal(got, expires) };

  const coi = docType === "coi";
  await emit({
    kind: "compliance",
    tag: "Sub doc",
    accent: "accent",
    icon: "shield",
    title: coi ? `${name} uploaded a COI — review it` : `${name} uploaded a ${SUB_DOC_LABEL[docType]}`,
    subline: coi
      ? `${expires ? `Says it expires ${expires} · ` : ""}not current until you accept it`
      : expires
        ? `Expires ${expires}`
        : "On file",
    href: `/subs/${subSlug}`,
  });

  revalidateSub(subSlug);
  return { ok: true };
}

/** Joe accepts a sub's document, with the expiry date he read on it. Only
 *  this makes a COI current. Owner only. */
export async function acceptSubDocument(slug: string, documentId: number, formData: FormData): Promise<Result> {
  const user = await requireRole("owner");
  const expires = String(formData.get("expires") ?? "").trim();
  const r = await withTransaction((run) =>
    confirmSubDocument(run, { documentId, subSlug: slug, expiresAt: expires || null, principal: userPrincipal(user) }),
  );
  if (!r.ok) return { ok: false, error: r.reason };
  revalidateSub(slug);
  return { ok: true };
}

/** Joe rejects a sub's document with a reason; the sub is asked for a new one
 *  (emailed under the routine follow-up policy, or held for his OK). Owner
 *  only. `notice` says what happened to the ask. */
export async function rejectSubDocument(
  slug: string,
  documentId: number,
  formData: FormData,
): Promise<Result & { notice?: string }> {
  const user = await requireRole("owner");
  const reason = String(formData.get("reason") ?? "").trim();
  const r = await withTransaction((run) =>
    rejectDocument(run, { documentId, subSlug: slug, reason, principal: userPrincipal(user) }),
  );
  if (!r.ok) return { ok: false, error: r.reason };
  revalidateSub(slug);
  revalidatePath("/notifications");
  const a = r.ask;
  const notice =
    a.mode === "sent"
      ? `Rejected. An email asking for a new one is going to ${a.contact}.`
      : a.mode === "staged"
        ? `Rejected. The email asking for a new one (to ${a.contact}) is waiting for your OK.`
        : `Rejected. ${a.reason}`;
  return { ok: true, notice };
}
