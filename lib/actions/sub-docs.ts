"use server";

// Sub compliance-document uploads (Phase-3 execution, 6-docs). A sub uploads
// their W-9 / COI / signed agreement from the portal (or the owner does). A COI
// upload with an expiry date also stamps subs.coi_expires_at, which the reminder
// engine (lib/reminders.ts) already watches for 30/15/5-day expiry alerts.
// Identity mirrors lib/actions/sub-portal.ts: a sub always writes as themselves.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { storeUpload } from "@/lib/upload-store";
import { getSub } from "@/lib/subs";
import { SUB_DOC_LABEL, type SubDocType } from "@/lib/sub-doc-types";

type Result = { ok: boolean; error?: string };

const DOC_TYPES: SubDocType[] = ["w9", "coi", "agreement", "other"];

/** Resolve the sub the caller may write as: a sub → themselves; an owner → the
 *  passed slug. Returns null when no sub identity is available. */
async function resolveSubSlug(passedSlug: string): Promise<string | null> {
  const user = await requireRole("owner", "sub");
  const slug = user.role === "sub" ? user.linkSlug : passedSlug;
  return slug || null;
}

/** Upload a sub compliance document. A COI with an expiry date updates the sub's
 *  coi_expires_at + coi_status (feeding the existing reminder engine). */
export async function uploadSubDocument(slug: string, formData: FormData): Promise<Result> {
  const subSlug = await resolveSubSlug(slug);
  if (!subSlug) return { ok: false, error: "No sub identity on this account." };

  const docTypeRaw = String(formData.get("docType") ?? "other") as SubDocType;
  const docType = DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : "other";
  const expires = String(formData.get("expires") ?? "").trim();

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

  await query(
    `INSERT INTO sub_documents (sub_slug, doc_type, file_id, expires_at)
     VALUES ($1, $2, $3, NULLIF($4, '')::date)`,
    [subSlug, docType, stored.id, expires],
  );

  // A COI with an expiry date refreshes the sub's tracked insurance expiry so
  // the reminder engine picks it up (current / expiring within 30d / expired).
  if (docType === "coi" && expires) {
    await query(
      `UPDATE subs
          SET coi_expires_at = $2::date,
              coi_status = CASE
                WHEN $2::date < CURRENT_DATE THEN 'expired'
                WHEN $2::date - CURRENT_DATE <= 30 THEN 'expiring'
                ELSE 'current' END
        WHERE slug = $1`,
      [subSlug, expires],
    );
  }

  await emit({
    kind: "compliance",
    tag: "Sub doc",
    accent: "accent",
    icon: "shield",
    title: `${name} uploaded a ${SUB_DOC_LABEL[docType]}`,
    subline: expires ? `Expires ${expires}` : "On file",
    href: `/subs/${subSlug}`,
  });

  revalidatePath("/sub-portal");
  revalidatePath(`/subs/${subSlug}`);
  return { ok: true };
}
