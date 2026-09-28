import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { query, queryOne } from "./db";

// WHOSE MAILBOX a Gmail call is acting on.
//
// SJC OS started with exactly one mailbox: GMAIL_REFRESH_TOKEN in .env.local,
// Joe's account, used by every code path. Once staff can log in that is wrong
// twice over — a team member would read Joe's mail, and would have no way to
// reach their own. Joe's rule (2026-09-27): "link able to their email
// otherwise blank."
//
// So a Gmail call now happens inside a mailbox scope. lib/gmail.ts reads the
// scope when it builds its OAuth client, which is why ~20 exported functions
// and their call sites did not have to grow a parameter each.
//
//   in a scope with a token   → that person's mailbox
//   in a scope with none      → NOTHING. Not the mock, not Joe's mail. The
//                               Email rail renders blank with a Connect button.
//   no scope at all           → the owner's mailbox (env fallback). This is
//                               every background path: detectors, the lead
//                               thread sync, cron sweeps, MCP send_email. They
//                               are the company acting, not a person, and they
//                               must keep working exactly as before.
//
// A row in user_email_accounts always wins over the env var, including for the
// owner — so Joe can re-link from the UI — but the env var stays his fallback,
// which is what keeps live prod connected through this change with no re-auth.

export interface Mailbox {
  /** Google refresh token, or null when this user has nothing linked. */
  refreshToken: string | null;
  /** The address it belongs to, for display. Null when nothing is linked. */
  email: string | null;
  /** users.id whose mailbox this is, or null for the company/env default. */
  userId: string | null;
  /** True when the token came from user_email_accounts rather than the env. */
  linked: boolean;
}

const store = new AsyncLocalStorage<Mailbox>();

/** The mailbox for the call in progress, or undefined outside any scope (i.e.
 *  background work, which lib/gmail.ts resolves to the env token). */
export function activeMailbox(): Mailbox | undefined {
  return store.getStore();
}

/** Run `fn` with `mb` as the active mailbox for its whole async subtree. */
export function runWithMailbox<T>(mb: Mailbox, fn: () => Promise<T>): Promise<T> {
  return store.run(mb, fn);
}

/** Just enough of a login to resolve a mailbox. Deliberately structural rather
 *  than an import of CurrentUser: lib/gmail.ts depends on this module, and
 *  lib/dal reaches for next/headers, which has no business in that chain. */
export interface MailboxViewer {
  id: string;
  role: string;
}

/** The mailbox a given login acts through. Staff get theirs or nothing; the
 *  owner gets theirs, falling back to the env token so an owner who has never
 *  used the Connect button still reads the mailbox prod is wired to. */
export async function mailboxFor(viewer: MailboxViewer): Promise<Mailbox> {
  const row = await queryOne<{ email: string; refresh_token: string }>(
    `SELECT email, refresh_token FROM user_email_accounts WHERE user_id = $1`,
    [viewer.id],
  );
  if (row) {
    return { refreshToken: row.refresh_token, email: row.email, userId: viewer.id, linked: true };
  }
  if (viewer.role === "owner" && process.env.GMAIL_REFRESH_TOKEN) {
    return {
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      email: process.env.GMAIL_ACCOUNT_EMAIL ?? null,
      userId: viewer.id,
      linked: false,
    };
  }
  return { refreshToken: null, email: null, userId: viewer.id, linked: false };
}

/** Enter `viewer`'s mailbox for the duration of `fn`. Re-entrant: if a scope is
 *  already active (an action calling into a builder that also scopes) the
 *  existing one is kept rather than re-resolved. */
export async function withMailboxFor<T>(viewer: MailboxViewer, fn: () => Promise<T>): Promise<T> {
  const current = activeMailbox();
  if (current && current.userId === viewer.id) return fn();
  return runWithMailbox(await mailboxFor(viewer), fn);
}

/** Store (or replace) a user's linked mailbox. */
export async function linkMailbox(userId: string, email: string, refreshToken: string): Promise<void> {
  await query(
    `INSERT INTO user_email_accounts (user_id, email, refresh_token, connected_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
       SET email = EXCLUDED.email,
           refresh_token = EXCLUDED.refresh_token,
           connected_at = now()`,
    [userId, email, refreshToken],
  );
}

/** Forget a user's linked mailbox. The owner falls back to the env token. */
export async function unlinkMailbox(userId: string): Promise<void> {
  await query(`DELETE FROM user_email_accounts WHERE user_id = $1`, [userId]);
}
