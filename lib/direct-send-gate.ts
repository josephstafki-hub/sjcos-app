// The checks every email that bypasses the dispatcher must still pass (Tier 4).
// Five older paths send straight through Gmail instead of an action intent:
// bid follow-ups, newsletter drip, the signature-request email, the portal
// "new on your dashboard" note and the lead first response. They skipped the
// lane kill switches and the opt-out list, so a paused lane or an
// unsubscribed address could still get mail. Each now asks here first.
//
// ambiguousSendError: an error after the request may have reached Gmail
// (timeout, reset, 5xx). Callers that would retry on their own must not, or
// the person gets it twice; they record "unknown outcome" for Joe instead.
//
// Pure: `run` only.

import type { Run } from "./commands/core.ts";
import { laneOpen, type Lane } from "./commands/policies.ts";

export async function directSendBlocked(run: Run, input: { lane: Lane; to: string }): Promise<string | null> {
  const lane = await laneOpen(run, input.lane);
  if (!lane.open) return `Sending is paused (${lane.lane} lane: ${lane.reason}).`;
  const to = input.to.trim().toLowerCase();
  const [opt] = await run<{ reason: string }>(`SELECT reason FROM communication_optouts WHERE channel = 'email' AND address = $1 AND revoked_at IS NULL LIMIT 1`, [to]);
  if (opt) return `${to} asked not to get email${opt.reason ? ` (${opt.reason})` : ""}.`;
  return null;
}

export const UNKNOWN_OUTCOME = "unknown outcome";

export function ambiguousSendError(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err).toLowerCase();
  const code = String((err as { code?: string })?.code ?? "").toUpperCase();
  const status = Number((err as { status?: number; response?: { status?: number } })?.status ?? (err as { response?: { status?: number } })?.response?.status ?? 0);
  return (
    ["ETIMEDOUT", "ECONNRESET", "ESOCKETTIMEDOUT", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET"].includes(code) ||
    status >= 500 ||
    /timed? ?out|socket hang up|econnreset|network error|aborted/.test(m)
  );
}
