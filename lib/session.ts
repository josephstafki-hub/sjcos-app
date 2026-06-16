import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

// Stateless JWT session in an httpOnly cookie (Next 16 recommended pattern).
// Payload holds only the minimum: user id + role. Signed with SESSION_SECRET.

const COOKIE = "sjcos_session";
const MAX_AGE_S = 7 * 24 * 60 * 60; // 7 days

export type Role = "owner" | "sub" | "client";
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
    .setExpirationTime("7d")
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

/** Issue a session cookie for a freshly-authenticated user. */
export async function createSession(userId: string, role: Role): Promise<void> {
  const token = await encrypt({ userId, role });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
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

export const SESSION_COOKIE = COOKIE;
