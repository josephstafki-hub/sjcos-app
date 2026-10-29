// "Connect to QuickBooks" (Intuit OAuth 2.0 authorization-code flow).
//
// Replaces the OAuth Playground: the owner clicks Connect on Settings ›
// Accounting, signs in at Intuit, picks the company, and lands back on
// /api/qbo/oauth/callback with a one-time code that is exchanged here for the
// refresh token. CSRF: start() mints a random `state`, kept only in an
// httpOnly cookie scoped to /api/qbo/oauth. The callback refuses to exchange a
// code unless the returned state matches it (constant-time compare).
//
// Pure over fetch + crypto. No Next imports, so tests drive it directly.

import { randomBytes, timingSafeEqual } from "node:crypto";

export const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

/** Cookie holding the CSRF state between start and callback. */
export const QBO_STATE_COOKIE = "sjcos_qbo_oauth_state";
export const QBO_OAUTH_PATH = "/api/qbo/oauth";
/** Ten minutes to finish signing in at Intuit. */
export const QBO_STATE_MAX_AGE_S = 600;

/** The public address of the app. Behind nginx, `request.url` reads the
 *  internal listener (https://localhost:3017), so every redirect a browser
 *  follows must be built from this, never from the request. */
export function qboAppBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").trim().replace(/\/$/, "");
}

/** The callback address. It must be listed under Redirect URIs for BOTH the
 *  Development and the Production keys in the Intuit developer portal. */
export function qboRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${qboAppBase(env)}${QBO_OAUTH_PATH}/callback`;
}

export function newOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time state check. Missing on either side = mismatch. */
export function statesMatch(expected: string | null | undefined, got: string | null | undefined): boolean {
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return `${INTUIT_AUTHORIZE_URL}?${q.toString()}`;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/** Trade the one-time code for tokens. Throws with Intuit's error text. */
export async function exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(input.clientId, input.clientSecret), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Intuit token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.refresh_token || !j.access_token) throw new Error("Intuit token exchange returned no refresh token");
  return { refreshToken: j.refresh_token, accessToken: j.access_token, expiresIn: j.expires_in ?? 3600 };
}

/** Revoke a refresh token. This ends the app's access to the company. Intuit
 *  answers 200 on success and 400 for a token it no longer knows. Both mean
 *  the token is dead, so both count as done. */
export async function revokeToken(input: { clientId: string; clientSecret: string; token: string }): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(INTUIT_REVOKE_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(input.clientId, input.clientSecret), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token: input.token }),
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.status === 200 || res.status === 400, status: res.status };
}
