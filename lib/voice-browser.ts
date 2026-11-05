import "server-only";

// Browser phone: click-to-call with the caller's browser tab as their leg
// instead of their cell. The call flow is unchanged (lib/comms/voice-flow.ts):
// the OS dials the caller FIRST — here sip:<their credential>@sip.telnyx.com,
// which rings the Telnyx WebRTC client in their tab — and once that leg
// answers it records, dials the client and bridges, exactly as for a cell.
// Recording, transcript, AI notes and the grant all stay on the same path.
//
// Each app login gets one Telnyx telephony credential on the credential
// connection VOICE_WEBRTC_CONNECTION_ID, found again by its tag. The browser
// logs in with a short-lived JWT minted from it (never the SIP password).

import { voiceConfig } from "./voice";
import { telephonyCredentials, type TelephonyCredential } from "./telnyx";

const tagFor = (userId: string) => `sjcos-user-${userId}`;
const cache = new Map<string, { id: string; sipUsername: string }>();

export function browserCallingConfigured(): boolean {
  return Boolean(voiceConfig()?.webrtcConnectionId);
}

async function credentialFor(user: { id: string; name?: string | null }): Promise<{ id: string; sipUsername: string }> {
  const cfg = voiceConfig();
  if (!cfg?.webrtcConnectionId) throw new Error("Browser calling is not set up (VOICE_WEBRTC_CONNECTION_ID).");
  const hit = cache.get(user.id);
  if (hit) return hit;
  const tag = tagFor(user.id);
  const resource = `connection:${cfg.webrtcConnectionId}`;
  const mine = (c: TelephonyCredential) => c.tag === tag && !c.expired && (!c.resource_id || c.resource_id === resource);
  let cred = (await telephonyCredentials.listByTag(cfg.apiKey, tag)).find(mine);
  if (!cred) {
    cred = await telephonyCredentials.create(cfg.apiKey, {
      connectionId: cfg.webrtcConnectionId,
      name: `SJC OS browser phone · ${(user.name ?? user.id).trim()}`,
      tag,
    });
  }
  const out = { id: cred.id, sipUsername: cred.sip_username };
  cache.set(user.id, out);
  return out;
}

/** The SIP address the Call Control app dials to ring this user's browser. */
export async function browserSipUri(user: { id: string; name?: string | null }): Promise<string> {
  const c = await credentialFor(user);
  return `sip:${c.sipUsername}@sip.telnyx.com`;
}

/** A login token for the browser SDK. */
export async function browserLoginToken(user: { id: string; name?: string | null }): Promise<string> {
  const cfg = voiceConfig();
  if (!cfg) throw new Error("Voice is not configured.");
  const c = await credentialFor(user);
  try {
    return await telephonyCredentials.token(cfg.apiKey, c.id);
  } catch (err) {
    // Credential deleted on the Telnyx side: forget it and make a new one once.
    if ((err as { status?: number }).status === 404) {
      cache.delete(user.id);
      const again = await credentialFor(user);
      return telephonyCredentials.token(cfg.apiKey, again.id);
    }
    throw err;
  }
}
