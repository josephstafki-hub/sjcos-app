import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies, headers } from "next/headers";
import { createWebSession, revokeWebSession, verifyWebSessionToken, WEB_SESSION_ISSUER, WEB_SESSION_AUDIENCE } from "./web-sessions";
import { SESSION_COOKIE as COOKIE, sessionMaxAgeS, type Role } from "./session-window";

// Real web logins mint signed sid cookies backed by web_sessions. Legacy
// cookies/Bearer tokens keep ordinary access until their next real sign-in;
// only a fresh sid cookie may enter Browser. Proxy renews the same sid/authAt.

export type { Role };
export interface SessionPayload extends JWTPayload {
  sid?: string;
  generation?: number;
  userId: string;
  role: Role;
  /** Staff only: the access areas held when the token was minted. proxy.ts
   *  (no DB) uses this copy just to pick their home on a redirect; the real
   *  gating (Shell, requireAccess) re-reads the row every request. */
  perms?: string[];
  /** Seconds-since-epoch the person actually authenticated (A22). Renewals
   *  in proxy.ts carry it forward unchanged, so a session_revocations row
   *  compares against the real login time, not the last re-sign. */
  authAt?: number;
}

const encodedKey = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
);

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload.sid ? { ...payload, iss: WEB_SESSION_ISSUER, aud: WEB_SESSION_AUDIENCE } : payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + sessionMaxAgeS(payload.role))
    .sign(encodedKey);
}

export async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    if (payload.sid && !(await verifyWebSessionToken(token))) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Issue a session cookie for a freshly-authenticated user. The cookie's maxAge
 *  and the JWT's own exp are both driven by sessionMaxAgeS() — they must agree,
 *  or the browser keeps sending a token the server has already stopped
 *  accepting (or worse, drops one the server would still take). */
export async function createSession(userId: string, role: Role, perms?: string[]): Promise<void> {
  const authAt = Math.floor(Date.now() / 1000);
  const replacedSid = await verifiedCookieSid((await cookies()).get(COOKIE)?.value);
  const identity = await createWebSession(userId, authAt, sessionMaxAgeS(role), replacedSid);
  const token = await encrypt({ userId, role, authAt, sid: identity.sid, generation: identity.generation, ...(role === "staff" ? { perms: perms ?? [] } : {}) });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeS(role),
  });
}

/** Ordinary app auth: cookie first; legacy native JWTs remain Bearer-only. */
export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token !== undefined) return decrypt(token);
  const authorization = (await headers()).get("authorization") ?? "";
  const bearer = await decrypt(authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined);
  return bearer?.sid ? null : bearer; // Web sids are never Bearer credentials.
}

/** Read a signed sid without swallowing a registry failure as an invalid token. */
async function verifiedCookieSid(token: string | undefined): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"], issuer: WEB_SESSION_ISSUER, audience: WEB_SESSION_AUDIENCE,
    });
    return typeof payload.sid === "string" ? payload.sid : undefined;
  } catch { return undefined; } // Invalid/legacy credentials have no usable sid.
}

/** Revoke before clearing; a registry outage cannot falsely complete logout. */
export async function deleteSession(): Promise<void> {
  const store = await cookies();
  const sid = await verifiedCookieSid(store.get(COOKIE)?.value);
  if (sid) await revokeWebSession(sid);
  store.delete(COOKIE);
}

export { SESSION_COOKIE } from "./session-window";
