"use server";

// Owner-only pricing setup actions (A15 "pricing setup" — rates, markup,
// margin target, default allowances, uncertainty rules). Proposals are
// evidence-backed drafts; ACTIVATION is a markup decision the owner resolves
// on the spot (recorded) — never an agent, never a staff member.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { userPrincipal, withTransaction } from "@/lib/commands/db";
import { proposePricingSetup, updatePricingSetupDraft, activatePricingSetup, type PricingSetupConfig } from "./setup";

type Result = { ok: true; info?: string } | { ok: false; error: string };

export async function proposePricingSetupAction(notes: string): Promise<Result> {
  const user = await requireRole("owner");
  try {
    const row = await withTransaction((run) => proposePricingSetup(run, userPrincipal(user), { notes }));
    revalidatePath("/settings/pricing");
    return { ok: true, info: `Draft v${row.version} proposed from the cost book and closed jobs; unsupported values are left empty with a reason.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updatePricingDraftAction(version: number, patch: Partial<PricingSetupConfig>): Promise<Result> {
  const user = await requireRole("owner");
  try {
    await withTransaction((run) => updatePricingSetupDraft(run, version, patch, userPrincipal(user)));
    revalidatePath("/settings/pricing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function activatePricingSetupAction(version: number): Promise<Result> {
  const user = await requireRole("owner");
  try {
    const r = await withTransaction((run) => activatePricingSetup(run, version, userPrincipal(user), "app"));
    revalidatePath("/settings/pricing");
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, info: r.state === "active" ? `v${version} is now the active pricing setup (decision ${r.decision_id.slice(0, 8)} recorded). Sent offers are unchanged.` : `Activation staged as a decision (${r.decision_id.slice(0, 8)}) — approve it on /engine/decisions.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
