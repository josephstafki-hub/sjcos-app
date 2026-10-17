"use server";

// Owner-grant write paths: approve/deny/revoke a request, or mint a grant by
// hand for any MCP client. Owner-only — this IS the owner approving a send.
// Reads + the consume path stay in lib/owner-grants.ts.

import { revalidatePath } from "next/cache";
import { captureAgentMemory } from "@/lib/agent-memory";
import { requireRole } from "@/lib/dal";
import { ACTION_TARGET_KIND, createGrant, decideGrant, GATED_ACTIONS, type GatedAction } from "@/lib/owner-grants";
import { ACTION_LABEL } from "@/lib/owner-grant-types";
import { runDirect } from "@/lib/commands/db";
import { getDecision } from "@/lib/commands/decisions";
import { refreshTelegramCard } from "@/lib/decisions/notify";
import { dispatchIntentsNow } from "@/lib/dispatch/db";
import { runStagedGrant } from "@/lib/grant-execution";

type Result = { ok: true; id?: string; message?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/engine/permissions");
  revalidatePath("/engine/decisions");
  revalidatePath("/notifications");
}

/** Approve a permission request — and do what it asked. Sends parked on the
 *  grant are dispatched now, and a request that carries its send (scope.
 *  staged) is performed (lib/grant-execution.ts). The reply says what went
 *  out; the Telegram card is edited to match. */
export async function approveGrant(id: string): Promise<Result> {
  await requireRole("owner");
  const g = await decideGrant(id, "approved");
  if (!g) return { ok: false, error: "That request is no longer pending." };
  const lines: string[] = [];
  const woke = (g as typeof g & { wokeIntentIds?: string[] }).wokeIntentIds ?? [];
  if (woke.length) {
    const outcomes = await dispatchIntentsNow(woke).catch(() => []);
    const sent = outcomes.filter((o) => o.responseClass === "accepted" || o.responseClass === "confirmed").length;
    if (sent) lines.push(`Sent ✓ (${sent}).`);
  }
  const staged = await runStagedGrant(g.id);
  if (staged.ran && staged.line) lines.push(staged.line);
  if (g.decision_id) {
    const d = await getDecision(runDirect, g.decision_id).catch(() => null);
    if (d) await refreshTelegramCard(d, lines.join("\n") || null).catch(() => undefined);
  }
  refresh();
  return { ok: true, id: g.id, message: lines.length ? `Approved. ${lines.join(" ")}` : "Approved — the agent can send it now." };
}

export async function denyGrant(id: string, note?: string): Promise<Result> {
  await requireRole("owner");
  const g = await decideGrant(id, "denied");
  if (!g) return { ok: false, error: "That request is no longer pending." };
  if (g.decision_id) {
    const d = await getDecision(runDirect, g.decision_id).catch(() => null);
    if (d) await refreshTelegramCard(d, "Declined in the app — nothing was sent.").catch(() => undefined);
  }
  // W5 learning layer: a denial is a preference signal — park it for review.
  const action = g.actions.includes("*")
    ? "any send"
    : g.actions.map((a) => ACTION_LABEL[a as keyof typeof ACTION_LABEL] ?? a).join(", ");
  const to = typeof g.scope?.to === "string" ? ` to ${g.scope.to}` : "";
  const target = g.target_id ? `${g.target_kind ?? "target"} ${g.target_id}${to}` : to.trim() || "no target";
  const trimmedNote = note?.trim();
  await captureAgentMemory({
    summary: `Send denied: ${action} — ${target}`,
    content: [
      `${g.requested_by} asked for permission: ${action} — ${target}.`,
      g.reason ? `Agent's reason: ${g.reason}` : null,
      `Denied by Joe.`,
      trimmedNote ? `Joe's note: ${trimmedNote}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    memoryType: "preference",
    runtimeName: g.requested_by,
    refs: [
      { kind: "grant", id: g.id, label: `Permission request (${action})` },
      ...(g.target_id
        ? [{ kind: g.target_kind ?? "target", id: g.target_id, label: target }]
        : []),
    ],
  });
  refresh();
  return { ok: true, id: g.id };
}

export async function revokeGrant(id: string): Promise<Result> {
  await requireRole("owner");
  const g = await decideGrant(id, "revoked");
  if (!g) return { ok: false, error: "That grant can't be revoked (already spent or decided)." };
  refresh();
  return { ok: true, id: g.id };
}

/** Mint a grant by hand. `actions` is one gated action or '*'. */
export async function createGrantAction(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const action = String(formData.get("action") ?? "").trim();
  if (action !== "*" && !(GATED_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: "Pick an action." };
  }
  const targetId = String(formData.get("target_id") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  const maxUses = Math.max(1, Math.min(Number(formData.get("max_uses") || 1), 100));
  const hours = Math.max(0.25, Math.min(Number(formData.get("hours") || 24), 24 * 7));
  try {
    const g = await createGrant({
      actions: [action],
      targetId: targetId || null,
      targetKind: targetId && action !== "*" ? ACTION_TARGET_KIND[action as GatedAction] : null,
      scope: to ? { to } : {},
      reason: String(formData.get("reason") ?? "").trim() || "Granted by Joe on /engine/permissions",
      requestedBy: "owner",
      maxUses,
      expiresInMinutes: Math.round(hours * 60),
      status: "approved",
    });
    refresh();
    return { ok: true, id: g.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
