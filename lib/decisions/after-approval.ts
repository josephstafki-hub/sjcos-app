import "server-only";

// What a resolution must DO once its transaction has committed, shared by
// every owner channel: the Telegram webhook, the /engine/decisions buttons,
// the corner approval popup and /engine/permissions. One place, so an Approve
// tap has the same effect wherever Joe makes it:
//   • dispatch the sends the approval woke (and say how they went),
//   • email a first-draw invoice the approval created,
//   • perform a permission request's staged send (lib/grant-execution.ts),
//   • send the one email an approved release card covers (bid package to a
//     sub, pricing request to a supplier).
// Returns plain lines for the reply / toast / Telegram card edit.

import { sendApprovedRelease } from "@/lib/bidding";
import { emailApprovedInvoice } from "@/lib/billing/server";
import { dispatchIntentsNow } from "@/lib/dispatch/db";
import { runStagedGrant } from "@/lib/grant-execution";
import type { ResolveFromChannelResult } from "./resolve";

export async function performApprovalEffects(r: ResolveFromChannelResult): Promise<string[]> {
  if (!r.ok || !r.decision) return [];
  const lines: string[] = [];
  if (r.code === "approved" && r.intentIds.length) {
    try {
      const outcomes = await dispatchIntentsNow(r.intentIds);
      const sent = outcomes.filter((o) => o.responseClass === "accepted" || o.responseClass === "confirmed").length;
      const unsure = outcomes.filter((o) => o.responseClass === "unknown").length;
      const failed = outcomes.filter((o) => o.responseClass !== "accepted" && o.responseClass !== "confirmed" && o.responseClass !== "unknown");
      if (sent) lines.push(`Sent ✓ (${sent} send${sent === 1 ? "" : "s"}).`);
      if (unsure) lines.push(`${unsure} send${unsure === 1 ? "" : "s"} not confirmed by the provider — held for a check, not resent.`);
      if (failed.length) lines.push(`Not sent yet: ${failed[0].error ?? failed[0].responseClass}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}. ${failed.some((o) => o.responseClass === "retryable") ? "It retries on its own." : ""}`.trim());
    } catch (err) {
      console.error("[decisions] dispatch after approval failed (sweep will retry):", (err as Error).message);
      lines.push("Approved; the send is queued and goes out on the next dispatch pass.");
    }
  }
  if (r.code === "approved" && r.invoice) {
    try {
      const extra = await emailApprovedInvoice(r.invoice, r.decision.id);
      if (extra) lines.push(extra);
    } catch (err) {
      console.error("[decisions] invoice email after approval failed:", (err as Error).message);
      lines.push("The invoice was created but the email step failed; send it from the project's invoices.");
    }
  }
  if (r.code === "approved" && r.decision.kind === "package_release") {
    try {
      lines.push(await sendApprovedRelease(r.decision));
    } catch (err) {
      console.error("[decisions] release send after approval failed:", (err as Error).message);
      lines.push(`Approved, but the email step failed: ${(err as Error).message}`);
    }
  }
  if (r.code === "approved" && r.grantId) {
    const staged = await runStagedGrant(r.grantId);
    if (staged.ran && staged.line) lines.push(staged.line);
  }
  return lines;
}
