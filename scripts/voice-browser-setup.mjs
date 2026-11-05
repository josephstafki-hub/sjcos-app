#!/usr/bin/env node
// One-time Telnyx setup for the browser phone (lib/voice-browser.ts).
//
// Creates — or finds again by name — a credential connection that only
// receives calls from our own Telnyx account (SIP URI calling: internal). Each
// app login gets a telephony credential on it (made lazily by the app), and
// the Call Control app rings a browser by dialing sip:<credential>@sip.telnyx.com.
//
// Prints the connection id. Put it in .env.local as VOICE_WEBRTC_CONNECTION_ID
// and restart the app. Re-running is safe: it reuses the existing connection
// and only re-asserts the settings that matter.
//
//   node scripts/voice-browser-setup.mjs            # uses SMS_API_KEY from env
//   node --env-file=.env.local scripts/voice-browser-setup.mjs

import { randomBytes } from "node:crypto";

const NAME = "SJC OS Browser Phone";
const key = (process.env.SMS_API_KEY || process.env.TELNYX_API_KEY || "").trim();
if (!key) {
  console.error("SMS_API_KEY (Telnyx bearer) is not set.");
  process.exit(1);
}
const base = (process.env.TELNYX_API_BASE ?? "https://api.telnyx.com/v2").replace(/\/$/, "");

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
  return json;
}

const settings = {
  active: true,
  anchorsite_override: "Latency",
  sip_uri_calling_preference: "internal",
  webhook_event_url: null,
  inbound: { codecs: ["OPUS", "G722", "G711U", "G711A"], channel_limit: 5 },
};

const list = await api("GET", `/credential_connections?filter[connection_name][contains]=${encodeURIComponent(NAME)}&page[size]=50`);
let conn = (list?.data ?? []).find((c) => c.connection_name === NAME);
if (conn) {
  await api("PATCH", `/credential_connections/${conn.id}`, settings);
  console.log(`Reused credential connection "${NAME}".`);
} else {
  const out = await api("POST", "/credential_connections", {
    connection_name: NAME,
    // SIP login for the connection itself; never used (browsers log in with
    // per-user telephony credentials), so random and not stored.
    user_name: `sjcosweb${randomBytes(4).toString("hex")}`,
    password: randomBytes(18).toString("base64url"),
    ...settings,
  });
  conn = out.data;
  console.log(`Created credential connection "${NAME}".`);
}
console.log(`VOICE_WEBRTC_CONNECTION_ID=${conn.id}`);
