import "server-only";

// Sub portal invites (P1-B5). When a sub is assigned to a project we COMPOSE the
// "you're on this job" email and park it — we never send it.
//
// This file cannot transmit. It has no mail client, no lib/gmail.ts import, and
// no send path behind a flag or env var. queueSubPortalInvite() writes a row and
// emits a notification; that is the whole capability. Joe reviews the parked
// invite on the project's Subs tab and sends it himself (mailto) when he's ready.

import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { emit } from "./notify";

/** Days a portal link stays good. The clock is set at compose time, then RESET
 *  when Joe marks the invite handled (markSubInviteApproved) — that's the moment
 *  it actually reaches the sub, and the email promises "the next 30 days" from
 *  the sub's point of view. Without the reset, an invite parked for three weeks
 *  would hand them a link that dies in nine days. */
const INVITE_TTL_DAYS = 30;

/** Public base URL for links that leave the app. Matches lib/settings.ts. */
function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}

/** The plain-text invite. No account, no password — the link IS the credential. */
function composeInvite(subName: string, projectName: string, role: string, link: string) {
  const firstName = subName.split(/\s+/)[0] || subName;
  const roleLine = role ? `You're on as: ${role}.` : "";
  const subject = `You're on ${projectName} — SJ Carpentry`;
  const body = [
    `Hi ${firstName},`,
    "",
    `I've got you scheduled on ${projectName}.`,
    roleLine,
    "",
    "Your sub portal is here — scope, dates, daily logs, invoices, and a direct line to me:",
    link,
    "",
    "No account or password needed. The link signs you in and works for the next " +
      `${INVITE_TTL_DAYS} days, so keep this email.`,
    "",
    "— Joe Stafki",
    "SJ Carpentry LLC",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === "")) // collapse the gap when roleLine is empty
    .join("\n");
  return { subject, body };
}

/** Compose + PARK the portal invite for a new assignment. Never sends.
 *
 *  Idempotent: the caller only fires this on a genuinely new project_subs row,
 *  and the UNIQUE (sub_slug, project_id) below decides the rest. A *live* invite
 *  (queued or approved) wins — remove-then-reassign reuses the sub's existing
 *  link rather than minting a second one. A *dead* invite (dismissed, or aged
 *  past expires_at) is resurrected with a fresh token, because otherwise one
 *  Dismiss would lock that sub out of that project forever.
 *
 *  Best-effort: parking an invite is secondary to the assignment itself, so a
 *  failure here is logged, never thrown (same contract as notify.emit). */
export async function queueSubPortalInvite(projectId: string, subSlug: string): Promise<void> {
  try {
    const sub = await queryOne<{ name: string; email: string | null; trade: string }>(
      `SELECT name, email, trade FROM subs WHERE slug = $1`,
      [subSlug],
    );
    const project = await queryOne<{ name: string; slug: string }>(
      `SELECT name, slug FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!sub || !project) return;

    const role = await queryOne<{ role_label: string }>(
      `SELECT role_label FROM project_subs WHERE project_id = $1 AND sub_slug = $2`,
      [projectId, subSlug],
    );

    const token = randomBytes(32).toString("base64url");
    const link = `${appUrl()}/sub-portal/enter?token=${token}`;
    const { subject, body } = composeInvite(
      sub.name,
      project.name,
      role?.role_label || sub.trade,
      link,
    );

    const res = await query(
      `INSERT INTO sub_portal_invites
         (sub_slug, project_id, to_email, subject, body, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval)
       ON CONFLICT (sub_slug, project_id) DO UPDATE
          SET token      = EXCLUDED.token,
              to_email   = EXCLUDED.to_email,
              subject    = EXCLUDED.subject,
              body       = EXCLUDED.body,
              expires_at = EXCLUDED.expires_at,
              status     = 'queued',
              used_at    = NULL,
              created_at = now()
        WHERE sub_portal_invites.status = 'dismissed'
           OR sub_portal_invites.expires_at <= now()`,
      [subSlug, projectId, sub.email, subject, body, token, String(INVITE_TTL_DAYS)],
    );
    // 0 rows = a live invite is already parked for this pairing; leave it be.
    // 1 row = fresh insert or a resurrected dead one — both deserve the ping.
    if (res.rowCount !== 1) return;

    await emit({
      kind: "job",
      tag: "Sub invite",
      accent: "accent",
      icon: "mail",
      title: `Portal invite queued — ${sub.name}`,
      subline: `${project.name} · awaiting your OK — nothing has been sent`,
      href: `/projects/${project.slug}`,
    });
  } catch (err) {
    console.error("queueSubPortalInvite failed", err);
  }
}

/** Joe sent the parked invite himself and marked it handled. Restarts the link's
 *  TTL from now (see INVITE_TTL_DAYS) so the sub gets the full window the email
 *  promises. Records that he took it from here — it transmits nothing. */
export async function markSubInviteApproved(id: number): Promise<void> {
  await query(
    `UPDATE sub_portal_invites
        SET status = 'approved', expires_at = now() + ($2 || ' days')::interval
      WHERE id = $1 AND status = 'queued'`,
    [id, String(INVITE_TTL_DAYS)],
  );
}

// ─── Read side (project Subs tab) ────────────────────────────────────────────

export interface QueuedSubInvite {
  id: number;
  subName: string;
  toEmail: string | null;
  subject: string;
  body: string;
  when: string;
  /** Composed so long ago the link inside has died. Sending it now would bounce
   *  the sub to /login — the panel says so instead of pretending it's good. */
  expired: boolean;
}

/** Invites parked on this project and still awaiting Joe. */
export async function getQueuedSubInvites(projectSlug: string): Promise<QueuedSubInvite[]> {
  const { rows } = await query<{
    id: string;
    sub_name: string;
    to_email: string | null;
    subject: string;
    body: string;
    when_label: string;
    expired: boolean;
  }>(
    `SELECT i.id, s.name AS sub_name, i.to_email, i.subject, i.body,
            to_char(i.created_at, 'FMMon FMDD') AS when_label,
            (i.expires_at <= now()) AS expired
       FROM sub_portal_invites i
       JOIN subs s ON s.slug = i.sub_slug
       JOIN projects p ON p.id = i.project_id
      WHERE p.slug = $1 AND i.status = 'queued'
      ORDER BY i.created_at DESC`,
    [projectSlug],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    subName: r.sub_name,
    toEmail: r.to_email,
    subject: r.subject,
    body: r.body,
    when: r.when_label,
    expired: r.expired,
  }));
}
