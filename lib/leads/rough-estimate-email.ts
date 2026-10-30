// A rough estimate only goes to a lead from the rough estimate saved on that
// lead. Joe, 2026-10-30: Timothy Dessonville's lead showed "?" although an
// agent had emailed him a $13,500 – $19,500 rough estimate on Oct 5 with
// send_email; it was never saved on the lead. Sam Hass's went out the same
// way and still read "draft".
//
// performGrantedAction (lib/agent-sends.ts) calls these for every send_email,
// which covers an agent's send_email and Joe's Approve on a permission card:
//
//   checkRoughEstimateEmail(run, email)
//     An email to an open lead that reads as a rough estimate ("rough
//     estimate" / "rough total") is refused — before the grant is spent —
//     unless that lead has a saved rough estimate whose figures the email
//     carries. Anything else passes untouched.
//   markRoughEstimateSent(run, leadId, by)
//     After the provider accepted it: the saved estimate reads sent, with
//     the date, and the lead's activity says so — a real contact, so like
//     logLeadActivity it bumps last_contact_at and clears "Needs reply".
//
// Pure over run(sql, params).

import type { Run } from "../commands/core.ts";

export type RoughEstimateCheck =
  | { kind: "pass" }
  | { kind: "refuse"; error: string }
  | { kind: "mark"; leadId: string; leadName: string };

const LOOKS_LIKE_ROUGH_ESTIMATE = /rough[\s-]+(estimate|total)/i;

/** Gmail ignores dots and +tags in the local part. */
export function mailboxKey(address: string): string {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 0) return a;
  let local = a.slice(0, at);
  const domain = a.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\+.*$/, "").replace(/\./g, "");
  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

/** Every dollar figure in a text, as whole dollars: "$13,500" → 13500,
 *  "$15k" → 15000. */
export function dollarFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(Math.round(m[2] ? n * 1000 : n));
  }
  return out;
}

export async function checkRoughEstimateEmail(run: Run, email: { to: string; subject?: string; body: string }): Promise<RoughEstimateCheck> {
  if (!LOOKS_LIKE_ROUGH_ESTIMATE.test(`${email.subject ?? ""}\n${email.body}`)) return { kind: "pass" };
  const key = mailboxKey(email.to);
  const leads = await run<{ id: string; name: string; email: string; total: string | null }>(
    `SELECT l.id, l.name, l.email, e.total
       FROM leads l LEFT JOIN lead_estimates e ON e.lead_id = l.id
      WHERE l.email IS NOT NULL AND l.stage <> 'lost'
        AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id)`,
  );
  const lead = leads.find((l) => mailboxKey(l.email) === key);
  if (!lead) return { kind: "pass" };

  const saved = dollarFigures(lead.total ?? "");
  if (!saved.length) {
    return {
      kind: "refuse",
      error:
        `This email reads as a rough estimate for ${lead.name}, but no rough estimate is saved on that lead. ` +
        `Save it on the lead first (save_lead_rough_estimate, or the lead page's Rough estimate tab), then send it, ` +
        `so the lead's value and sent date are on record. Nothing was sent and the approval was not used.`,
    };
  }
  const inEmail = new Set(dollarFigures(`${email.subject ?? ""}\n${email.body}`));
  const missing = saved.filter((n) => !inEmail.has(n));
  if (missing.length) {
    return {
      kind: "refuse",
      error:
        `This email's figures don't match the rough estimate saved on ${lead.name}'s lead (${lead.total}). ` +
        `Update the saved rough estimate with save_lead_rough_estimate first, then send. ` +
        `Nothing was sent and the approval was not used.`,
    };
  }
  return { kind: "mark", leadId: lead.id, leadName: lead.name };
}

export async function markRoughEstimateSent(run: Run, leadId: string, by: string): Promise<void> {
  await run(`UPDATE lead_estimates SET status = 'sent', sent_at = now(), updated_at = now() WHERE lead_id = $1`, [leadId]);
  await run(
    `INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'email', 'Rough estimate emailed', $2)`,
    [leadId, by.slice(0, 60)],
  );
  await run(`UPDATE leads SET last_contact_at = now(), flag_label = NULL, flag_kind = NULL WHERE id = $1`, [leadId]);
}
