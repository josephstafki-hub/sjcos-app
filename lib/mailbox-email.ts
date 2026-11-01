import { activeMailbox } from "./mailbox";

/** The active mailbox's own address. The owner's env mailbox often has no
 *  GMAIL_ACCOUNT_EMAIL, so ask Gmail once (cached per token in fetchProfileEmail)
 *  and fill it into the active scope — preferences, synced drafts and AI
 *  suggestions are keyed by it. Gmail is imported only when the address is
 *  missing, so callers with a known address never load the connector. */
export async function ensureMailboxEmail(): Promise<string> {
  const mb = activeMailbox();
  if (mb?.email) return mb.email.toLowerCase();
  if (!mb?.refreshToken) return "";
  try {
    const { fetchProfileEmail } = await import("./gmail");
    const email = await fetchProfileEmail();
    if (email) mb.email = email;
    return email;
  } catch {
    return "";
  }
}
