import "server-only";

// Shared "pull known contacts into the newsletter" core (P7-N3). Used by both
// the owner-gated browser action (lib/actions/newsletter.ts) and the MCP agent
// surface (lib/newsletter-agent.ts) so the two stay in lockstep — one place
// that decides what "import from leads & projects" means.
//
// Two rules, both learned the hard way from what actually happened the first
// time this ran:
//   1. Imported contacts land INACTIVE. A bulk import used to insert everyone
//      as active=true, which meant they were silently included in "queue to
//      everyone active" on the very next broadcast with no way to tell them
//      apart from someone who'd actually asked to be on the list. Inactive
//      still shows up in Contacts (searchable), just not targeted by a send
//      until deliberately activated (setRecipientActive).
//   2. No welcome greeting / drip enrollment fires for an inactive import —
//      that only happens when a contact is actually activated. A batch import
//      of 30 old leads must never park 30 welcome emails for Release.
//
// Auto-classification: every contact lands in an audience — "Leads",
// "Projects" (current), or "Past projects" (status closeout/warranty) — by
// source, get-or-created by name (case-insensitive unique index) so re-import
// never spawns duplicate groups.

import { query, queryOne } from "./db";

const PAST_STATUSES = ["closeout", "warranty"];

async function getOrCreateGroup(name: string): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO newsletter_groups (name) VALUES ($1)
     ON CONFLICT ((lower(name))) DO UPDATE SET name = newsletter_groups.name
     RETURNING id`,
    [name],
  );
  return row!.id;
}

/** Land a contact as an inactive, classified recipient — whether the row is
 *  brand new or already existed (classification applies either way; an
 *  existing ACTIVE recipient's active flag is left alone, never demoted by an
 *  import). Returns true only if this created a genuinely new recipient row. */
async function upsertClassified(email: string, name: string, groupId: number): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const row = await queryOne<{ id: number; inserted: boolean }>(
    `INSERT INTO newsletter_recipients (email, name, active)
     VALUES ($1, $2, false)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, (xmax = 0) AS inserted`,
    [e, name.trim().slice(0, 120)],
  );
  if (!row) return false;
  await query(
    `INSERT INTO newsletter_recipient_groups (recipient_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [row.id, groupId],
  );
  return row.inserted;
}

/** Pull every known contact from leads (every stage — intake through lost,
 *  nothing filtered), client-portal logins, and each project's client email
 *  (falling back to the originating lead's email for a project that has
 *  lead_id but no client_email of its own yet). Returns how many NEW
 *  recipient rows were created (existing contacts still get (re)classified,
 *  just don't count toward this). */
export async function importKnownContacts(): Promise<number> {
  const leadsGroup = await getOrCreateGroup("Leads");
  const projectsGroup = await getOrCreateGroup("Projects");
  const pastProjectsGroup = await getOrCreateGroup("Past projects");

  let added = 0;

  const leads = (
    await query<{ email: string; name: string }>(
      `SELECT email, COALESCE(name, '') AS name FROM leads WHERE email <> ''`,
    )
  ).rows;
  for (const l of leads) if (await upsertClassified(l.email, l.name, leadsGroup)) added++;

  const clients = (
    await query<{ email: string; name: string }>(
      `SELECT email, COALESCE(name, '') AS name FROM users WHERE role = 'client' AND active = true AND email <> ''`,
    )
  ).rows;
  for (const c of clients) if (await upsertClassified(c.email, c.name, projectsGroup)) added++;

  const projectsWithEmail = (
    await query<{ email: string; name: string; past: boolean }>(
      `SELECT client_email AS email, COALESCE(NULLIF(client_name, ''), '') AS name, status = ANY($1) AS past
         FROM projects WHERE client_email <> ''`,
      [PAST_STATUSES],
    )
  ).rows;
  for (const p of projectsWithEmail)
    if (await upsertClassified(p.email, p.name, p.past ? pastProjectsGroup : projectsGroup)) added++;

  const projectsViaLead = (
    await query<{ email: string; name: string; past: boolean }>(
      `SELECT l.email AS email, COALESCE(NULLIF(p.client_name, ''), l.name, '') AS name, p.status = ANY($1) AS past
         FROM projects p JOIN leads l ON l.id = p.lead_id
        WHERE p.client_email = '' AND l.email <> ''`,
      [PAST_STATUSES],
    )
  ).rows;
  for (const p of projectsViaLead)
    if (await upsertClassified(p.email, p.name, p.past ? pastProjectsGroup : projectsGroup)) added++;

  return added;
}
