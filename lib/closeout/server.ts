import "server-only";

// Next.js binding for lib/closeout: commands over the shared pool with the
// hooks bound. Re-point in one place when the sibling workstreams land:
//   onClientSignoff       → WS-money final invoice (lib/billing)
//   ingestCloseoutActuals → WS-estimating (lib/estimating)

import { command, withTransaction, ownerPrincipalForPolicy } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { notifyOwner } from "@/lib/notify-owner";
import { MN_WARRANTY_TIERS } from "@/lib/warranty-mn";
import type { OwnerAlert } from "@/lib/field/hooks";
import { defaultCloseoutHooks, type CloseoutHooks } from "./hooks";
import { recordWrittenSignoff, confirmCorrectionsBeforeWalkthrough, prepareInternalInspection, scheduleClientWalkthrough } from "./checklist";
import { runDuePostProjectActions, checkInReplyReceived, recordCloseoutActuals } from "./postproject";
import type { CloseoutActuals } from "./hooks";
import { ingestCloseoutActuals as estimatingIngest, type ActualInput } from "@/lib/estimating/learning";

export function boundCloseoutHooks(overrides: Partial<CloseoutHooks> = {}): { hooks: CloseoutHooks; flush: () => Promise<void> } {
  const parked: OwnerAlert[] = [];
  const hooks = defaultCloseoutHooks({
    // WS-estimating: only per-scope, unit-based lines can teach the cost book;
    // project totals stay on closeout_actuals (never a fake per-unit sample).
    ingestCloseoutActuals: async (run, input) => {
      const lines = Array.isArray(input.actuals.lines) ? (input.actuals.lines as ActualInput[]) : [];
      if (!lines.length) return;
      await estimatingIngest(run, input.projectId, lines.map((l) => ({ ...l, source: l.source || "closeout" })), { ingest_revision: input.revision, principal: await ownerPrincipalForPolicy() });
    },
    notifyOwner: async (a) => {
      parked.push(a);
    },
    ...overrides,
  });
  const flush = async () => {
    for (const a of parked.splice(0)) {
      try {
        await notifyOwner({ kind: a.kind, title: a.title, body: a.body, href: a.href });
      } catch (err) {
        console.error("[closeout] owner push failed:", (err as Error).message);
      }
    }
  };
  return { hooks, flush };
}

export async function prepareInternalInspectionCmd(principal: Principal, projectId: string) {
  return command({ name: "closeout.prepare_internal_inspection", requestKey: `closeout_inspect:${projectId}:${Date.now()}`, input: { projectId }, principal }, async ({ run }) => ({
    result: await prepareInternalInspection(run, projectId),
  }));
}

export async function confirmCorrectionsCmd(principal: Principal, projectId: string) {
  return command({ name: "closeout.confirm_corrections", requestKey: `closeout_confirm:${projectId}`, input: { projectId }, principal, authRef: "owner" }, async ({ run }) => ({
    result: await confirmCorrectionsBeforeWalkthrough(run, principal, projectId),
  }));
}

export async function scheduleWalkthroughCmd(principal: Principal, projectId: string, at: string) {
  return command({ name: "closeout.schedule_walkthrough", requestKey: `closeout_walk:${projectId}:${at}`, input: { projectId, at }, principal }, async ({ run }) => ({
    result: await scheduleClientWalkthrough(run, { projectId, at }),
  }));
}

/** Call from the e-sign completion path (WS-money owns lib/actions/esign.ts;
 *  they call this once a doc_type 'completion' request flips to signed). */
export async function recordWrittenSignoffCmd(principal: Principal, signatureRequestId: number) {
  const { hooks, flush } = boundCloseoutHooks();
  return command({ name: "closeout.record_signoff", requestKey: `signoff:${signatureRequestId}`, input: { signatureRequestId }, principal }, async ({ run }) => ({
    result: await recordWrittenSignoff(run, signatureRequestId, hooks),
    afterCommit: [flush],
  }));
}

export async function checkInReplyCmd(principal: Principal, input: { projectId: string; body: string; hasIssue: boolean; messageId: string }) {
  const { hooks, flush } = boundCloseoutHooks();
  return command({ name: "closeout.checkin_reply", requestKey: `checkin_reply:${input.messageId}`, input, principal }, async ({ run }) => ({
    result: await checkInReplyReceived(run, input, hooks),
    afterCommit: [flush],
  }));
}

export async function recordCloseoutActualsCmd(principal: Principal, input: { projectId: string; actuals: CloseoutActuals; reason?: string }) {
  const { hooks } = boundCloseoutHooks();
  return command({ name: "closeout.record_actuals", requestKey: `actuals:${input.projectId}:${JSON.stringify(input.actuals)}`, input, principal }, async ({ run }) => ({
    result: await recordCloseoutActuals(run, input, hooks),
  }));
}

/** Timer body (shares the weekly-summary timer): due post-project sends. */
export async function runPostProjectTick(now = new Date()) {
  const principal = await ownerPrincipalForPolicy();
  const { hooks, flush } = boundCloseoutHooks();
  const out = await withTransaction((run) => runDuePostProjectActions(run, principal, { mnTiers: MN_WARRANTY_TIERS, now }, hooks));
  await flush();
  return { processed: out.length, states: out.map((a) => `${a.kind}:${a.state}`) };
}
