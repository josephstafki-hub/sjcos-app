"use server";

// Claiming a client portal — the upgrade from "link in an email" to "an account
// I can sign into anywhere".
//
// Until a client claims it, their portal is reachable by anyone holding the
// invite link (see app/client-portal/enter). Claiming sets a real password and
// stamps users.portal_claimed_at, which makes the enter route refuse that link
// from then on. That's the whole point: it locks the portal to them.
//
// Deliberately NOT a general signup. The only account this can ever touch is
// the one already attached to the caller's own session — there is no email
// parameter to point it at somebody else's row.

import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { parseLinkSlug } from "@/lib/client-portal";
import { logClientActivity, ownerHref } from "@/lib/client-activity";
import { requireRole } from "@/lib/dal";
import { hashPassword } from "@/lib/password";

export interface ClaimState {
  error?: string;
  ok?: boolean;
}

const ClaimSchema = z
  .object({
    email: z.email("Enter a valid email address."),
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Those passwords don't match.",
    path: ["confirm"],
  });

export async function claimPortalAccount(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const user = await requireRole("client");

  const parsed = ClaimSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { email, password } = parsed.data;

  const already = await queryOne<{ portal_claimed_at: Date | null }>(
    `SELECT portal_claimed_at FROM users WHERE id = $1`,
    [user.id],
  );
  if (already?.portal_claimed_at) {
    return { error: "This portal already has an account. Sign in with your email and password." };
  }

  // The synthetic address the link-in flow minted gets replaced by the real one
  // they type here, so they can actually sign in with it later.
  const taken = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2`,
    [email, user.id],
  );
  if (taken) {
    return { error: "That email is already in use. Try signing in instead." };
  }

  await query(
    `UPDATE users SET email = $2, password_hash = $3, portal_claimed_at = now() WHERE id = $1`,
    [user.id, email, await hashPassword(password)],
  );
  // The bearer link is now dead weight — retire it so a forwarded copy of the
  // original email can't be used to poke at a portal its owner just locked.
  if (user.linkSlug) {
    const scope = parseLinkSlug(user.linkSlug);
    await query(
      scope?.kind === "lead"
        ? `UPDATE client_portal_invites SET status = 'dismissed' WHERE lead_slug = $1`
        : `UPDATE client_portal_invites SET status = 'dismissed' WHERE project_slug = $1`,
      [scope?.kind === "lead" ? scope.slug : user.linkSlug],
    );
    if (scope) {
      await logClientActivity({
        scope,
        kind: "claim",
        summary: "Claimed the portal with an email + password",
        detail: email,
        actorName: user.name,
        href: ownerHref(scope, { tab: "Client portal" }),
      });
    }
  }

  // Deliberately NOT revalidating: the caller's session cookie is unchanged, so
  // they stay signed in, and letting the client component keep its own state
  // means the "your portal is locked to you" confirmation actually shows.
  // On their next full page load, portal_claimed_at hides the panel for good.
  return { ok: true };
}
