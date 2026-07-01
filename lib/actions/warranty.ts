"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { emit } from "@/lib/notify";

const PREVIEW_CLIENT_SLUG = "henderson"; // owner previewing the client portal

/** Add `n` weekdays (Mon–Fri) to a date. */
function addWeekdays(start: Date, n: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const g = d.getDay();
    if (g !== 0 && g !== 6) added++;
  }
  return d;
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function insertClaim(opts: {
  projectId: string | null;
  projectName: string;
  clientName: string;
  issue: string;
  source: string;
}) {
  const now = new Date();
  const ack = iso(addWeekdays(now, 5));
  const resolve = iso(new Date(now.getTime() + 30 * 86400_000));
  await query(
    `INSERT INTO warranty_claims
       (project, client, issue, project_id, source, ack_deadline_at, resolve_deadline_at, dot)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, 'accent')`,
    [opts.projectName, opts.clientName, opts.issue, opts.projectId, opts.source, ack, resolve],
  );
  await emit({
    kind: "decision",
    tag: "Warranty",
    accent: "flag",
    icon: "shield",
    flagged: true,
    title: `New warranty claim · ${opts.projectName}`,
    subline: `${opts.issue.slice(0, 90)} — 5-day ack by ${ack}`,
    href: "/warranty",
  });
}

/** Client (or owner previewing) submits a warranty claim from the portal. */
export async function submitWarrantyClaim(
  slug: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("owner", "client");
  const projectSlug = user.role === "owner" ? PREVIEW_CLIENT_SLUG : user.linkSlug;
  if (!projectSlug) return { ok: false, error: "No project linked to this account." };

  const issue = String(formData.get("issue") ?? "").trim();
  if (!issue) return { ok: false, error: "Describe the issue you're seeing." };

  const proj = await queryOne<{ id: string; name: string; client_name: string | null }>(
    `SELECT id, name, client_name FROM projects WHERE slug = $1`,
    [projectSlug],
  );
  if (!proj) return { ok: false, error: "Project not found." };

  await insertClaim({
    projectId: proj.id,
    projectName: proj.name,
    clientName: proj.client_name || user.name || "Client",
    issue,
    source: "portal",
  });
  revalidatePath("/warranty");
  revalidatePath("/client-portal");
  return { ok: true };
}

/** Owner logs a warranty claim manually (phone/email/walk-through). */
export async function createWarrantyClaim(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const slug = String(formData.get("slug") ?? "").trim();
  const issue = String(formData.get("issue") ?? "").trim();
  const source = String(formData.get("source") ?? "manual").trim() || "manual";
  if (!slug) return { ok: false, error: "Pick a project." };
  if (!issue) return { ok: false, error: "Describe the issue." };

  const proj = await queryOne<{ id: string; name: string; client_name: string | null }>(
    `SELECT id, name, client_name FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };

  await insertClaim({
    projectId: proj.id,
    projectName: proj.name,
    clientName: proj.client_name || "Client",
    issue,
    source,
  });
  revalidatePath("/warranty");
  return { ok: true };
}

/** Owner acknowledges a claim (stops the 5-day ack reminder). */
export async function acknowledgeWarrantyClaim(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  await query(`UPDATE warranty_claims SET acknowledged = true WHERE id = $1`, [id]);
  revalidatePath("/warranty");
  return { ok: true };
}

/** Mark a warranty claim resolved (owner-gated). */
export async function resolveWarrantyClaim(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await query(`UPDATE warranty_claims SET resolved = true, acknowledged = true WHERE id = $1`, [id]);
    revalidatePath("/warranty");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
