// THE ACCOUNT-SEPARATION RULE for email: which mailbox a given login acts
// through. Dependency-free (no db, no ALS) so it can be unit-tested on its own —
// the same split as lib/queue-scope.ts (whose to-dos) and lib/dm-keys.ts (which
// conversation). Those three are the decisions that keep one person's work out
// of another's; each is worth pinning without a database.
//
// lib/mailbox.ts re-exports all of this, so nothing else imports from here.

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

/** Just enough of a login to resolve a mailbox. Deliberately structural rather
 *  than an import of CurrentUser: lib/gmail.ts depends on this module, and
 *  lib/dal reaches for next/headers, which has no business in that chain. */
export interface MailboxViewer {
  id: string;
  role: string;
}

/** THE decision: given what (if anything) this user has linked and what the
 *  environment holds, which mailbox do they act through?
 *
 *  Split out from the DB read and unit-tested (tests/staff-separation.test.mjs)
 *  because getting it wrong in the owner direction silently hands one person's
 *  mail to another, and getting it wrong in the staff direction silently breaks
 *  every background send. Three cases:
 *
 *    linked row      → theirs, whoever they are.
 *    owner, no row   → the env token. An owner who has never touched Connect
 *                      keeps reading the mailbox prod is wired to, and it stays
 *                      the same token the background jobs use.
 *    anyone else     → nothing. A blank Email rail, never a fallback to the
 *                      owner's mail. */
export function resolveMailbox(
  viewer: MailboxViewer,
  linked: { email: string; refresh_token: string } | null,
  env: { refreshToken?: string; accountEmail?: string },
): Mailbox {
  if (linked) {
    return { refreshToken: linked.refresh_token, email: linked.email, userId: viewer.id, linked: true };
  }
  if (viewer.role === "owner" && env.refreshToken) {
    return {
      refreshToken: env.refreshToken,
      email: env.accountEmail ?? null,
      userId: viewer.id,
      linked: false,
    };
  }
  return { refreshToken: null, email: null, userId: viewer.id, linked: false };
}
