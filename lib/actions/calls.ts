"use server";

// Owner-side call actions (/calls and the Call button on /messages). Placing
// a call is a client communication, so even the owner's click goes through
// the grant gate: the click mints a single-use place_call grant for exactly
// this number and lib/voice.ts placeCall spends it. One provider path, always
// audited, for Joe and agents alike.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { createGrant } from "@/lib/owner-grants";
import { normalizeE164 } from "@/lib/comms/phone";
import { getCall, getCallEvents, placeCall, voiceConfigured, voiceStatus, type CallRow } from "@/lib/voice";

export async function placeCallAction(phone: string, contactName?: string | null): Promise<{ ok: boolean; callId?: string; error?: string }> {
  await requireRole("owner");
  if (!voiceConfigured()) {
    const s = voiceStatus();
    return { ok: false, error: s.enabled ? `Voice is misconfigured: ${s.problems.join("; ")}` : "Voice is not connected yet." };
  }
  const norm = normalizeE164(phone);
  if (!norm.ok) return { ok: false, error: norm.error };
  const grant = await createGrant({
    actions: ["place_call"],
    targetKind: "phone",
    targetId: norm.e164,
    scope: { to: norm.e164 },
    reason: "Owner placed a call from the app",
    requestedBy: "owner",
    maxUses: 1,
    expiresInMinutes: 5,
  });
  const r = await placeCall({ to: norm.e164, grantId: grant.id, actor: "owner", contactName });
  revalidatePath("/calls");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, callId: r.callId };
}

export interface CallDetail {
  call: CallRow;
  events: { event_type: string; note: string; occurred_at: string | null; created_at: string }[];
}

export async function loadCall(id: string): Promise<CallDetail | null> {
  await requireRole("owner");
  const call = await getCall(id);
  if (!call) return null;
  const events = await getCallEvents(id);
  return { call, events };
}
