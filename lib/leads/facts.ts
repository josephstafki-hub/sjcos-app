// Missing-fact collection and the follow-up preview (A11 / W01, DECISIONS
// "Natural communication requirement"). Pure `run`.
//
//   collectMissingFacts(run, {leadId}) — asks ONLY for facts still unknown,
//     in plain, specific language (no canned greeting, no invented call or
//     visit, no price). Sent automatically when routine.followup is active and
//     nothing says stop; otherwise staged as a 'routine_message' decision.
//     Stops on reply / decline / opt-out / owner already replied.
//   previewLeadFollowups(run, {dryRun:true}) — what WOULD go out and why,
//     lead by lead. No calendar pause required.
//   stopLeadFollowups(run, leadId, reason) — reply/decline/opt-out hook.
//
// This is the short missing-info thread. The longer nurture stays in
// lib/newsletter-drip.ts and remains owner-armed; this module never arms it.

import type { Run } from "../commands/core.ts";
import { stageDecision, type Decision } from "../commands/decisions.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { principalLabel, type Principal } from "../commands/principal.ts";
import { qualificationChecklist, type FactKey } from "./qualification.ts";
import { routineSendAllowed } from "./routine.ts";

/** The facts a client can answer by email. The rest are derived. */
const ASKABLE: FactKey[] = ["scope", "photos", "measurements", "timeline", "budget_fit", "address", "goals"];

const ASK: Record<FactKey, string> = {
  scope: "a few sentences on what you'd like done, room by room if it's more than one",
  photos: "a couple of photos of the space as it is now",
  measurements: "rough measurements (length and width of the room, or the wall you're thinking of)",
  timeline: "when you're hoping to have it done",
  budget_fit: "a rough budget range you have in mind, so I can point you the right way",
  address: "the address of the house",
  goals: "what's driving the project (more space, updating the look, fixing something)",
  service_area: "",
  job_type: "",
};

export function draftMissingFactsEmail(firstName: string, keys: FactKey[], opts: { alreadyAskedOnce?: boolean } = {}): { subject: string; body: string } {
  const asks = keys.filter((k) => ASK[k]).map((k) => ASK[k]);
  const list = asks.length === 1 ? asks[0] : asks.length === 2 ? `${asks[0]} and ${asks[1]}` : `${asks.slice(0, -1).join(", ")}, and ${asks[asks.length - 1]}`;
  const opener = opts.alreadyAskedOnce ? `Circling back on your project.` : `Thanks for reaching out about your project.`;
  const body = `${firstName ? `${firstName}, ` : ""}${opener} To put a rough number together I'd need ${list}. Reply here with whatever you have and I'll take it from there.\n\nJoe\nSJ Carpentry LLC\n612-361-6585`;
  return { subject: opts.alreadyAskedOnce ? "Re: your project" : "Your project — a couple of things I need", body };
}

export interface LeadSignals {
  replied: boolean;
  declined: boolean;
  optedOut: boolean;
  ownerRepliedSince: boolean;
  pendingOwnerDecision: boolean;
  lastContactAt: string | null;
  recentSends: string[];
}

/** Stop signals from the lead record, activity, opt-outs and decisions. */
export async function readLeadSignals(run: Run, leadId: string): Promise<LeadSignals> {
  const [lead] = await run<{ email: string | null; phone: string | null; stage: string; flag_kind: string | null; flag_label: string | null; last_contact_at: string | null; slug: string }>(
    `SELECT email, phone, stage, flag_kind, flag_label, last_contact_at::text AS last_contact_at, slug FROM leads WHERE id = $1`,
    [leadId],
  );
  if (!lead) return { replied: false, declined: false, optedOut: true, ownerRepliedSince: false, pendingOwnerDecision: false, lastContactAt: null, recentSends: [] };
  const email = (lead.email ?? "").trim().toLowerCase();
  const [lastAsk] = await run<{ sent_at: string | null }>(`SELECT sent_at::text AS sent_at FROM lead_followups WHERE lead_id = $1 AND kind IN ('missing_info','first_response') AND state = 'sent' ORDER BY sent_at DESC LIMIT 1`, [leadId]);
  const since = lastAsk?.sent_at ?? null;
  // A reply: any activity kind 'contact'/'email' from the client or an
  // inbound flag set by lead-thread-sync after our last ask.
  const [reply] = await run<{ n: number; last_at: string | null }>(
    `SELECT count(*)::int AS n, max(created_at)::text AS last_at FROM lead_activity WHERE lead_id = $1 AND kind IN ('contact','reply') AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)`,
    [leadId, since],
  );
  // A reply whose answers have since been recorded as facts is no longer an
  // unprocessed reply: the next ask may go out for whatever is still missing.
  const [recorded] = Number(reply?.n ?? 0) > 0
    ? await run<{ n: number }>(`SELECT count(*)::int AS n FROM lead_facts WHERE lead_id = $1 AND status = 'known' AND ($2::timestamptz IS NULL OR updated_at > $2::timestamptz)`, [leadId, since])
    : [{ n: 0 }];
  const unprocessedReply = Number(reply?.n ?? 0) > 0 && Number(recorded?.n ?? 0) === 0;
  const inboundFlag = /reply|replied|answered|responded/i.test(lead.flag_label ?? "") && lead.flag_kind !== "scam";
  const [ownerReply] = await run<{ n: number }>(
    `SELECT count(*)::int AS n FROM lead_activity WHERE lead_id = $1 AND kind = 'email' AND actor NOT ILIKE 'claude%' AND actor NOT ILIKE 'hermes%' AND actor NOT ILIKE 'qwen%' AND actor NOT ILIKE '%(auto)%' AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)`,
    [leadId, since],
  );
  const declined = lead.stage === "lost" || /declin|not interested|went with|no thanks/i.test(lead.flag_label ?? "");
  const [opt] = email ? await run<{ n: number }>(`SELECT count(*)::int AS n FROM communication_optouts WHERE channel = 'email' AND address = $1 AND revoked_at IS NULL`, [email]) : [{ n: 0 }];
  const [nl] = email ? await run<{ n: number }>(`SELECT count(*)::int AS n FROM newsletter_recipients WHERE lower(email) = $1 AND active = false`, [email]) : [{ n: 0 }];
  const [sms] = lead.phone ? await run<{ n: number }>(`SELECT count(*)::int AS n FROM sms_threads WHERE link_type = 'lead' AND link_slug = $1 AND opted_out = true`, [lead.slug]) : [{ n: 0 }];
  const [pending] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM decisions WHERE lead_id = $1 AND status = 'pending' AND kind <> 'routine_message'`, [leadId]);
  const sends = await run<{ sent_at: string }>(`SELECT sent_at::text AS sent_at FROM lead_followups WHERE lead_id = $1 AND state = 'sent' AND sent_at > now() - interval '7 days'`, [leadId]);
  return {
    replied: unprocessedReply || inboundFlag,
    declined,
    optedOut: Number(opt?.n ?? 0) > 0 || Number(nl?.n ?? 0) > 0 || Number(sms?.n ?? 0) > 0,
    ownerRepliedSince: Number(ownerReply?.n ?? 0) > 0,
    pendingOwnerDecision: Number(pending?.n ?? 0) > 0,
    lastContactAt: lead.last_contact_at,
    recentSends: sends.map((s) => s.sent_at),
  };
}

export interface CollectInput {
  leadId: string;
  principal: Principal;
  at?: Date;
  /** Preview only: no writes except reading. */
  dryRun?: boolean;
  commandId?: string | null;
}

export type CollectResult =
  | { action: "sent"; leadId: string; asked: FactKey[]; intentId: string; followupId: number; policyRef: string; body: string }
  | { action: "staged"; leadId: string; asked: FactKey[]; decision: Decision; followupId: number; reason: string; body: string }
  | { action: "would_send" | "would_stage"; leadId: string; asked: FactKey[]; reason: string; body: string }
  | { action: "nothing"; leadId: string; reason: string; asked: FactKey[] };

export async function collectMissingFacts(run: Run, input: CollectInput): Promise<CollectResult> {
  const [lead] = await run<{ id: string; slug: string; name: string; email: string | null; stage: string }>(`SELECT id, slug, name, email, stage FROM leads WHERE id = $1`, [input.leadId]);
  if (!lead) return { action: "nothing", leadId: input.leadId, reason: "lead not found", asked: [] };
  const email = (lead.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { action: "nothing", leadId: lead.id, reason: "no usable email on the lead", asked: [] };
  if (!["intake", "qualified"].includes(lead.stage)) return { action: "nothing", leadId: lead.id, reason: `lead is at ${lead.stage}; missing-info asks only apply before the rough estimate`, asked: [] };
  const checklist = await qualificationChecklist(run, lead.id);
  if (checklist.verdict === "pass") return { action: "nothing", leadId: lead.id, reason: `qualification says pass: ${checklist.reasons.join(" ")}`, asked: [] };
  // Ask in the order a client naturally answers (photos first, budget, address, goals) — ASKABLE's order.
  const asked = ASKABLE.filter((k) => checklist.missing.includes(k));
  if (!asked.length) return { action: "nothing", leadId: lead.id, reason: "nothing missing that the client can answer", asked: [] };
  const signals = await readLeadSignals(run, lead.id);
  if (signals.declined) return { action: "nothing", leadId: lead.id, reason: "lead declined / lost", asked };
  if (signals.optedOut) return { action: "nothing", leadId: lead.id, reason: "recipient opted out", asked };
  if (signals.ownerRepliedSince) return { action: "nothing", leadId: lead.id, reason: "Joe replied directly since the last ask; no automatic chase on top of him", asked };
  // Every earlier missing-info ask counts (sent, staged, answered, stopped):
  // the attempt number must never reuse an operation key, and "asked twice"
  // means twice, whatever happened to the reply afterwards.
  const [prior] = await run<{ n: number; total: number }>(
    `SELECT count(*) FILTER (WHERE sent_at IS NOT NULL)::int AS n, count(*)::int AS total
       FROM lead_followups WHERE lead_id = $1 AND kind = 'missing_info'`,
    [lead.id],
  );
  const alreadyAskedOnce = Number(prior?.n ?? 0) > 0;
  if (alreadyAskedOnce && signals.replied) return { action: "nothing", leadId: lead.id, reason: "they replied to the last ask; record their answers before asking again", asked };
  if (alreadyAskedOnce && Number(prior?.n) >= 2) return { action: "nothing", leadId: lead.id, reason: "already asked twice; stop chasing, hand to Joe", asked };
  const draft = draftMissingFactsEmail(lead.name.split(" ")[0] ?? "", asked, { alreadyAskedOnce });
  const verdict = await routineSendAllowed(run, {
    channel: "email",
    recipient: email,
    leadId: lead.id,
    at: input.at,
    recentSends: signals.recentSends,
    signals: { replied: alreadyAskedOnce && signals.replied, declined: signals.declined, optedOut: signals.optedOut, pendingOwnerDecision: signals.pendingOwnerDecision },
  });
  if (input.dryRun) {
    return verdict.ok
      ? { action: "would_send", leadId: lead.id, asked, reason: `policy ${verdict.policyRef} allows it`, body: draft.body }
      : { action: "would_stage", leadId: lead.id, asked, reason: verdict.reason, body: draft.body };
  }
  // Attempt numbers key the intent; every row (even a parked draft) took one.
  const attempt = Number(prior?.total ?? 0) + 1;
  if (verdict.ok) {
    const { intent } = await enqueueIntent(run, {
      operationKey: `lead:${lead.id}:missing-info:${attempt}`,
      kind: "send_email",
      targetKind: "lead",
      targetId: lead.id,
      recipient: email,
      leadId: lead.id,
      payload: { to: email, subject: draft.subject, body: draft.body, askedKeys: asked },
      policyRef: verdict.policyRef,
      commandId: input.commandId ?? null,
      principal: input.principal,
    });
    const [f] = await run<{ id: number }>(
      `INSERT INTO lead_followups (lead_id, kind, policy_ref, intent_id, recipient, asked_keys, subject, body, sent_at, state)
       VALUES ($1, 'missing_info', $2, $3, $4, $5::text[], $6, $7, now(), 'sent') RETURNING id`,
      [lead.id, verdict.policyRef, intent.id, email, asked, draft.subject, draft.body],
    );
    await run(`UPDATE lead_facts SET asked_at = now(), updated_at = now() WHERE lead_id = $1 AND key = ANY($2::text[])`, [lead.id, asked]);
    await run(`INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'email', $2, $3)`, [lead.id, `Asked for ${asked.join(", ")} (auto, ${verdict.policyRef})`, `${principalLabel(input.principal)} (auto)`]);
    return { action: "sent", leadId: lead.id, asked, intentId: intent.id, followupId: Number(f.id), policyRef: verdict.policyRef, body: draft.body };
  }
  const staged = await stageDecision(run, {
    kind: "routine_message",
    action: "send_email",
    title: `Ask ${lead.name} for ${asked.join(", ")}`.slice(0, 300),
    summary: { recipients: [{ name: lead.name, address: email, role: "lead" }], inclusions: asked, effect: `Emails the questions to ${email}. Held because: ${verdict.reason}`, body: draft.body, subject: draft.subject },
    targetKind: "lead",
    targetId: lead.id,
    recipient: email,
    content: { to: email, subject: draft.subject, body: draft.body },
    leadId: lead.id,
    href: `/leads/${lead.slug}`,
    dedupeKey: `lead:${lead.id}:missing-info`,
    requestedBy: input.principal,
  });
  const [f] = await run<{ id: number }>(
    `INSERT INTO lead_followups (lead_id, kind, decision_id, recipient, asked_keys, subject, body, state)
     VALUES ($1, 'missing_info', $2, $3, $4::text[], $5, $6, 'staged')
     ON CONFLICT DO NOTHING RETURNING id`,
    [lead.id, staged.decision.id, email, asked, draft.subject, draft.body],
  );
  return { action: "staged", leadId: lead.id, asked, decision: staged.decision, followupId: Number(f?.id ?? 0), reason: verdict.reason, body: draft.body };
}

/** Reply / decline / opt-out / owner reply → stop every planned or staged
 *  follow-up on the lead and revoke its pending routine decisions. */
export async function stopLeadFollowups(run: Run, leadId: string, reason: string): Promise<number> {
  const rows = await run<{ id: number; decision_id: string | null }>(
    `UPDATE lead_followups SET state = 'stopped', stop_reason = $2, updated_at = now() WHERE lead_id = $1 AND state IN ('planned','staged') RETURNING id, decision_id`,
    [leadId, reason],
  );
  for (const r of rows) if (r.decision_id) await run(`UPDATE decisions SET status = 'revoked', decision_note = $2 WHERE id = $1 AND status = 'pending'`, [r.decision_id, reason]);
  await run(`UPDATE lead_followups SET state = 'answered', stop_reason = $2, updated_at = now() WHERE lead_id = $1 AND state = 'sent' AND $2 ILIKE 'repl%'`, [leadId, reason]);
  return rows.length;
}

export interface PreviewRow {
  leadId: string;
  slug: string;
  name: string;
  result: CollectResult;
}

/** Shadow mode: what the collector would do for every open lead, with reasons. */
export async function previewLeadFollowups(run: Run, opts: { dryRun: true; principal: Principal; at?: Date; leadIds?: string[] | null; limit?: number }): Promise<PreviewRow[]> {
  const leads = await run<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM leads WHERE stage IN ('intake','qualified') AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[])) ORDER BY created_at DESC LIMIT $2`,
    [opts.leadIds ?? null, opts.limit ?? 100],
  );
  const out: PreviewRow[] = [];
  for (const l of leads) out.push({ leadId: l.id, slug: l.slug, name: l.name, result: await collectMissingFacts(run, { leadId: l.id, principal: opts.principal, at: opts.at, dryRun: true }) });
  return out;
}

/** Owner time + completion measures for the lead funnel. */
export async function leadFollowupMetrics(run: Run, opts: { sinceDays?: number } = {}): Promise<{ asks: number; answered: number; staged: number; ownerTouches: number; ownerSeconds: number; medianHoursToAnswer: number | null }> {
  const since = opts.sinceDays ?? 30;
  const [f] = await run<{ asks: number; answered: number; staged: number; median_hours: number | null }>(
    `SELECT count(*) FILTER (WHERE state IN ('sent','answered'))::int AS asks,
            count(*) FILTER (WHERE state = 'answered')::int AS answered,
            count(*) FILTER (WHERE state = 'staged')::int AS staged,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - sent_at)) / 3600) FILTER (WHERE state = 'answered' AND sent_at IS NOT NULL) AS median_hours
       FROM lead_followups WHERE created_at > now() - ($1::int * interval '1 day')`,
    [since],
  );
  const [t] = await run<{ n: number; seconds: number }>(
    `SELECT count(*)::int AS n, COALESCE(sum(seconds), 0)::int AS seconds FROM owner_touches o
      WHERE o.created_at > now() - ($1::int * interval '1 day')
        AND (o.decision_id IN (SELECT id FROM decisions WHERE lead_id IS NOT NULL) OR o.work_item_id IN (SELECT id FROM work_items WHERE lead_id IS NOT NULL))`,
    [since],
  );
  return { asks: Number(f?.asks ?? 0), answered: Number(f?.answered ?? 0), staged: Number(f?.staged ?? 0), ownerTouches: Number(t?.n ?? 0), ownerSeconds: Number(t?.seconds ?? 0), medianHoursToAnswer: f?.median_hours == null ? null : Number(f.median_hours) };
}
