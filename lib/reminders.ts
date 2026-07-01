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
const WARRANTY_ACK_WINDOW = 2; // remind when the 5-day ack is ≤2 days out
const WARRANTY_RESOLVE_WINDOW = 5; // remind when the 30-day resolve is ≤5 days out
const INSURANCE_WINDOWS = [60, 30, 14];
const AR_WINDOWS = [15, 30]; // days overdue → demand letter / lien heads-up

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
  warranty: number;
  insurance: number;
  ar: number;
}

export async function runReminders(): Promise<ReminderRun> {
  const out: ReminderRun = { compliance: 0, coi: 0, warranty: 0, insurance: 0, ar: 0 };

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

  // ── Warranty claim deadlines: 5-day acknowledgment + 30-day resolution ──
  const warr = await query<{
    id: string;
    project: string;
    issue: string;
    acknowledged: boolean;
    resolved: boolean;
    ack_days: number | null;
    resolve_days: number | null;
    ack_label: string | null;
    resolve_label: string | null;
  }>(
    `SELECT id, project, issue, acknowledged, resolved,
            (ack_deadline_at - CURRENT_DATE)         AS ack_days,
            (resolve_deadline_at - CURRENT_DATE)     AS resolve_days,
            to_char(ack_deadline_at, 'Mon FMDD')     AS ack_label,
            to_char(resolve_deadline_at, 'Mon FMDD') AS resolve_label
       FROM warranty_claims
      WHERE resolved = false
        AND (ack_deadline_at IS NOT NULL OR resolve_deadline_at IS NOT NULL)`,
  );
  for (const r of warr.rows) {
    if (!r.acknowledged && r.ack_days !== null && r.ack_days <= WARRANTY_ACK_WINDOW && (await claim(`warranty:${r.id}:ack`))) {
      await emit({
        kind: "decision",
        tag: "Warranty",
        accent: "flag",
        icon: "shield",
        flagged: true,
        title: `Acknowledge warranty claim · ${r.project}`,
        subline: `${r.issue.slice(0, 80)} — ack by ${r.ack_label ?? "soon"}`,
        href: "/warranty",
        whenLabel: "Today",
      });
      out.warranty++;
    }
    if (r.resolve_days !== null && r.resolve_days <= WARRANTY_RESOLVE_WINDOW && (await claim(`warranty:${r.id}:resolve`))) {
      await emit({
        kind: "decision",
        tag: "Warranty",
        accent: "flag",
        icon: "shield",
        flagged: true,
        title: `Warranty claim resolution due · ${r.project}`,
        subline: `${r.issue.slice(0, 80)} — resolve by ${r.resolve_label ?? "soon"}`,
        href: "/warranty",
        whenLabel: "Today",
      });
      out.warranty++;
    }
  }

  // ── Insurance policy renewals: 60 / 30 / 14-day reminders ──
  const ins = await query<{ id: string; label: string; days: number; exp: string }>(
    `SELECT id, upper(policy_type) AS label,
            (expires_date - CURRENT_DATE)         AS days,
            to_char(expires_date, 'Mon FMDD')     AS exp
       FROM insurance_policies
      WHERE archived = false AND expires_date IS NOT NULL
        AND expires_date - CURRENT_DATE BETWEEN 0 AND ${INSURANCE_WINDOWS[0]}`,
  );
  for (const r of ins.rows) {
    for (const w of INSURANCE_WINDOWS) {
      if (r.days <= w && (await claim(`insurance:${r.id}:${w}`))) {
        await emit({
          kind: "compliance",
          tag: "Insurance",
          accent: "flag",
          icon: "shield",
          flagged: r.days <= 14,
          title: `${r.label} policy renews ${r.exp}`,
          subline: `${r.days}d out — confirm renewal`,
          href: "/compliance",
          whenLabel: "Today",
        });
        out.insurance++;
      }
    }
  }

  // ── A/R dunning: invoices 15 / 30 days overdue (sent, unpaid) ──
  const ar = await query<{ id: string; number: string; project: string; days: number }>(
    `SELECT i.id, i.number, p.name AS project,
            (CURRENT_DATE - i.sent_at::date) AS days
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'sent' AND i.sent_at IS NOT NULL
        AND CURRENT_DATE - i.sent_at::date >= ${AR_WINDOWS[0]}`,
  );
  for (const r of ar.rows) {
    for (const w of AR_WINDOWS) {
      if (r.days >= w && (await claim(`ar:${r.id}:${w}`))) {
        await emit({
          kind: "money",
          tag: "Collections",
          accent: "flag",
          icon: "money",
          flagged: true,
          title: `Invoice ${r.number} is ${r.days}d overdue · ${r.project}`,
          subline: w >= 30 ? "Consider a lien package" : "Time to send a demand letter",
          href: "/projects",
          whenLabel: "Today",
        });
        out.ar++;
      }
    }
  }

  return out;
}
