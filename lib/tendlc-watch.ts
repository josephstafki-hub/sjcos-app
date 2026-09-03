import "server-only";

// Daily 10DLC registration watch (app/api/cron/comms-watch, systemd timer).
// Polls the brand (vetting score, status) and campaign (carrier status) the
// registration script created, compares with the last stored snapshot, and
// on ANY change pushes Joe + files a work item. Rejection is loud: the fix is
// editing samples and resubmitting, and every idle day is a day off a
// three-week clock. Polling, not webhooks, on purpose: matches the timer
// pattern, needs no new public endpoint, cannot silently miss a delivery.

import { diffRegistration, registrationSnapshot } from "./comms/tendlc.mjs";
import { tendlcApi } from "./telnyx";
import { notifyOwner } from "./notify-owner";
import { fileCommsWorkItem, getCommsSetting, readTendlcState, setCommsSetting } from "./comms-shared";
import { reportCommsFailure } from "./comms-health";

export interface TendlcWatchResult {
  skipped?: string;
  snapshot?: Record<string, unknown>;
  changes: string[];
  rejected: boolean;
  approved: boolean;
  dryRun: boolean;
}

export async function runTendlcWatch(opts: { dryRun?: boolean } = {}): Promise<TendlcWatchResult> {
  const dryRun = Boolean(opts.dryRun);
  const apiKey = (process.env.TELNYX_API_KEY ?? process.env.SMS_API_KEY ?? "").trim();
  if (!apiKey) return { skipped: "no TELNYX_API_KEY / SMS_API_KEY", changes: [], rejected: false, approved: false, dryRun };
  const state = readTendlcState();
  if (!state?.brandId) return { skipped: "nothing registered yet (no brandId in .10dlc-state.json)", changes: [], rejected: false, approved: false, dryRun };

  let brand: Record<string, unknown>;
  let campaign: Record<string, unknown> | null = null;
  let assignment: Record<string, unknown> | null = null;
  try {
    brand = await tendlcApi.brand(apiKey, state.brandId);
    if (state.campaignId) campaign = await tendlcApi.campaign(apiKey, state.campaignId);
    const firstNumber = Object.keys(state.assignments ?? {})[0];
    if (firstNumber) assignment = await tendlcApi.assignment(apiKey, firstNumber).catch(() => null);
  } catch (err) {
    await reportCommsFailure("tendlc-watch", err, { detail: "Telnyx 10DLC status poll failed", href: "/today" });
    return { skipped: `Telnyx error: ${(err as Error).message}`, changes: [], rejected: false, approved: false, dryRun };
  }

  const snapshot = registrationSnapshot(brand, campaign, assignment) as Record<string, unknown>;
  let prev: Record<string, unknown> | null = null;
  try {
    const raw = await getCommsSetting("comms.tendlc.snapshot");
    prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    prev = null;
  }
  const diff = diffRegistration(prev, snapshot) as { changes: string[]; rejected: boolean; approved: boolean };

  if (!dryRun) {
    await setCommsSetting("comms.tendlc.last_checked_at", new Date().toISOString());
    if (diff.changes.length) await setCommsSetting("comms.tendlc.snapshot", JSON.stringify(snapshot));
  }

  if (diff.changes.length && !dryRun) {
    const reasons = [snapshot.campaignFailureReasons, snapshot.brandFailureReasons, snapshot.assignmentFailureReasons].filter(Boolean).join(" · ");
    const changeText = diff.changes.join("\n");
    if (diff.rejected) {
      await fileCommsWorkItem({
        title: "10DLC registration REJECTED — fix and resubmit today",
        body:
          `Telnyx/TCR rejected part of the registration.\n${reasons ? `Reasons: ${reasons}\n` : ""}\nChanges:\n${changeText}\n\n` +
          `Fix: edit the samples / message flow in lib/comms/tendlc.mjs (or the brand fields in .env.local), then ` +
          `node scripts/register-10dlc.mjs status, and resubmit the failed stage with --force. Every idle day is a day off the carrier clock. [tendlc:rejected]`,
        priority: "urgent",
        status: "waiting_on_human",
        sourceKind: "comms",
        sourceId: "tendlc:rejected",
      });
      await notifyOwner({ kind: "comms", title: "10DLC registration REJECTED — action needed", body: (reasons || changeText).slice(0, 160), href: "/today" });
    } else if (diff.approved) {
      await fileCommsWorkItem({
        title: "10DLC campaign approved — texting is live",
        body:
          `Carriers accepted the campaign.\n\nChanges:\n${changeText}\n\nIf the number is not yet assigned: ` +
          `node scripts/register-10dlc.mjs assign +1XXXXXXXXXX --confirm. Then send a test text from /messages. [tendlc:approved]`,
        priority: "high",
        status: "waiting_on_human",
        sourceKind: "comms",
        sourceId: "tendlc:approved",
      });
      await notifyOwner({ kind: "comms", title: "10DLC campaign approved — SMS is live", body: changeText.slice(0, 160), href: "/messages" });
    } else {
      await fileCommsWorkItem({
        title: "10DLC registration update",
        body: `Changes since the last check:\n${changeText}\n\nRun node scripts/register-10dlc.mjs status for the full picture. [tendlc:update]`,
        priority: "normal",
        status: "waiting_on_human",
        sourceKind: "comms",
        sourceId: "tendlc:update",
      });
      await notifyOwner({ kind: "comms", title: "10DLC registration update", body: changeText.slice(0, 160), href: "/today" });
    }
  }

  return { snapshot, changes: diff.changes, rejected: diff.rejected, approved: diff.approved, dryRun };
}
