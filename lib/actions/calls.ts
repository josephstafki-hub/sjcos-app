"use server";

// Internal call actions (/calls and the Call button on /messages). Placing
// a call is a client communication, so the user's click goes through
// the grant gate: the click mints a single-use place_call grant for exactly
// this number and lib/voice.ts placeCall spends it. One provider path, always
// audited, for Joe and agents alike.

import { connectionCopy } from "../comms/connection-copy";
import { revalidatePath } from "next/cache";
import type { BackgroundFailure } from "@/lib/background-result";
import { getCurrentUser, can, requireAccess } from "@/lib/dal";
import { createGrant } from "@/lib/owner-grants";
import { normalizeE164 } from "@/lib/comms/phone";
import { getCall, getCallEvents, placeCall, voiceConfigured, type CallRow } from "@/lib/voice";
import { browserCallingConfigured, browserLoginToken } from "@/lib/voice-browser";

export async function placeCallAction(phone: string, contactName?: string | null, via: "cell" | "browser" = "cell"): Promise<{ ok: boolean; callId?: string; error?: string }> {
  const user = await requireAccess("comms");
  if (!voiceConfigured()) {
    return { ok: false, error: connectionCopy("voice").error };
  }
  const norm = normalizeE164(phone);
  if (!norm.ok) return { ok: false, error: norm.error };
  const grant = await createGrant({
    actions: ["place_call"],
    targetKind: "phone",
    targetId: norm.e164,
    scope: { to: norm.e164 },
    reason: "User placed a call from the app",
    requestedBy: user.role === "owner" ? "owner" : `staff:${user.id}`,
    maxUses: 1,
    expiresInMinutes: 5,
  });
  const r = await placeCall({ to: norm.e164, grantId: grant.id, actor: user.role === "owner" ? "owner" : `staff:${user.id}`, caller: { id: user.id, role: user.role as "owner" | "staff" }, contactName, ringBrowser: via === "browser" });
  revalidatePath("/calls");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, callId: r.callId };
}

export interface CallDetail {
  call: CallRow;
  events: { event_type: string; note: string; occurred_at: string | null; created_at: string }[];
}

export async function loadCall(id: string): Promise<CallDetail | null | BackgroundFailure> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "SIGN_IN_AGAIN" };
  if (!can(user, "comms")) return { ok: false, code: "ACCESS_DENIED" };
  return authorizedCallDetail(id, user);
}

/** Explicit call selection keeps the DAL navigation path, including for staff
 *  who do not have Ask. BrowserPhone timers continue to use loadCall. */
export async function loadSelectedCall(id: string): Promise<CallDetail | null> {
  const user = await requireAccess("comms");
  return authorizedCallDetail(id, user);
}

async function authorizedCallDetail(id: string, user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>): Promise<CallDetail | null> {
  const call = await getCall(id, user);

  if (!call) return null;
  const events = await getCallEvents(id);
  return { call, events };
}

/** Log this tab in to the browser phone: a short-lived Telnyx SDK token for
 *  the signed-in user's own credential. */
export async function browserPhoneTokenAction(): Promise<{ ok: boolean; token?: string; error?: string }> {
  const user = await requireAccess("comms");
  if (!voiceConfigured() || !browserCallingConfigured()) return { ok: false, error: "Browser calling is not set up." };
  try {
    return { ok: true, token: await browserLoginToken({ id: user.id, name: user.name }) };
  } catch (err) {
    return { ok: false, error: `Could not start the browser phone: ${(err as Error).message}` };
  }
}
