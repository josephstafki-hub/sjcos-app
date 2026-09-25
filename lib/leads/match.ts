// Intake identity match (A11, VALIDATION V15 "unknown identity → review").
// Pure `run`. Matches an inbound message/portal submission/call to an existing
// lead by email, phone or thread reference. One clear match → that lead.
// Nothing → 'new'. Several candidates that disagree → a review row; never a
// guessed merge.

import type { Run } from "../commands/core.ts";

export interface IntakeIdentity {
  email?: string | null;
  phone?: string | null;
  /** Gmail thread id / sms thread id / call id the message belongs to. */
  threadRef?: string | null;
  name?: string | null;
}

export type MatchResult =
  | { kind: "matched"; leadId: string; slug: string; via: "email" | "phone" | "thread" }
  | { kind: "new"; reason: string }
  | { kind: "review"; reviewId: number; reason: string; candidates: { leadId: string; slug: string; via: string }[] };

export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function matchIntake(run: Run, identity: IntakeIdentity, opts: { payload?: Record<string, unknown> } = {}): Promise<MatchResult> {
  const email = (identity.email ?? "").trim().toLowerCase() || null;
  const phone = normalizePhone(identity.phone);
  const candidates: { leadId: string; slug: string; via: "email" | "phone" | "thread" }[] = [];
  if (email) {
    const rows = await run<{ id: string; slug: string }>(`SELECT id, slug FROM leads WHERE lower(email) = $1 AND stage <> 'lost' ORDER BY created_at DESC`, [email]);
    for (const r of rows) candidates.push({ leadId: r.id, slug: r.slug, via: "email" });
  }
  if (phone) {
    const rows = await run<{ id: string; slug: string }>(
      `SELECT id, slug FROM leads WHERE phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') <> '' AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = right($1, 10) AND stage <> 'lost' ORDER BY created_at DESC`,
      [phone.replace(/\D/g, "")],
    );
    for (const r of rows) if (!candidates.some((c) => c.leadId === r.id)) candidates.push({ leadId: r.id, slug: r.slug, via: "phone" });
  }
  if (identity.threadRef) {
    const rows = await run<{ id: string; slug: string }>(
      `SELECT l.id, l.slug FROM sms_threads t JOIN leads l ON l.slug = t.link_slug WHERE t.link_type = 'lead' AND (t.id::text = $1 OR t.phone = $1)`,
      [identity.threadRef],
    );
    for (const r of rows) if (!candidates.some((c) => c.leadId === r.id)) candidates.push({ leadId: r.id, slug: r.slug, via: "thread" });
  }
  const distinct = new Set(candidates.map((c) => c.leadId));
  if (distinct.size === 1) return { kind: "matched", leadId: candidates[0].leadId, slug: candidates[0].slug, via: candidates[0].via };
  if (distinct.size === 0) {
    if (!email && !phone && !identity.threadRef) {
      const [row] = await run<{ id: number }>(
        `INSERT INTO lead_intake_reviews (reason, email, phone, thread_ref, candidates, payload) VALUES ('unknown_identity', NULL, NULL, NULL, '[]'::jsonb, $1::jsonb) RETURNING id`,
        [JSON.stringify(opts.payload ?? { name: identity.name ?? null })],
      );
      return { kind: "review", reviewId: Number(row.id), reason: "No email, phone or thread on the inbound; cannot tell who this is.", candidates: [] };
    }
    return { kind: "new", reason: "No existing lead shares this email, phone or thread." };
  }
  const [row] = await run<{ id: number }>(
    `INSERT INTO lead_intake_reviews (reason, email, phone, thread_ref, candidates, payload) VALUES ('conflicting_match', $1, $2, $3, $4::jsonb, $5::jsonb) RETURNING id`,
    [email, phone, identity.threadRef ?? null, JSON.stringify(candidates), JSON.stringify(opts.payload ?? {})],
  );
  return { kind: "review", reviewId: Number(row.id), reason: `Email/phone/thread point at ${distinct.size} different leads; a person must pick.`, candidates };
}
