import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { SESSION_COOKIE as COOKIE, sessionMaxAgeS, type Role } from "./session-window";

// Stateless JWT session in an httpOnly cookie (Next 16 recommended pattern).
// Payload holds only the minimum: user id + role. Signed with SESSION_SECRET.
//
// This file MINTS sessions (portal link traded, or password login). It does not
// renew them — sessions slide, and the renewal happens in proxy.ts, because a
// Server Component cannot write a cookie during render. Lifetimes live in
// lib/session-window.ts so both sides use the same numbers.

export type { Role };
export interface SessionPayload extends JWTPayload {
  userId: string;
  role: Role;
}

const encodedKey = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
);

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + sessionMaxAgeS(payload.role))
    .sign(encodedKey);
}

export async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Issue a session cookie for a freshly-authenticated user. The cookie's maxAge
 *  and the JWT's own exp are both driven by sessionMaxAgeS() — they must agree,
 *  or the browser keeps sending a token the server has already stopped
 *  accepting (or worse, drops one the server would still take). */
export async function createSession(userId: string, role: Role): Promise<void> {
  const token = await encrypt({ userId, role });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeS(role),
  });
}

/** Read + verify the current session cookie (or null). */
export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return decrypt(token);
}

/** Clear the session cookie (logout). */
export async function deleteSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export { SESSION_COOKIE } from "./session-window";
