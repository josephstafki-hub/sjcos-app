// Scope/bid package release cards, supplier pricing requests, bid choice for
// the estimate, and awards (A13, WORKFLOW W05/W06, VALIDATION V35).
//
//   stagePackageRelease      — one 'package_release' decision PER RECIPIENT,
//                              bound to the exact package revision (hash of
//                              scope + attachments + invite message) and the
//                              recipient's trusted address. Changes since the
//                              last card are computed from the superseded
//                              decision. The send is WS-approvals' (it
//                              consumes the decision).
//   stageSupplierPricingRequest — same card shape for a supplier request.
//   selectBidForEstimate     — owner choice of a bid for the estimate: NOT an
//                              award; stages a 'bid_choice' decision.
//   awardBid                 — requires a consumed 'purchase' decision through
//                              commitOnApproval (sub_award commitment).

import { canonicalJson } from "../commands/core.ts";
import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { stageDecision, type Decision, type DecisionSummary } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { commitOnApproval, prepareCommitment, stagePurchaseDecision, type CommitResult } from "./commitments.ts";
import type { ConstructionGate } from "./gate.ts";
import { usd } from "./types.ts";
import { manualMarketplaceFor } from "./vendor-rules.ts";

export interface PackageReleaseInput {
  packageId: number;
  /** Restrict to these invite ids; default = every draft invite. */
  inviteIds?: number[] | null;
  inclusions?: string[];
  /** Must name Joe's retained work explicitly when any exists. */
  exclusions?: string[];
  quantities?: { label: string; qty: number | string; unit?: string }[];
  assumptions?: string[];
  gaps?: string[];
  principal: Principal;
  href?: string | null;
}

export interface ReleaseCard {
  inviteId: number;
  recipient: { name: string; address: string; role: string };
  revision: string;
  decision: Decision;
  created: boolean;
  superseded: string | null;
  changes: string[];
  manualSteps: string[] | null;
}

function diffSummary(prev: DecisionSummary | null, next: DecisionSummary): string[] {
  if (!prev) return ["First release of this package to this recipient."];
  const changes: string[] = [];
  // jsonb round-trips reorder object keys: compare canonically, not by raw string.
  const cmp = (key: keyof DecisionSummary, label: string) => {
    const a = canonicalJson(prev[key] ?? null);
    const b = canonicalJson(next[key] ?? null);
    if (a !== b) changes.push(`${label} changed`);
  };
  cmp("inclusions", "Included work");
  cmp("exclusions", "Exclusions");
  cmp("quantities", "Quantities");
  cmp("attachments", "Attachments");
  cmp("assumptions", "Assumptions");
  cmp("gaps", "Open gaps");
  if (canonicalJson(prev.recipients ?? null) !== canonicalJson(next.recipients ?? null)) changes.push("Recipient address changed");
  return changes.length ? changes : ["No material change since the last card (re-staged)."];
}

/** Stage per-recipient release decisions for a bid package. */
export async function stagePackageRelease(run: Run, input: PackageReleaseInput): Promise<{ ok: true; cards: ReleaseCard[]; packageRevision: string } | { ok: false; reason: string }> {
  const [pkg] = await run<{ id: number; project_id: string; title: string; trade: string; scope_notes: string; due_date: string | null; status: string; project_name: string; slug: string }>(
    `SELECT b.id, b.project_id, b.title, b.trade, b.scope_notes, b.due_date::text AS due_date, b.status, p.name AS project_name, p.slug
       FROM bid_packages b JOIN projects p ON p.id = b.project_id WHERE b.id = $1`,
    [input.packageId],
  );
  if (!pkg) return { ok: false, reason: "Bid package not found." };
  const files = await run<{ file_id: string; label: string; name: string; created_at: string }>(
    `SELECT f.file_id, f.label, fi.name, fi.created_at::text AS created_at FROM bid_package_files f JOIN files fi ON fi.id = f.file_id WHERE f.package_id = $1 ORDER BY f.sort_order, f.id`,
    [pkg.id],
  );
  const attachments = files.map((f) => ({ label: f.label || f.name, revision: f.created_at.slice(0, 19), fileId: f.file_id }));
  const invites = await run<{ id: number; sub_slug: string; message: string; status: string; name: string; trade: string; email: string | null; phone: string | null }>(
    `SELECT i.id, i.sub_slug, i.message, i.status, s.name, s.trade, s.email, s.phone FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug
      WHERE i.package_id = $1 AND ($2::bigint[] IS NULL OR i.id = ANY($2::bigint[])) ORDER BY i.id`,
    [pkg.id, input.inviteIds ?? null],
  );
  if (!invites.length) return { ok: false, reason: "No invites on this package to release." };
  const inclusions = input.inclusions?.length ? input.inclusions : pkg.scope_notes ? pkg.scope_notes.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  if (!inclusions.length) return { ok: false, reason: "The package has no included work described; a release card must say what is being bid." };
  const exclusions = input.exclusions ?? [];
  const packageRevision = hashInput({ title: pkg.title, trade: pkg.trade, scope: pkg.scope_notes, due: pkg.due_date, attachments: attachments.map((a) => a.fileId + a.revision), inclusions, exclusions, quantities: input.quantities ?? [] }).slice(0, 16);

  const cards: ReleaseCard[] = [];
  for (const inv of invites) {
    const address = (inv.email ?? inv.phone ?? "").trim().toLowerCase();
    if (!address) return { ok: false, reason: `${inv.name} has no email or phone on the sub record; fix the record before releasing.` };
    const manual = manualMarketplaceFor({ name: inv.name, email: inv.email });
    const dedupeKey = `package_release:${pkg.id}:${inv.id}`;
    const [prev] = await run<{ summary: DecisionSummary }>(`SELECT summary FROM decisions WHERE dedupe_key = $1 AND status = 'pending'`, [dedupeKey]);
    const [last] = prev ? [prev] : await run<{ summary: DecisionSummary }>(`SELECT summary FROM decisions WHERE kind = 'package_release' AND target_kind = 'bid_invite' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`, [String(inv.id)]);
    const summary: DecisionSummary = {
      recipients: [{ name: inv.name, address, role: inv.trade || pkg.trade || "sub" }],
      inclusions,
      exclusions,
      quantities: input.quantities ?? [],
      attachments,
      assumptions: input.assumptions ?? [],
      gaps: input.gaps ?? [],
      changes: [],
      packageRevision,
      dueDate: pkg.due_date,
      inviteMessage: inv.message,
      effect: manual
        ? `Approving hands the ${pkg.title} package text to Joe to paste on ${manual.marketplace} for ${inv.name}; nothing is sent automatically.`
        : `Approving emails the ${pkg.title} package (rev ${packageRevision}) with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"} to ${inv.name} <${address}> only. Other recipients are separate cards.`,
    };
    summary.changes = diffSummary(last?.summary ?? null, summary);
    const content = { packageId: pkg.id, inviteId: inv.id, packageRevision, address, inclusions, exclusions, quantities: summary.quantities, attachments: attachments.map((a) => a.fileId), message: inv.message };
    const staged = await stageDecision(run, {
      kind: "package_release",
      action: "send_bid_package",
      title: `Release ${pkg.title} to ${inv.name} · ${pkg.project_name}`.slice(0, 300),
      summary,
      targetKind: "bid_invite",
      targetId: inv.id,
      recipient: address,
      content,
      artifactRevision: packageRevision,
      projectId: pkg.project_id,
      href: input.href ?? `/projects/${pkg.slug}`,
      dedupeKey,
      options: ["approve", "request_changes", "hold"],
      requestedBy: input.principal,
    });
    cards.push({ inviteId: Number(inv.id), recipient: { name: inv.name, address, role: inv.trade || pkg.trade || "sub" }, revision: packageRevision, decision: staged.decision, created: staged.created, superseded: staged.superseded, changes: summary.changes ?? [], manualSteps: manual?.steps ?? null });
  }
  return { ok: true, cards, packageRevision };
}

export interface SupplierPricingRequestInput {
  projectId: string;
  vendorId: string;
  products: { description: string; model?: string; variant?: string; finish?: string; unit: string; qty: number | null; qtyGap?: string | null }[];
  neededBy?: string | null;
  attachments?: { label: string; fileId: string; revision?: string }[];
  notes?: string;
  principal: Principal;
  href?: string | null;
}

/** Stage a supplier pricing request (W05) — same review-card discipline.
 *  Proxy shape; WS-estimating's own tool supersedes this when present. */
export async function stageSupplierPricingRequest(run: Run, input: SupplierPricingRequestInput): Promise<{ ok: true; decision: Decision; created: boolean; manualSteps: string[] | null } | { ok: false; reason: string }> {
  const [v] = await run<{ id: string; name: string; trade: string; email: string | null; phone: string | null; notes: string }>(`SELECT id, name, trade, email, phone, notes FROM vendors WHERE id = $1`, [input.vendorId]);
  if (!v) return { ok: false, reason: "Vendor not found in the trusted records." };
  const address = (v.email ?? v.phone ?? "").trim().toLowerCase();
  if (!address) return { ok: false, reason: `${v.name} has no email or phone on record.` };
  if (!input.products.length) return { ok: false, reason: "A pricing request needs at least one exact product." };
  const [p] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [input.projectId]);
  const manual = manualMarketplaceFor({ name: v.name, email: v.email, notes: v.notes });
  const quantities = input.products.map((pr) => ({ label: [pr.description, pr.model, pr.variant, pr.finish].filter(Boolean).join(" · "), qty: pr.qty ?? (pr.qtyGap ? `unknown — ${pr.qtyGap}` : "unknown"), unit: pr.unit }));
  const gaps = input.products.filter((pr) => pr.qty == null).map((pr) => `${pr.description}: quantity not known${pr.qtyGap ? ` (${pr.qtyGap})` : ""}`);
  const revision = hashInput({ vendorId: v.id, products: input.products, neededBy: input.neededBy ?? null, attachments: input.attachments ?? [] }).slice(0, 16);
  const summary: DecisionSummary = {
    recipients: [{ name: v.name, address, role: v.trade || "supplier" }],
    inclusions: quantities.map((q) => `${q.qty} ${q.unit} ${q.label}`),
    quantities,
    attachments: input.attachments ?? [],
    gaps,
    assumptions: input.notes ? [input.notes] : [],
    neededBy: input.neededBy ?? null,
    effect: manual
      ? `Approving hands the request text to Joe to paste for ${v.name}; nothing is sent automatically.`
      : `Approving emails a non-binding pricing request (rev ${revision}) to ${v.name} <${address}>. It commits nothing.`,
  };
  const staged = await stageDecision(run, {
    kind: "package_release",
    action: "send_supplier_pricing_request",
    title: `Pricing request to ${v.name}${p ? ` · ${p.name}` : ""}`.slice(0, 300),
    summary,
    targetKind: "vendor",
    targetId: v.id,
    recipient: address,
    content: { vendorId: v.id, projectId: input.projectId, products: input.products, neededBy: input.neededBy ?? null, attachments: (input.attachments ?? []).map((a) => a.fileId) },
    artifactRevision: revision,
    projectId: input.projectId,
    href: input.href ?? (p ? `/projects/${p.slug}` : null),
    dedupeKey: `pricing_request:${input.projectId}:${v.id}`,
    options: ["approve", "request_changes", "hold"],
    requestedBy: input.principal,
  });
  return { ok: true, decision: staged.decision, created: staged.created, manualSteps: manual?.steps ?? null };
}

/** Choose a bid to price the estimate with. Not an award: no invite/package
 *  state changes; a 'bid_choice' decision records the owner's choice with
 *  comparable scope/cost/exclusions/lead time. */
export async function selectBidForEstimate(run: Run, input: { inviteId: number; principal: Principal; rationale?: string; href?: string | null }): Promise<{ ok: true; decision: Decision; created: boolean } | { ok: false; reason: string }> {
  const [inv] = await run<{ id: number; sub_slug: string; status: string; package_id: number; title: string; project_id: string; project_name: string; slug: string; sub_name: string }>(
    `SELECT i.id, i.sub_slug, i.status, b.id AS package_id, b.title, b.project_id, p.name AS project_name, p.slug, s.name AS sub_name
       FROM bid_invites i JOIN bid_packages b ON b.id = i.package_id JOIN projects p ON p.id = b.project_id JOIN subs s ON s.slug = i.sub_slug WHERE i.id = $1`,
    [input.inviteId],
  );
  if (!inv) return { ok: false, reason: "Bid invite not found." };
  const bids = await run<{ invite_id: number; sub_name: string; total: number; exclusions: string; lead_time: string; revision: number }>(
    `SELECT DISTINCT ON (i.id) i.id AS invite_id, s.name AS sub_name, bs.total, bs.exclusions, bs.lead_time, bs.revision
       FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug JOIN bid_submissions bs ON bs.invite_id = i.id
      WHERE i.package_id = $1 ORDER BY i.id, bs.revision DESC`,
    [inv.package_id],
  );
  const chosen = bids.find((b) => Number(b.invite_id) === Number(inv.id));
  if (!chosen) return { ok: false, reason: "That invite has no recorded bid." };
  const comparison = bids.map((b) => ({ sub: b.sub_name, total: usd(Number(b.total)), exclusions: b.exclusions, leadTime: b.lead_time, revision: b.revision, chosen: Number(b.invite_id) === Number(inv.id) }));
  const staged = await stageDecision(run, {
    kind: "bid_choice",
    action: "use_bid_in_estimate",
    title: `Use ${inv.sub_name}'s bid (${usd(Number(chosen.total))}) for ${inv.title} in the estimate · ${inv.project_name}`.slice(0, 300),
    summary: {
      comparison,
      recommendation: input.rationale ?? "",
      effect: `Approving prices the ${inv.title} scope in the formal estimate from ${inv.sub_name}'s bid rev ${chosen.revision}. It does NOT award the work, order anything, or notify any sub; awarding is a separate purchase decision.`,
    },
    targetKind: "bid_invite",
    targetId: inv.id,
    amountCents: Number(chosen.total),
    content: { inviteId: inv.id, total: Number(chosen.total), revision: chosen.revision },
    artifactRevision: `bid-rev${chosen.revision}`,
    projectId: inv.project_id,
    href: input.href ?? `/projects/${inv.slug}`,
    dedupeKey: `bid_choice:${inv.package_id}`,
    requestedBy: input.principal,
  });
  return { ok: true, decision: staged.decision, created: staged.created };
}

export type AwardResult =
  | { ok: true; commitmentId: number; result: CommitResult }
  | { ok: false; reason: string; staged?: { commitmentId: number; decisionId: string; preview: Record<string, unknown> } };

/** Award a sub bid: a sub_award commitment under a consumed 'purchase'
 *  decision. Without `decisionId` the decision is staged and the award is
 *  refused with the decision to approve. */
export async function awardBid(
  run: Run,
  input: { inviteId: number; decisionId?: string | null; principal: Principal; constructionGate?: ConstructionGate; preconstructionService?: boolean; href?: string | null; commandId?: string | null },
): Promise<AwardResult> {
  const [inv] = await run<{ status: string }>(`SELECT status FROM bid_invites WHERE id = $1`, [input.inviteId]);
  if (!inv) return { ok: false, reason: "Bid invite not found." };
  if (inv.status === "awarded") return { ok: false, reason: "Already awarded." };
  if (inv.status !== "submitted") return { ok: false, reason: "Only a submitted bid can be awarded." };
  const prep = await prepareCommitment(run, { source: { kind: "sub_award", inviteId: input.inviteId }, principal: input.principal });
  if (!prep.ok) return { ok: false, reason: prep.reason };
  const c = prep.commitment;
  if (!input.decisionId) {
    const staged = await stagePurchaseDecision(run, { commitmentId: c.id, principal: input.principal, href: input.href ?? null });
    if (!staged.ok) return { ok: false, reason: staged.reason };
    return {
      ok: false,
      reason: `Awarding is a binding commitment of ${usd(c.total_cents)} to ${c.payee_name}; purchase decision ${staged.decision.id} is staged for approval.`,
      staged: { commitmentId: c.id, decisionId: staged.decision.id, preview: staged.decision.summary },
    };
  }
  const result = await commitOnApproval(run, { commitmentId: c.id, decisionId: input.decisionId, principal: input.principal, constructionGate: input.constructionGate, preconstructionService: input.preconstructionService, commandId: input.commandId ?? null });
  return { ok: true, commitmentId: c.id, result };
}
