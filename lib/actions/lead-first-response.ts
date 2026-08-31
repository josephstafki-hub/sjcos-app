"use server";

// Owner controls for the same-day first response card on the lead page
// (lib/lead-first-response.ts). Every action is owner-gated; sending here is
// the owner's own send — no agent grant involved.

import { revalidatePath } from "next/cache";
import { queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import {
  dismissLeadFirstResponse,
  draftLeadFirstResponseAs,
  getLeadFirstResponse,
  runLeadFirstResponse,
  sendLeadFirstResponse,
  type FirstResponseBranch,
  type LeadFirstResponse,
} from "@/lib/lead-first-response";

type Result = { ok: true; response: LeadFirstResponse | null } | { ok: false; error: string };

async function reload(slug: string): Promise<Result> {
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
  return { ok: true, response: await getLeadFirstResponse(slug) };
}

/** Send the staged draft, with whatever edits Joe made in the card. */
export async function sendFirstResponseAction(slug: string, subject: string, body: string): Promise<Result> {
  await requireRole("owner");
  const r = await sendLeadFirstResponse(slug, { auto: false, subject, body });
  if (!r.ok) return { ok: false, error: r.error };
  return reload(slug);
}

export async function dismissFirstResponseAction(slug: string): Promise<Result> {
  await requireRole("owner");
  const ok = await dismissLeadFirstResponse(slug);
  if (!ok) return { ok: false, error: "Nothing to dismiss (already sent?)." };
  return reload(slug);
}

/** Re-run the classify + draft from scratch (model call; ~30s on local Qwen). */
export async function redraftFirstResponseAction(slug: string): Promise<Result> {
  await requireRole("owner");
  const lead = await queryOne<{ id: string }>(`SELECT id FROM leads WHERE slug = $1`, [slug]);
  if (!lead) return { ok: false, error: "Lead not found." };
  const outcome = await runLeadFirstResponse(lead.id, { force: true });
  if (outcome.status === "claimed_elsewhere") return { ok: false, error: "A draft is already in progress." };
  if (outcome.status === "skipped") return { ok: false, error: `Skipped: ${outcome.reason}` };
  if (outcome.status === "failed") return { ok: false, error: outcome.reason };
  return reload(slug);
}

/** Joe picks the branch by hand (human-review holds, or to override the read). */
export async function draftFirstResponseAsAction(
  slug: string,
  branch: Exclude<FirstResponseBranch, "human_review">,
): Promise<Result> {
  await requireRole("owner");
  if (!["rough_estimate", "missing_info", "discovery_call"].includes(branch)) {
    return { ok: false, error: "Unknown branch." };
  }
  const r = await draftLeadFirstResponseAs(slug, branch);
  if (!r.ok) return { ok: false, error: r.error };
  return reload(slug);
}
