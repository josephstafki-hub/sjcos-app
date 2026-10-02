// Commitments: prepare → stage purchase decision → commit on approval (A13,
// WORKFLOW W06/W09, DECISIONS "Purchases"). Pure `run` module.
//
// prepareCommitment builds the exact thing the owner is asked to approve
// (payee from the trusted vendor/sub record, items, total incl. tax +
// shipping, terms). A changed material field produces a NEW revision and the
// prior pending decision is superseded (stageDecision dedupe); an approved but
// uncommitted prior decision can no longer be consumed because its content
// hash no longer matches.
//
// commitOnApproval is the only path that turns an approval into a binding
// order: construction gate → cash reservation (locked) → decision consumed →
// PO queued + 'send_purchase_order' intent for the dispatcher (WS-approvals).
// Nothing here calls a provider.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { consumeDecision, stageDecision, type Decision } from "../commands/decisions.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { laneOpen } from "../commands/policies.ts";
import { principalLabel, type Principal } from "../commands/principal.ts";
import { escalateShortfall, projectFunding, reserveFunds } from "../funding/index.ts";
import { constructionGateSatisfied, type ConstructionGate } from "./gate.ts";
import {
  COMMITMENT_COLS,
  PURCHASE_ACTION,
  PURCHASE_AND_PAY_ACTION,
  usd,
  type Commitment,
  type CommitmentItem,
  type CommitmentKind,
  type PayeeKind,
} from "./types.ts";
import { vendorRestrictions, type RestrictionVerdict } from "./vendor-rules.ts";

export type CommitmentSource =
  | { kind: "purchase_order"; purchaseOrderId: number }
  | { kind: "sub_award"; inviteId: number; submissionId?: number | null }
  | {
      kind: "supplier_offer";
      ref: string;
      projectId: string;
      vendorId: string;
      scopeSummary: string;
      items: CommitmentItem[];
      taxCents?: number;
      shippingCents?: number;
      terms?: string;
    };

export interface PrepareInput {
  source: CommitmentSource;
  principal: Principal;
  /** Override terms / tax / shipping captured from the quote. */
  terms?: string | null;
  taxCents?: number | null;
  shippingCents?: number | null;
}

export type PrepareResult =
  | { ok: true; commitment: Commitment; created: boolean; supersededRevision: number | null; restrictions: RestrictionVerdict }
  | { ok: false; reason: string };

interface TrustedPayee {
  payeeKind: PayeeKind;
  vendorId: string | null;
  subSlug: string | null;
  name: string;
  contact: string;
  notes: string;
}

/** The payee ALWAYS comes from the vendors/subs table, never from the PO's
 *  free-text snapshot or an inbound email. */
async function trustedPayee(run: Run, kind: PayeeKind, vendorId: string | null, subSlug: string | null): Promise<TrustedPayee | null> {
  if (kind === "vendor" && vendorId) {
    const [v] = await run<{ id: string; name: string; email: string | null; phone: string | null; notes: string }>(
      `SELECT id, name, email, phone, notes FROM vendors WHERE id = $1`,
      [vendorId],
    );
    if (!v) return null;
    return { payeeKind: "vendor", vendorId: v.id, subSlug: null, name: v.name, contact: (v.email ?? v.phone ?? "").trim().toLowerCase(), notes: v.notes ?? "" };
  }
  if (kind === "sub" && subSlug) {
    const [s] = await run<{ slug: string; name: string; email: string | null; phone: string | null }>(
      `SELECT slug, name, email, phone FROM subs WHERE slug = $1`,
      [subSlug],
    );
    if (!s) return null;
    return { payeeKind: "sub", vendorId: null, subSlug: s.slug, name: s.name, contact: (s.email ?? s.phone ?? "").trim().toLowerCase(), notes: "" };
  }
  return null;
}

function contentOf(c: {
  projectId: string;
  payeeKind: PayeeKind;
  vendorId: string | null;
  subSlug: string | null;
  contact: string;
  scope: string;
  items: CommitmentItem[];
  totalCents: number;
  currency: string;
  terms: string;
}): string {
  return hashInput({
    projectId: c.projectId,
    payee: { kind: c.payeeKind, vendorId: c.vendorId, subSlug: c.subSlug, contact: c.contact },
    scope: c.scope,
    items: c.items.map((i) => ({ d: i.description, u: i.unit, q: i.qty, c: i.unitCents })),
    totalCents: c.totalCents,
    currency: c.currency,
    terms: c.terms,
  });
}

export async function getCommitment(run: Run, id: number, opts: { forUpdate?: boolean } = {}): Promise<Commitment | null> {
  const [row] = await run<Commitment>(`SELECT ${COMMITMENT_COLS} FROM commitments WHERE id = $1${opts.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? normalize(row) : null;
}

function normalize(row: Commitment): Commitment {
  return {
    ...row,
    id: Number(row.id),
    revision: Number(row.revision),
    subtotal_cents: Number(row.subtotal_cents),
    tax_cents: Number(row.tax_cents),
    shipping_cents: Number(row.shipping_cents),
    total_cents: Number(row.total_cents),
    superseded_by: row.superseded_by == null ? null : Number(row.superseded_by),
    items: Array.isArray(row.items) ? row.items : [],
  };
}

export async function latestCommitment(run: Run, kind: CommitmentKind, ref: string): Promise<Commitment | null> {
  const [row] = await run<Commitment>(`SELECT ${COMMITMENT_COLS} FROM commitments WHERE kind = $1 AND ref = $2 ORDER BY revision DESC LIMIT 1`, [kind, ref]);
  return row ? normalize(row) : null;
}

/** Build (or re-find) the exact commitment for a PO / awarded bid / offer. */
export async function prepareCommitment(run: Run, input: PrepareInput): Promise<PrepareResult> {
  let projectId: string;
  let kind: CommitmentKind;
  let ref: string;
  let payeeKindRaw: PayeeKind;
  let vendorId: string | null = null;
  let subSlug: string | null = null;
  let scope = "";
  let items: CommitmentItem[] = [];
  let terms = (input.terms ?? "").trim();
  let taxCents = Math.max(0, Math.round(input.taxCents ?? 0));
  let shippingCents = Math.max(0, Math.round(input.shippingCents ?? 0));

  const src = input.source;
  if (src.kind === "purchase_order") {
    const [po] = await run<{
      id: number; project_id: string; vendor_kind: PayeeKind; vendor_id: string | null; sub_slug: string | null; title: string; notes: string;
      status: string; tax_cents: number; shipping_cents: number; terms: string;
    }>(`SELECT id, project_id, vendor_kind, vendor_id, sub_slug, title, notes, status, tax_cents, shipping_cents, terms FROM purchase_orders WHERE id = $1`, [src.purchaseOrderId]);
    if (!po) return { ok: false, reason: "Purchase order not found." };
    if (po.status === "void") return { ok: false, reason: "That purchase order is void." };
    const lines = await run<{ id: number; description: string; unit: string; qty_ordered: string; unit_cost: number; extended: number }>(
      `SELECT id, description, unit, qty_ordered, unit_cost, extended FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY sort_order, id`,
      [po.id],
    );
    if (!lines.length) return { ok: false, reason: "The purchase order has no lines; add what is being ordered first." };
    projectId = po.project_id;
    kind = "purchase_order";
    ref = String(po.id);
    payeeKindRaw = po.vendor_kind;
    vendorId = po.vendor_id;
    subSlug = po.sub_slug;
    scope = [po.title, po.notes].filter(Boolean).join(" — ");
    items = lines.map((l) => ({ lineId: Number(l.id), description: l.description, unit: l.unit, qty: Number(l.qty_ordered), unitCents: Number(l.unit_cost), extendedCents: Number(l.extended) }));
    if (!terms) terms = po.terms ?? "";
    if (input.taxCents == null) taxCents = Number(po.tax_cents ?? 0);
    if (input.shippingCents == null) shippingCents = Number(po.shipping_cents ?? 0);
  } else if (src.kind === "sub_award") {
    const [inv] = await run<{ id: number; sub_slug: string; status: string; package_id: number; title: string; scope_notes: string; project_id: string; package_status: string }>(
      `SELECT i.id, i.sub_slug, i.status, b.id AS package_id, b.title, b.scope_notes, b.project_id, b.status AS package_status
         FROM bid_invites i JOIN bid_packages b ON b.id = i.package_id WHERE i.id = $1`,
      [src.inviteId],
    );
    if (!inv) return { ok: false, reason: "Bid invite not found." };
    const [sub] = await run<{ id: number; total: number; notes: string; exclusions: string; lead_time: string; revision: number }>(
      src.submissionId
        ? `SELECT id, total, notes, exclusions, lead_time, revision FROM bid_submissions WHERE id = $1 AND invite_id = $2`
        : `SELECT id, total, notes, exclusions, lead_time, revision FROM bid_submissions WHERE invite_id = $2 AND $1::int IS NULL ORDER BY revision DESC LIMIT 1`,
      [src.submissionId ?? null, inv.id],
    );
    if (!sub) return { ok: false, reason: "No recorded bid on that invite; only a submitted bid can be awarded." };
    projectId = inv.project_id;
    kind = "sub_award";
    ref = String(inv.id);
    payeeKindRaw = "sub";
    subSlug = inv.sub_slug;
    scope = [inv.title, inv.scope_notes, sub.exclusions ? `Exclusions: ${sub.exclusions}` : ""].filter(Boolean).join(" — ");
    items = [{ description: `${inv.title} (bid rev ${sub.revision})`, unit: "lot", qty: 1, unitCents: Number(sub.total), extendedCents: Number(sub.total) }];
    if (!terms) terms = [sub.notes, sub.lead_time ? `Lead time: ${sub.lead_time}` : ""].filter(Boolean).join(" · ");
  } else {
    projectId = src.projectId;
    kind = "supplier_offer";
    ref = src.ref;
    payeeKindRaw = "vendor";
    vendorId = src.vendorId;
    scope = src.scopeSummary;
    items = src.items;
    if (!terms) terms = src.terms ?? "";
    if (input.taxCents == null) taxCents = Math.max(0, Math.round(src.taxCents ?? 0));
    if (input.shippingCents == null) shippingCents = Math.max(0, Math.round(src.shippingCents ?? 0));
  }

  const payee = await trustedPayee(run, payeeKindRaw, vendorId, subSlug);
  if (!payee) {
    return {
      ok: false,
      reason:
        payeeKindRaw === "one_off"
          ? "A commitment needs a payee from the vendor or sub records (one-off names cannot be validated). Add the vendor, link it, then prepare again."
          : "The linked vendor/sub record no longer exists.",
    };
  }
  if (!payee.contact) return { ok: false, reason: `${payee.name} has no email or phone on the trusted record; add one before committing.` };
  const restrictions = vendorRestrictions({ name: payee.name, email: payee.contact, notes: payee.notes });

  const subtotal = items.reduce((s, i) => s + Math.round(i.extendedCents), 0);
  const total = subtotal + taxCents + shippingCents;
  const currency = "USD";
  const hash = contentOf({ projectId, payeeKind: payee.payeeKind, vendorId: payee.vendorId, subSlug: payee.subSlug, contact: payee.contact, scope, items, totalCents: total, currency, terms });

  const prior = await latestCommitment(run, kind, ref);
  if (prior && prior.content_hash === hash && prior.state !== "void") {
    return { ok: true, commitment: prior, created: false, supersededRevision: null, restrictions };
  }
  const revision = prior ? prior.revision + 1 : 1;
  const [row] = await run<Commitment>(
    `INSERT INTO commitments (project_id, kind, ref, revision, payee_kind, vendor_id, sub_slug, payee_name, payee_contact, scope_summary, items,
        subtotal_cents, tax_cents, shipping_cents, total_cents, currency, terms, content_hash, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING ${COMMITMENT_COLS}`,
    [projectId, kind, ref, revision, payee.payeeKind, payee.vendorId, payee.subSlug, payee.name, payee.contact, scope, JSON.stringify(items),
      subtotal, taxCents, shippingCents, total, currency, terms, hash, principalLabel(input.principal)],
  );
  let supersededRevision: number | null = null;
  if (prior && prior.state !== "void") {
    supersededRevision = prior.revision;
    // A not-yet-committed prior revision is replaced outright; a committed one
    // stays (it was sent) and the new revision is the change to approve.
    if (["draft", "approved"].includes(prior.state)) {
      await run(`UPDATE commitments SET state = 'void', superseded_by = $2, updated_at = now() WHERE id = $1`, [prior.id, row.id]);
      if (prior.decision_id) {
        await run(`UPDATE decisions SET status = 'superseded', superseded_by = NULL WHERE id = $1 AND status IN ('pending','approved')`, [prior.decision_id]);
        await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'superseded', $2, $3::jsonb)`, [
          prior.decision_id,
          principalLabel(input.principal),
          JSON.stringify({ reason: "commitment revised", newCommitmentId: Number(row.id) }),
        ]);
      }
    } else {
      await run(`UPDATE commitments SET superseded_by = $2, updated_at = now() WHERE id = $1`, [prior.id, row.id]);
    }
  }
  return { ok: true, commitment: normalize(row), created: true, supersededRevision, restrictions };
}

export function purchaseDedupeKey(c: Pick<Commitment, "kind" | "ref">): string {
  return `purchase:${c.kind}:${c.ref}`;
}

/** The exact preview the owner approves. Lists everything committed. */
export function purchasePreview(c: Commitment, opts: { payNowBundled: boolean; projectName: string }): { title: string; summary: Record<string, unknown>; text: string } {
  const lines = c.items.map((i) => `${i.qty} ${i.unit} ${i.description} @ ${usd(i.unitCents)} = ${usd(i.extendedCents)}`);
  const extras = [c.tax_cents ? `Tax ${usd(c.tax_cents)}` : "", c.shipping_cents ? `Shipping ${usd(c.shipping_cents)}` : ""].filter(Boolean);
  const what = c.kind === "sub_award" ? "Award" : c.kind === "supplier_offer" ? "Accept offer" : "Order";
  const effect = opts.payNowBundled
    ? `Approving places this ${what.toLowerCase()} with ${c.payee_name} AND authorises immediate payment of ${usd(c.total_cents)} — one total, both effects. No later bill is authorised by this tap.`
    : `Approving commits SJ Carpentry to ${c.payee_name} for ${usd(c.total_cents)} on ${opts.projectName} and reserves that cash. Paying the bill will be a separate decision.`;
  const text = [
    `${what}: ${c.payee_name} (${c.payee_contact}) — ${opts.projectName}`,
    `Scope: ${c.scope_summary || "(none)"}`,
    ...lines,
    ...extras,
    `Total incl. tax and shipping: ${usd(c.total_cents)} ${c.currency}`,
    `Terms: ${c.terms || "(none stated)"}`,
    `Revision ${c.revision}`,
    effect,
  ].join("\n");
  return {
    title: `${what} ${usd(c.total_cents)} — ${c.payee_name} · ${opts.projectName}`.slice(0, 300),
    summary: {
      recipients: [{ name: c.payee_name, address: c.payee_contact, role: c.payee_kind }],
      inclusions: lines,
      quantities: c.items.map((i) => ({ label: i.description, qty: i.qty, unit: i.unit })),
      total: usd(c.total_cents),
      tax: usd(c.tax_cents),
      shipping: usd(c.shipping_cents),
      terms: c.terms,
      revision: c.revision,
      payNowBundled: opts.payNowBundled,
      effect,
      preview: text,
    },
    text,
  };
}

export interface StagePurchaseInput {
  commitmentId: number;
  principal: Principal;
  /** Bundle order + immediate charge in one decision. The preview then
   *  states both effects with one total; no later bill is covered. */
  payNowBundled?: boolean;
  href?: string | null;
  workItemId?: string | null;
}

export type StagePurchaseResult =
  | { ok: true; decision: Decision; created: boolean; superseded: string | null; commitment: Commitment; manualSteps: string[] | null }
  | { ok: false; reason: string; restrictions?: string[] };

/** Stage the 'purchase' decision for a commitment revision. */
export async function stagePurchaseDecision(run: Run, input: StagePurchaseInput): Promise<StagePurchaseResult> {
  const c = await getCommitment(run, input.commitmentId, { forUpdate: true });
  if (!c) return { ok: false, reason: "No such commitment." };
  if (c.state === "void") return { ok: false, reason: "That commitment revision was superseded; prepare the current one." };
  if (c.state !== "draft" && c.state !== "approved") return { ok: false, reason: `Commitment is already ${c.state}.` };
  const [p] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [c.project_id]);
  const [vendorRow] = c.vendor_id
    ? await run<{ name: string; email: string | null; notes: string }>(`SELECT name, email, notes FROM vendors WHERE id = $1`, [c.vendor_id])
    : [];
  const restrictions = vendorRestrictions({ name: c.payee_name, email: c.payee_contact, notes: vendorRow?.notes ?? "" });
  if (!restrictions.ok) {
    return { ok: false, reason: `Owner restriction on ${c.payee_name}: ${restrictions.restrictions.join("; ")}`, restrictions: restrictions.restrictions };
  }
  const payNow = Boolean(input.payNowBundled);
  const preview = purchasePreview(c, { payNowBundled: payNow, projectName: p?.name ?? "project" });
  if (payNow && !/immediate payment/.test(preview.text)) throw new Error("pay-now bundle requires the preview to state both effects");
  await run(`UPDATE commitments SET pay_now_bundled = $2, updated_at = now() WHERE id = $1`, [c.id, payNow]);
  const staged = await stageDecision(run, {
    kind: "purchase",
    action: payNow ? PURCHASE_AND_PAY_ACTION : PURCHASE_ACTION,
    title: preview.title,
    summary: preview.summary,
    targetKind: "commitment",
    targetId: c.id,
    recipient: c.payee_contact,
    amountCents: c.total_cents,
    currency: c.currency,
    contentHash: c.content_hash,
    artifactRevision: `rev${c.revision}`,
    projectId: c.project_id,
    href: input.href ?? (p ? `/projects/${p.slug}` : null),
    dedupeKey: purchaseDedupeKey(c),
    maxUses: payNow ? 2 : 1,
    workItemId: input.workItemId ?? null,
    requestedBy: input.principal,
  });
  await run(`UPDATE commitments SET decision_id = $2, updated_at = now() WHERE id = $1`, [c.id, staged.decision.id]);
  return {
    ok: true,
    decision: staged.decision,
    created: staged.created,
    superseded: staged.superseded,
    commitment: { ...c, decision_id: staged.decision.id, pay_now_bundled: payNow },
    manualSteps: restrictions.manual?.steps ?? null,
  };
}

export interface CommitInput {
  commitmentId: number;
  decisionId: string;
  principal: Principal;
  commandId?: string | null;
  constructionGate?: ConstructionGate;
  /** Skip the construction gate for a pre-construction service purchase
   *  (drawings, engineering) — must be stated explicitly by the caller. */
  preconstructionService?: boolean;
}

export type CommitResult =
  | { ok: true; commitment: Commitment; intentId: string | null; reservationId: number | null; already: boolean }
  | { ok: false; code: "gate" | "funding" | "decision" | "state" | "lane"; reason: string; shortfallCents?: number | null; fundingDecisionId?: string | null };

/** Turn an approved purchase decision into a binding commitment. */
export async function commitOnApproval(run: Run, input: CommitInput): Promise<CommitResult> {
  const c = await getCommitment(run, input.commitmentId, { forUpdate: true });
  if (!c) return { ok: false, code: "state", reason: "No such commitment." };
  if (c.state === "void") return { ok: false, code: "state", reason: "That commitment revision was superseded." };
  if (!["draft", "approved"].includes(c.state)) {
    return { ok: true, commitment: c, intentId: c.send_intent_id, reservationId: null, already: true };
  }
  if (c.decision_id !== input.decisionId) return { ok: false, code: "decision", reason: "That decision is not the one staged for this commitment revision." };

  const lane = await laneOpen(run, "purchases");
  if (!lane.open) return { ok: false, code: "lane", reason: `Purchases are paused: ${lane.reason}` };

  if (!input.preconstructionService) {
    const gate = await (input.constructionGate ?? constructionGateSatisfied)(run, c.project_id);
    if (!gate.ok) return { ok: false, code: "gate", reason: gate.unknown ? `Construction gate unknown: ${gate.reason}` : gate.reason };
  }

  // Lock the project row and check cash BEFORE spending the decision.
  const funding = await projectFunding(run, c.project_id, { forUpdate: true });
  if (funding.status === "unknown") return { ok: false, code: "funding", reason: `Cash status unknown (${funding.reason}); commitment refused.`, shortfallCents: null };
  if (funding.availableCents < c.total_cents) {
    const shortfall = c.total_cents - funding.availableCents;
    const [p] = await run<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [c.project_id]);
    const esc = await escalateShortfall(run, {
      projectId: c.project_id,
      amountCents: shortfall,
      purpose: `cover ${c.kind.replace("_", " ")} to ${c.payee_name}`,
      effect: `Without ${usd(shortfall)} of company cash this ${usd(c.total_cents)} commitment on ${p?.name ?? "the project"} cannot be placed (available ${usd(funding.availableCents)}).`,
      principal: input.principal,
      commitmentId: c.id,
    });
    return { ok: false, code: "funding", reason: `Short by ${usd(shortfall)}: available ${usd(funding.availableCents)} vs ${usd(c.total_cents)} needed. A funding decision is staged.`, shortfallCents: shortfall, fundingDecisionId: esc.decision.id };
  }

  const consumed = await consumeDecision(run, {
    id: input.decisionId,
    action: c.pay_now_bundled ? PURCHASE_AND_PAY_ACTION : PURCHASE_ACTION,
    contentHash: c.content_hash,
    recipient: c.payee_contact,
    amountCents: c.total_cents,
    targetKind: "commitment",
    targetId: c.id,
    consumer: principalLabel(input.principal),
  });
  if (!consumed.ok) return { ok: false, code: "decision", reason: consumed.reason };

  const reserved = await reserveFunds(run, { projectId: c.project_id, commitmentId: c.id, amountCents: c.total_cents, note: `${c.kind} ${c.ref} rev${c.revision}` });
  if (!reserved.ok) throw new Error(`reservation failed under lock: ${reserved.reason}`);

  let intentId: string | null = null;
  if (c.kind === "purchase_order") {
    const [po] = await run<{ id: number; slug: string }>(`SELECT po.id, p.slug FROM purchase_orders po JOIN projects p ON p.id = po.project_id WHERE po.id = $1`, [Number(c.ref)]);
    const { intent } = await enqueueIntent(run, {
      operationKey: `po:${c.ref}:send:rev${c.revision}`,
      kind: "send_purchase_order",
      targetKind: "purchase_order",
      targetId: c.ref,
      recipient: c.payee_contact,
      projectId: c.project_id,
      payload: { purchaseOrderId: Number(c.ref), projectSlug: po?.slug ?? null, commitmentId: c.id, revision: c.revision, to: c.payee_contact, totalCents: c.total_cents },
      artifactRevision: `rev${c.revision}`,
      decisionId: input.decisionId,
      commandId: input.commandId ?? null,
      principal: input.principal,
    });
    intentId = intent.id;
    await run(`UPDATE purchase_orders SET status = CASE WHEN status = 'draft' THEN 'queued' ELSE status END, commitment_id = $2, send_intent_id = $3 WHERE id = $1`, [Number(c.ref), c.id, intent.id]);
  } else if (c.kind === "sub_award") {
    const inviteId = Number(c.ref);
    const [inv] = await run<{ package_id: number }>(`SELECT package_id FROM bid_invites WHERE id = $1`, [inviteId]);
    if (inv) {
      await run(`UPDATE bid_invites SET status = 'awarded' WHERE id = $1`, [inviteId]);
      await run(`UPDATE bid_invites SET status = 'not_awarded' WHERE package_id = $1 AND id <> $2 AND status IN ('sent','viewed','working','submitted')`, [inv.package_id, inviteId]);
      await run(`UPDATE bid_packages SET status = 'awarded', awarded_invite_id = $2, updated_at = now() WHERE id = $1`, [inv.package_id, inviteId]);
    }
  }
  const [updated] = await run<Commitment>(
    `UPDATE commitments SET state = 'committed', send_intent_id = $2, updated_at = now() WHERE id = $1 RETURNING ${COMMITMENT_COLS}`,
    [c.id, intentId],
  );
  return { ok: true, commitment: normalize(updated), intentId, reservationId: reserved.reservationId, already: false };
}

export async function listCommitments(run: Run, opts: { projectId?: string | null; states?: string[]; limit?: number } = {}): Promise<Commitment[]> {
  const rows = await run<Commitment>(
    `SELECT ${COMMITMENT_COLS} FROM commitments
      WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::text[] IS NULL OR state = ANY($2::text[]))
      ORDER BY created_at DESC LIMIT $3`,
    [opts.projectId ?? null, opts.states ?? null, opts.limit ?? 100],
  );
  return rows.map(normalize);
}

export async function voidCommitment(run: Run, id: number, reason: string): Promise<boolean> {
  const rows = await run(`UPDATE commitments SET state = 'void', updated_at = now() WHERE id = $1 AND state NOT IN ('paid','void') RETURNING id`, [id]);
  if (rows.length) await run(`UPDATE cash_reservations SET state = 'released', note = $2, updated_at = now() WHERE commitment_id = $1 AND state = 'reserved'`, [id, reason]);
  return rows.length === 1;
}
