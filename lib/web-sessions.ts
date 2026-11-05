import "server-only";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { pool } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session-window";

export const WEB_SESSION_ISSUER = "sjcos:web";
export const WEB_SESSION_AUDIENCE = "sjcos:web-session";
export type WebSessionIdentity = { sid: string; userId: string; authAt: number; generation: number; exp: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function browserSessionSecretReady(secret = process.env.SESSION_SECRET): boolean {
  return typeof secret === "string" && Buffer.byteLength(secret) >= 32 && !/dev-insecure|change[-_ ]?me|example|development/i.test(secret);
}
/** Only these two review/Watch paths can survive sign-in. Rebuild, never echo. */
export function validateBrowserReturnPath(input: unknown): string | null {
  if (typeof input !== "string" || Buffer.byteLength(input)>256 || /[\\#%\x00-\x20\x7f]/.test(input)) return null;
  if (!input.startsWith('/today?')) return null;
  let u: URL;
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://os.sjcarpentryllc.com').origin;
    u = new URL(input, origin);
    if (u.origin !== origin || u.pathname !== '/today') return null;
  } catch { return null; }
  const keys = [...u.searchParams.keys()];
  if (keys.length < 1 || keys.length > 2 || new Set(keys).size !== keys.length || keys.some(k=>k!=='browser'&&k!=='review')) return null;
  const task = u.searchParams.get('browser'), review = u.searchParams.get('review');
  if (!task || !UUID.test(task) || (review !== null && !UUID.test(review))) return null;
  return `/today?browser=${task.toLowerCase()}${review ? `&review=${review.toLowerCase()}` : ''}`;
}
export async function createWebSession(userId: string, authAt: number, maxAge: number, replacedSid?: string): Promise<WebSessionIdentity> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (replacedSid) await revokeSessionOn(c, replacedSid);
    const exp=authAt+maxAge;
    const {rows}=await c.query(`INSERT INTO web_sessions(user_id,auth_at,expires_at) VALUES($1,to_timestamp($2),to_timestamp($3)) RETURNING id,generation`,[userId,authAt,exp]);
    await c.query('COMMIT');
    return {sid:rows[0].id,userId,authAt,generation:Number(rows[0].generation),exp};
  } catch(e){await c.query('ROLLBACK');throw e;} finally {c.release();}
}
/** Uncached: every privileged request checks the live row and user epoch. */
export async function validateWebSession(identity: WebSessionIdentity): Promise<boolean> {
  if (!UUID.test(identity.sid)||!UUID.test(identity.userId)||!Number.isInteger(identity.generation)||!Number.isFinite(identity.authAt)||!Number.isFinite(identity.exp)||identity.exp<=Date.now()/1000) return false;
  const {rows}=await pool.query(`SELECT s.id FROM web_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND s.user_id=$2 AND s.generation=$3 AND s.auth_at=to_timestamp($4)
      AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active
      AND NOT EXISTS(SELECT 1 FROM session_revocations r WHERE r.user_id=u.id AND r.revoked_before>s.auth_at)`,[identity.sid,identity.userId,identity.generation,identity.authAt]);
  return rows.length===1;
}
export async function verifyWebSessionToken(token: string | undefined, requireBrowserSecret = false): Promise<WebSessionIdentity | null> {
  if (!token || (requireBrowserSecret && !browserSessionSecretReady())) return null;
  try {
    const {payload:p}=await jwtVerify(token,new TextEncoder().encode(process.env.SESSION_SECRET??'dev-insecure-secret-change-me'),{algorithms:['HS256'],issuer:WEB_SESSION_ISSUER,audience:WEB_SESSION_AUDIENCE,requiredClaims:['exp','iat','sid','userId','authAt','generation']});
    const id={sid:p.sid as string,userId:p.userId as string,authAt:p.authAt as number,generation:p.generation as number,exp:p.exp as number};
    return await validateWebSession(id)?id:null;
  } catch {return null;}
}
/** Deliberately no headers()/Authorization path. */
export async function readBrowserCookieSession(): Promise<WebSessionIdentity|null> {
  return verifyWebSessionToken((await cookies()).get(SESSION_COOKIE)?.value,true);
}
export async function renewWebSession(identity: WebSessionIdentity, maxAge: number): Promise<boolean> {
  if (!(await validateWebSession(identity))) return false;
  const {rowCount}=await pool.query(`UPDATE web_sessions SET expires_at=now()+$5*interval '1 second',updated_at=now()
    WHERE id=$1 AND user_id=$2 AND generation=$3 AND auth_at=to_timestamp($4) AND revoked_at IS NULL AND expires_at>now()
      AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND active)
      AND NOT EXISTS(SELECT 1 FROM session_revocations WHERE user_id=$2 AND revoked_before>to_timestamp($4))`,[identity.sid,identity.userId,identity.generation,identity.authAt,maxAge]);
  return rowCount===1;
}
async function revokeSessionOn(c: Pick<import("pg").PoolClient,"query">, sid: string): Promise<void> {
  await c.query(`UPDATE web_sessions SET revoked_at=coalesce(revoked_at,now()),generation=generation+1,updated_at=now() WHERE id=$1`,[sid]);
}
export async function revokeWebSession(sid: string): Promise<void> {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await revokeSessionOn(c,sid);
    await c.query('COMMIT');
  } catch(e){await c.query('ROLLBACK');throw e;} finally {c.release();}
}
