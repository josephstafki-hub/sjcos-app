// Routine reminder candidates (A07b). Pure.
//
// An invoice qualifies for a ROUTINE (non-legal) payment reminder only when
// every fact is verified: a live status, a due date derived from parsed
// terms that has passed, a verified balance > 0, no payment pending, not
// disputed, not on hold. Zero balance stops reminders; unknown terms never
// start them. Legal notices (demand letter, lien) are separate controlled
// work and never come from this list.
//
// lib/reminders.ts's A/R scan reads this list (dedup key `ar:<id>:<window>`).
//
// "Went out": status sent / partially_paid is the record of a send (older
// send paths never stamped delivery_state), and an issued invoice counts only
// once its delivery was accepted or delivered.

import type { Run } from "../commands/core.ts";
import { verifiedBalances, type VerifiedBalanceRow } from "./core.ts";

export interface ReminderCandidate extends VerifiedBalanceRow {
  projectSlug: string;
  projectName: string;
  clientEmail: string | null;
}

export async function routineReminderCandidates(run: Run, opts: { projectId?: string | null; minDaysPastDue?: number } = {}): Promise<ReminderCandidate[]> {
  const min = Math.max(0, opts.minDaysPastDue ?? 1);
  const rows = await verifiedBalances(run, { projectId: opts.projectId ?? null, onlyOpen: true });
  const eligible = rows.filter(
    (r) =>
      ["issued", "sent", "partially_paid"].includes(r.status) &&
      r.dueAt != null &&
      r.daysPastDue != null &&
      r.daysPastDue >= min &&
      !r.hasPending &&
      !r.exceptionFlags.includes("hold") &&
      !r.exceptionFlags.includes("terms_unknown") &&
      (r.status !== "issued" || r.deliveryState === "delivered" || r.deliveryState === "accepted"),
  );
  if (!eligible.length) return [];
  const ids = [...new Set(eligible.map((r) => r.projectId))];
  const meta = await run<{ id: string; slug: string; name: string; email: string | null }>(
    `SELECT p.id, p.slug, p.name,
            (SELECT u.email FROM users u WHERE u.link_slug = p.slug AND u.role = 'client' AND u.active LIMIT 1) AS email
       FROM projects p WHERE p.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(meta.map((m) => [m.id, m]));
  return eligible.map((r) => {
    const m = byId.get(r.projectId);
    return { ...r, projectSlug: m?.slug ?? "", projectName: m?.name ?? "", clientEmail: m?.email ?? null };
  });
}
