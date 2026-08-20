"use server";

// Owner-side management of a client's portal access (project or lead scope).
// Until now the only way an invite existed was as a side effect of emailing a
// document for signature; this gives the owner a direct panel: get/copy the
// live link, email it, and revoke it. All owner-gated.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { hashPassword } from "@/lib/password";
import {
  ensureClientInvite,
  issueClientInvite,
  revokeClientInvite,
  inviteLink,
  scopeLinkSlug,
  type ClientInviteScope,
} from "@/lib/client-invites";
import { notifyDashboardPublish, type DeliveryNote } from "@/lib/portal-publish";

type LinkResult = { ok: true; link: string; toEmail: string | null } | { ok: false; error: string };

function revalidateScope(scope: ClientInviteScope) {
  revalidatePath("project" in scope ? `/projects/${scope.project}` : `/leads/${scope.lead}`);
}

/** Get (or mint) the scope's live portal link, for copying. */
export async function getPortalInviteLink(scope: ClientInviteScope): Promise<LinkResult> {
  await requireRole("owner");
  try {
    const invite = await ensureClientInvite(scope);
    revalidateScope(scope);
    return { ok: true, link: inviteLink(invite.token), toEmail: invite.toEmail };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Rotate the token (kills any previously shared link) and return the new one. */
export async function rotatePortalInviteLink(scope: ClientInviteScope): Promise<LinkResult> {
  await requireRole("owner");
  try {
    const invite = await issueClientInvite(scope);
    revalidateScope(scope);
    return { ok: true, link: inviteLink(invite.token), toEmail: invite.toEmail };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Email the client their dashboard invite (reuses the publish notification —
 *  same "here's your dashboard" letter and link). */
export async function emailPortalInvite(
  scope: ClientInviteScope,
): Promise<{ ok: true; delivery: DeliveryNote } | { ok: false; error: string }> {
  await requireRole("owner");
  try {
    const delivery = await notifyDashboardPublish(scope, {
      what: "your project dashboard",
      section: "home",
    });
    revalidateScope(scope);
    return { ok: true, delivery };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Forgot-password escape hatch: un-claim the portal. There is no client-side
 *  password reset, so when a client locks their dashboard with a password and
 *  then loses it, this is the way back in: scramble the password, clear
 *  portal_claimed_at, and make sure a live link exists again. Their email stays
 *  on the account, their portal and history are untouched, and they can re-claim
 *  with a fresh password from the dashboard. */
export async function resetPortalAccess(scope: ClientInviteScope): Promise<LinkResult> {
  await requireRole("owner");
  try {
    const unusable = await hashPassword(randomBytes(32).toString("hex"));
    await query(
      `UPDATE users SET password_hash = $2, portal_claimed_at = NULL
        WHERE role = 'client' AND link_slug = $1`,
      [scopeLinkSlug(scope), unusable],
    );
    const invite = await ensureClientInvite(scope);
    revalidateScope(scope);
    return { ok: true, link: inviteLink(invite.token), toEmail: invite.toEmail };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Kill the live link. The account behind it (if claimed) keeps working;
 *  an unclaimed link-only client loses access until a new link is issued. */
export async function revokePortalInvite(
  scope: ClientInviteScope,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  await revokeClientInvite(scope);
  revalidateScope(scope);
  return { ok: true };
}
