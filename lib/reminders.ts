import "server-only";

// Scheduled reminder engine (Phase-1 scheduler foundation). Run daily by the
// cron route (app/api/cron/reminders) via a systemd user timer. Scans dated
// records and emits a notification once per (record, window) using reminder_log
// for idempotency, so the daily run never duplicates a reminder.
//
// Window ownership: lib/notify.ts syncComplianceNotifications() already covers
// the urgent ≤14-day compliance window on feed-read, so this engine owns the
// EARLIER heads-up windows (compliance 60/30) plus COI expiry (30/15/5). As the
// warranty/A-R features land, add their scans here.

import { query } from "./db";
import { emit } from "./notify";

const COMPLIANCE_WINDOWS = [60, 30]; // ≤14d handled on feed-read
const COI_WINDOWS = [30, 15, 5];

/** Claim a reminder key. Returns true only on the first claim (insert), so the
 *  caller emits exactly once per window across daily runs. */
async function claim(key: string): Promise<boolean> {
  const r = await query(
    `INSERT INTO reminder_log (dedup_key) VALUES ($1) ON CONFLICT DO NOTHING`,
    [key],
  );
  return (r.rowCount ?? 0) === 1;
}

export interface ReminderRun {
  compliance: number;
  coi: number;
}

export async function runReminders(): Promise<ReminderRun> {
  const out: ReminderRun = { compliance: 0, coi: 0 };

  // ── Compliance items: 60 / 30-day heads-up (unresolved, future-dated) ──
  const comp = await query<{
    id: string;
    title: string;
    owner: string | null;
    days: number;
    due: string;
  }>(
    `SELECT id, title, owner,
            (due_date - CURRENT_DATE)     AS days,
            to_char(due_date, 'Mon FMDD') AS due
       FROM compliance_items
      WHERE resolved = false
        AND due_date - CURRENT_DATE BETWEEN 0 AND ${COMPLIANCE_WINDOWS[0]}`,
  );
  for (const r of comp.rows) {
    for (const w of COMPLIANCE_WINDOWS) {
      if (r.days <= w && (await claim(`compliance:${r.id}:${w}`))) {
        await emit({
          kind: "compliance",
          tag: "Compliance",
          accent: "accent",
          icon: "shield",
          title: `${r.title} · due ${r.due}`,
          subline: `${r.days}d out${r.owner ? ` · ${r.owner}` : ""}`,
          href: "/compliance",
          whenLabel: "Today",
        });
        out.compliance++;
      }
    }
  }

  // ── Subcontractor COI expiry: 30 / 15 / 5-day reminders ──
  const coi = await query<{
    slug: string;
    name: string;
    days: number;
    exp: string;
  }>(
    `SELECT slug, name,
            (coi_expires_at - CURRENT_DATE)     AS days,
            to_char(coi_expires_at, 'Mon FMDD') AS exp
       FROM subs
      WHERE coi_expires_at IS NOT NULL
        AND coi_expires_at - CURRENT_DATE BETWEEN 0 AND ${COI_WINDOWS[0]}`,
  );
  for (const r of coi.rows) {
    for (const w of COI_WINDOWS) {
      if (r.days <= w && (await claim(`coi:${r.slug}:${w}`))) {
        await emit({
          kind: "compliance",
          tag: "COI",
          accent: "flag",
          icon: "shield",
          title: `${r.name} · COI expires ${r.exp}`,
          subline: `${r.days}d left — request renewal`,
          flagged: r.days <= 15,
          href: `/subs/${r.slug}`,
          whenLabel: "Today",
        });
        out.coi++;
      }
    }
  }

  return out;
}
