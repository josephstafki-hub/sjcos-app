import "server-only";

// Dashboard-publish notifications. Every owner-side "Publish to dashboard"
// click (a document, a file, a floor-plan version, a mood board, a pushed
// selection) emails the client that something new is waiting, with a portal
// deep link that signs them in. One email per explicit publish click — edits
// behind an already-published item don't spam, and un-publishing never mails.
//
// Best-effort by design: the publish itself is already recorded, so a mail
// hiccup must never roll it back — callers get a DeliveryNote to show instead.
// This is still an owner-initiated send (the click IS the approval), so it
// does not violate the "client-facing sends stay owner-approved" rule.

import { queryOne } from "./db";
import { sendNewEmail, gmailConfigured } from "./gmail";
import {
  ensureClientInvite,
  getPortalClaim,
  inviteLink,
  portalBaseUrl,
  portalTargetPath,
  type ClientInviteScope,
  type PortalTargetKey,
  scopeLinkSlug,
} from "./client-invites";

export interface DeliveryNote {
  sent: boolean;
  note: string;
}

/** The best email on file for a scope: a claimed/linked client account first,
 *  then the project's client_email / the lead's email. Never the synthetic
 *  @client-portal.invalid address. Also returns the client's name for the
 *  greeting. */
async function recipientFor(
  scope: ClientInviteScope,
): Promise<{ email: string | null; name: string }> {
  const account = await queryOne<{ email: string; name: string }>(
    `SELECT email, name FROM users
      WHERE role = 'client' AND link_slug = $1
        AND email NOT LIKE '%@client-portal.invalid' AND active = true
      LIMIT 1`,
    [scopeLinkSlug(scope)],
  );
  if (account?.email) return { email: account.email, name: account.name };

  if ("project" in scope) {
    const p = await queryOne<{ client_email: string | null; client_name: string | null }>(
      `SELECT client_email, client_name FROM projects WHERE slug = $1`,
      [scope.project],
    );
    return { email: p?.client_email?.trim() || null, name: p?.client_name ?? "" };
  }
  const l = await queryOne<{ email: string | null; name: string }>(
    `SELECT email, name FROM leads WHERE slug = $1`,
    [scope.lead],
  );
  return { email: l?.email?.trim() || null, name: l?.name ?? "" };
}

/** Email the client that something new was published to their dashboard.
 *  `what` is the human line ("the Kitchen mood board", "Floor plan v3", …);
 *  `section` picks the deep link. Never throws. */
export async function notifyDashboardPublish(
  scope: ClientInviteScope,
  o: { what: string; section: PortalTargetKey },
): Promise<DeliveryNote> {
  try {
    const { email, name } = await recipientFor(scope);
    if (!email) {
      return {
        sent: false,
        note: "Published, but there's no client email on file — no notification went out.",
      };
    }
    if (!gmailConfigured()) {
      return {
        sent: false,
        note: "Published, but Gmail isn't connected — no notification went out.",
      };
    }

    // A claimed portal refuses bearer links (app/client-portal/enter), so
    // emailing one would send the client to a dead end. Link the section
    // directly instead — they sign in with the account they set up.
    const claim = await getPortalClaim(scope);
    const link = claim
      ? `${portalBaseUrl()}${portalTargetPath(o.section)}`
      : inviteLink((await ensureClientInvite(scope)).token, o.section);
    const first = name.split(/\s+/)[0] || "there";
    const howToGetIn = claim
      ? `Sign in with your email and password (your account is under ${claim.email}). ` +
        `From the dashboard you can also message me directly.`
      : `That link signs you in — no account or password needed. It doesn't expire, so keep ` +
        `the email — and from the dashboard you can also message me directly.`;

    await sendNewEmail({
      to: email,
      subject: `New on your project dashboard: ${o.what}`,
      bodyText:
        `Hi ${first},\n\n` +
        `I just added ${o.what} to your project dashboard — take a look when you get a minute:\n${link}\n\n` +
        `${howToGetIn}\n\n` +
        `Any questions, just reply to this email.\n\nThanks,\nJoe\nSJ Carpentry`,
    });
    return { sent: true, note: `Published and emailed ${email}.` };
  } catch (err) {
    return {
      sent: false,
      note: `Published, but the email failed: ${(err as Error).message}`,
    };
  }
}
