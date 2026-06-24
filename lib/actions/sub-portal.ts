"use server";

// Sub-portal write paths (Functional-audit item 6). A subcontractor logs their
// day (text + optional photo) and submits a final invoice; both notify Joe and
// scope to the sub's current project. Reads stay in lib/sub-portal.ts.
//
// Identity: a sub always writes as THEMSELVES (slug derived from the session,
// the passed slug ignored); an owner previewing the portal writes as the
// previewed sub. Either way a sub can never write as another sub.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { storeUpload } from "@/lib/upload-store";
import { getSubCurrentProject } from "@/lib/sub-portal";
import { getSub } from "@/lib/subs";

type Result = { ok: boolean; error?: string };

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const parseDollars = (v: FormDataEntryValue | null) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0);
  return n > 0 ? n : 0;
};

/** Resolve the sub the caller may write as: a sub → themselves; an owner →
 *  the previewed slug. Returns null when no sub identity is available. */
async function resolveSubSlug(passedSlug: string): Promise<string | null> {
  const user = await requireRole("owner", "sub");
  const slug = user.role === "sub" ? user.linkSlug : passedSlug;
  return slug || null;
}

async function subName(slug: string): Promise<string> {
  const sub = await getSub(slug);
  return sub?.name ?? slug;
}

/** Record a sub's daily log (text + optional photo), notify Joe. */
export async function submitSubLog(slug: string, formData: FormData): Promise<Result> {
  const subSlug = await resolveSubSlug(slug);
  if (!subSlug) return { ok: false, error: "No sub identity on this account." };

  const body = String(formData.get("body") ?? "").trim();
  const photo = formData.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (!body && !hasPhoto) return { ok: false, error: "Add a note or a photo to log." };

  const project = await getSubCurrentProject(subSlug);

  let photoFileId: string | null = null;
  if (hasPhoto) {
    const stored = await storeUpload(photo, {
      idPrefix: "sublog",
      imagesOnly: true,
      tag: "SUB LOG",
      subtitle: `Sub log · ${await subName(subSlug)}`,
    });
    if (!stored.ok) return { ok: false, error: stored.error };
    photoFileId = stored.id;
  }

  await query(
    `INSERT INTO sub_logs (sub_slug, project_id, body, photo_file_id)
     VALUES ($1, $2, $3, $4)`,
    [subSlug, project?.id ?? null, body, photoFileId],
  );

  const name = await subName(subSlug);
  await emit({
    kind: "job",
    tag: "Sub log",
    accent: "accent",
    icon: "chat",
    title: `${name} logged the day${project ? ` · ${project.name}` : ""}`,
    subline: body ? body.slice(0, 90) : "Photo attached",
    href: `/subs/${subSlug}`,
  });
  revalidatePath("/sub-portal");
  revalidatePath("/notifications");
  return { ok: true };
}

/** Submit a sub's final invoice for the current job, notify Joe. */
export async function submitSubInvoice(slug: string, formData: FormData): Promise<Result> {
  const subSlug = await resolveSubSlug(slug);
  if (!subSlug) return { ok: false, error: "No sub identity on this account." };

  const amount = parseDollars(formData.get("amount"));
  if (amount <= 0) return { ok: false, error: "Enter an invoice amount." };
  const note = String(formData.get("note") ?? "").trim();

  const project = await getSubCurrentProject(subSlug);
  await query(
    `INSERT INTO sub_invoices (sub_slug, project_id, amount, note, status)
     VALUES ($1, $2, $3, $4, 'submitted')`,
    [subSlug, project?.id ?? null, amount, note],
  );

  const name = await subName(subSlug);
  await emit({
    kind: "money",
    tag: "Sub invoice",
    accent: "money",
    icon: "money",
    flagged: true,
    title: `${name} submitted an invoice · ${fmt(amount)}`,
    subline: `${project ? `${project.name} · ` : ""}${note || "Final invoice"}`,
    href: `/subs/${subSlug}`,
  });
  revalidatePath("/sub-portal");
  revalidatePath("/notifications");
  return { ok: true };
}
