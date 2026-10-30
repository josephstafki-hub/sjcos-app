"use server";

// Server actions behind /engine/decisions (A10). Every resolution goes
// through resolveFromChannel with the SESSION principal (server-derived), so
// the app button, the Telegram button and an MCP answer all resolve the same
// decision row exactly once. After commit: dispatch the intents the
// approval woke, tell the requesting agent when a work item is linked, and
// refresh the Telegram card. Lane kill switches are owner-only.

import { revalidatePath } from "next/cache";
import { sessionPrincipal, withTransaction } from "@/lib/commands/db";
import { authorityFor, getDecision } from "@/lib/commands/decisions";
import { LANES, activatePolicy, disablePolicy, listLanePauses, pauseLane, resumeLane, type Lane } from "@/lib/commands/policies";
import { isOwner } from "@/lib/commands/principal";
import { notifyAgentOwner } from "@/lib/dev-agents";
import { performApprovalEffects } from "./after-approval";
import { runDirect } from "@/lib/commands/db";
import { refreshTelegramCard } from "./notify";
import { holdDecision, resolveFromChannel, revokeDecisionEverywhere, type ResolveFromChannelResult } from "./resolve";

export type DecisionActionResult = { ok: true; reply: string; state: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/engine/decisions");
  revalidatePath("/today");
  revalidatePath("/engine/permissions");
  revalidatePath("/notifications");
}

/** Run what the resolution must do (lib/decisions/after-approval.ts), tell
 *  the requesting agent, refresh the Telegram card. Returns the lines to add
 *  to the reply (what approving actually did). */
async function afterResolve(r: ResolveFromChannelResult): Promise<string | null> {
  if (!r.ok || !r.decision) return null;
  const d = r.decision;
  const lines = await performApprovalEffects(r);
  if (d.work_item_id) {
    const rows = await runDirect<{ title: string; body: string; assignee_key: string | null }>(`SELECT title, body, assignee_key FROM work_items WHERE id = $1`, [d.work_item_id]);
    const w = rows[0];
    if (w) {
      const line = r.code === "approved" ? `Decision "${d.title}" was approved; the linked action is being dispatched by the app — do not send it yourself.` : `Decision "${d.title}" was ${r.code === "changes_requested" ? "sent back for changes" : "rejected"}${d.decision_note ? `: ${d.decision_note}` : "."}`;
      await notifyAgentOwner(d.work_item_id, w.assignee_key, w.title, w.body, undefined, line).catch(() => undefined);
    }
  }
  await refreshTelegramCard(d, lines.join("\n") || null).catch(() => undefined);
  return lines.length ? lines.join(" ") : null;
}

async function resolve(id: string, outcome: "approved" | "rejected" | "changes_requested", note: string | null, contentHash: string | null): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal) return { ok: false, error: "Sign in first." };
  const r = await withTransaction((run) => resolveFromChannel(run, { decisionId: id, contentHash, via: "app", principal, outcome, note }));
  const extra = await afterResolve(r);
  refresh();
  if (!r.ok) return { ok: false, error: r.reply };
  return { ok: true, reply: extra ? `${r.reply} ${extra}` : r.reply, state: r.decision?.status ?? outcome };
}

export async function approveDecisionAction(id: string, contentHash: string | null): Promise<DecisionActionResult> {
  return resolve(id, "approved", null, contentHash);
}

export async function rejectDecisionAction(id: string, note: string | null, contentHash: string | null): Promise<DecisionActionResult> {
  return resolve(id, "rejected", note, contentHash);
}

export async function requestChangesAction(id: string, note: string, contentHash: string | null): Promise<DecisionActionResult> {
  if (!note.trim()) return { ok: false, error: "Say what should change." };
  return resolve(id, "changes_requested", note, contentHash);
}

export async function holdDecisionAction(id: string, hours: number, note?: string | null): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal) return { ok: false, error: "Sign in first." };
  const d = await getDecision(runDirect, id);
  if (!d) return { ok: false, error: "No such decision." };
  const auth = await authorityFor(runDirect, principal, d);
  if (!auth.ok) return { ok: false, error: auth.reason };
  const held = await withTransaction((run) => holdDecision(run, id, hours, principal, note ?? null));
  refresh();
  if (!held) return { ok: false, error: `Cannot hold — already ${d.status}.` };
  return { ok: true, reply: `Held for ${hours} h.`, state: "held" };
}

export async function revokeDecisionAction(id: string, reason: string): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal || !isOwner(principal)) return { ok: false, error: "Owner only." };
  const r = await withTransaction((run) => revokeDecisionEverywhere(run, id, principal, reason.trim() || "Revoked by owner"));
  if (r.ok) {
    const d = await getDecision(runDirect, id);
    if (d) await refreshTelegramCard(d).catch(() => undefined);
  }
  refresh();
  return r.ok ? { ok: true, reply: `Revoked${r.cancelledIntents ? `; ${r.cancelledIntents} pending send${r.cancelledIntents === 1 ? "" : "s"} cancelled` : ""}.`, state: "revoked" } : { ok: false, error: "That decision cannot be revoked (already settled)." };
}

// ── Policies (owner only) ────────────────────────────────────────────────────

/** Turn one policy version on (the active one before it retires). Only Joe;
 *  an agent never activates a policy. */
export async function activatePolicyAction(key: string, version: number): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal || !isOwner(principal)) return { ok: false, error: "Owner only." };
  const p = await withTransaction((run) => activatePolicy(run, key, Math.trunc(version)));
  refresh();
  if (!p) return { ok: false, error: `No version ${version} of "${key}".` };
  return { ok: true, reply: `"${key}" is on (version ${p.version}). Anything held waiting for it goes out on the next dispatch pass.`, state: "active" };
}

export async function disablePolicyAction(key: string): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal || !isOwner(principal)) return { ok: false, error: "Owner only." };
  const n = await withTransaction((run) => disablePolicy(run, key));
  refresh();
  return n ? { ok: true, reply: `"${key}" is off. Its automatic actions now wait for you instead.`, state: "disabled" } : { ok: false, error: `"${key}" wasn't on.` };
}

// ── Lane kill switches (owner only) ──────────────────────────────────────────

export async function pauseLaneAction(lane: string, reason: string): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal || !isOwner(principal)) return { ok: false, error: "Owner only." };
  if (!(LANES as readonly string[]).includes(lane)) return { ok: false, error: `Unknown lane "${lane}".` };
  await withTransaction((run) => pauseLane(run, lane as Lane, `owner:${principal.name}`, reason.trim() || "paused by owner"));
  refresh();
  return { ok: true, reply: `Lane "${lane}" paused. Nothing new dispatches on it; anything already unknown stays held for reconciliation.`, state: "paused" };
}

export async function resumeLaneAction(lane: string): Promise<DecisionActionResult> {
  const principal = await sessionPrincipal();
  if (!principal || !isOwner(principal)) return { ok: false, error: "Owner only." };
  if (!(LANES as readonly string[]).includes(lane)) return { ok: false, error: `Unknown lane "${lane}".` };
  const ok = await withTransaction((run) => resumeLane(run, lane as Lane));
  refresh();
  return ok ? { ok: true, reply: `Lane "${lane}" resumed; held sends wake on the next dispatch pass.`, state: "open" } : { ok: false, error: "That lane was not paused." };
}

export async function listLanePausesAction(): Promise<{ lane: string; paused_at: string; paused_by: string; reason: string }[]> {
  return listLanePauses(runDirect);
}
