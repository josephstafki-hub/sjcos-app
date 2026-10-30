// What an approved release card does (Tier 3: approving one used to send
// nothing). A 'package_release' decision is the approval for exactly one
// email, so no second grant is needed:
//
//   send_bid_package               — the bid request to ONE sub (one card per
//                                    invite), packet attached.
//   send_supplier_pricing_request  — a nonbinding pricing request to one
//                                    supplier (either stager: the estimating
//                                    one with a supplier_pricing_requests row,
//                                    or the procurement one that carries the
//                                    request on the card).
//
// The content is rebuilt from the records as they stand NOW and hashed: a
// package, packet, note or address edited after the card was made gives a
// different hash and nothing is sent (a fresh card is needed). The intent
// carries the decision, and the dispatcher spends it (lib/dispatch/authority).
//
// Pure: `run` only. The Next glue (lib/bidding.ts sendApprovedRelease) checks
// the packet files on disk, then dispatches after commit.

import type { Run } from "../commands/core.ts";
import { contentHashOf, type Decision } from "../commands/decisions.ts";
import { enqueueIntent } from "../commands/intents.ts";
import type { Principal } from "../commands/principal.ts";
import { composeBidEmail } from "../bidding-email.ts";
import { packageForRelease, packageRevisionOf, releaseContentOf } from "./packages.ts";
import { manualMarketplaceFor } from "./vendor-rules.ts";

export const RELEASE_ACTIONS = ["send_bid_package", "send_supplier_pricing_request"] as const;

export interface ReleaseFile {
  fileId: string;
  filename: string;
  mimeType: string;
  label: string;
}

export type ReleaseResult =
  | { ok: true; intentId: string; state: string; to: string; label: string }
  | { ok: false; reason: string };

/** The files an approved card sends (the glue checks them on disk first). */
export async function releaseFileIds(run: Run, d: Decision): Promise<string[]> {
  if (d.action === "send_bid_package") {
    const rows = await run<{ file_id: string }>(
      `SELECT bf.file_id FROM bid_invites i JOIN bid_package_files bf ON bf.package_id = i.package_id WHERE i.id = $1 ORDER BY bf.sort_order, bf.id`,
      [Number(d.target_id)],
    );
    return rows.map((r) => r.file_id);
  }
  const list = (d.summary as { attachments?: { fileId?: string }[] }).attachments ?? [];
  return list.map((a) => a.fileId).filter((x): x is string => Boolean(x));
}

/** Queue the one email an approved release card covers. */
export async function enqueueApprovedRelease(run: Run, d: Decision, files: ReleaseFile[]): Promise<ReleaseResult> {
  if (d.status !== "approved") return { ok: false, reason: `The card is ${d.status}.` };
  if (d.action === "send_bid_package") return bidRelease(run, d, files);
  if (d.action === "send_supplier_pricing_request") return pricingRelease(run, d, files);
  return { ok: false, reason: `${d.action} is not a release card.` };
}

const principalFor = (d: Decision): Principal => ({ kind: "service", name: `release-card:${d.id}` });

async function bidRelease(run: Run, d: Decision, files: ReleaseFile[]): Promise<ReleaseResult> {
  const inviteId = Number(d.target_id);
  const [inv] = await run<{ id: number; package_id: number; status: string; message: string; name: string; notes: string | null; email: string | null; phone: string | null; due_label: string | null }>(
    `SELECT i.id, i.package_id, i.status, i.message, s.name, s.notes, s.email, s.phone, to_char(b.due_date, 'FMMon FMDD') AS due_label
       FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug JOIN bid_packages b ON b.id = i.package_id WHERE i.id = $1`,
    [inviteId],
  );
  if (!inv) return { ok: false, reason: "The invite on this card no longer exists." };
  if (inv.status !== "draft") return { ok: false, reason: `${inv.name} was already sent this package (invite is ${inv.status}).` };
  const loaded = await packageForRelease(run, Number(inv.package_id));
  if (!loaded) return { ok: false, reason: "The bid package no longer exists." };
  if (loaded.pkg.status === "awarded" || loaded.pkg.status === "closed") return { ok: false, reason: `The package is ${loaded.pkg.status}; reopen it first.` };
  const manual = manualMarketplaceFor({ name: inv.name, email: inv.email });
  if (manual) return { ok: false, reason: `${inv.name} is reached through ${manual.marketplace}: paste the package there yourself. Nothing was emailed.` };
  const to = (inv.email ?? "").trim().toLowerCase();
  if (!to) return { ok: false, reason: `${inv.name} has no email on the sub record, so nothing was emailed.` };

  const sm = d.summary as { inclusions?: string[]; exclusions?: string[]; quantities?: unknown[] };
  const parts = { inclusions: sm.inclusions ?? [], exclusions: sm.exclusions ?? [], quantities: sm.quantities ?? [] };
  // inv.id / pkg.id read exactly as the stager read them (bigint comes back as
  // text), so the rebuilt content hashes the same.
  const content = releaseContentOf({ packageId: loaded.pkg.id, inviteId: inv.id, packageRevision: packageRevisionOf(loaded, parts), address: to, ...parts, attachments: loaded.attachments, message: inv.message });
  if (contentHashOf(content) !== d.content_hash) {
    return { ok: false, reason: `The ${loaded.pkg.title} package, its files, ${inv.name}'s note or address changed after this card was made. Nothing was emailed; release it again for a fresh card.` };
  }
  if (!files.length) return { ok: false, reason: "The package has no files attached. Nothing was emailed." };

  const { subject, body } = composeBidEmail(inv.name, inv.notes, { title: loaded.pkg.title, project_name: loaded.pkg.project_name, scope_notes: loaded.pkg.scope_notes, due_label: inv.due_label }, inv.message.trim(), files.map((f) => f.label));
  const { intent } = await enqueueIntent(run, {
    operationKey: `release:${d.id}`,
    kind: "send_bid_package",
    targetKind: "bid_package",
    targetId: String(loaded.pkg.id),
    recipient: to,
    projectId: loaded.pkg.project_id,
    decisionId: d.id,
    principal: principalFor(d),
    payload: {
      to,
      subject,
      bodyText: body,
      attachments: files.map((f) => ({ filename: f.filename, mimeType: f.mimeType, fileId: f.fileId })),
      invite_id: inviteId,
      sub_name: inv.name,
      package_title: loaded.pkg.title,
      project_name: loaded.pkg.project_name,
      slug: loaded.pkg.slug,
      _auth: { action: "send_bid_package", target_kind: "bid_invite", target_id: String(inviteId), to, content_hash: d.content_hash },
    },
  });
  return { ok: true, intentId: intent.id, state: intent.state, to, label: `${loaded.pkg.title} to ${inv.name}` };
}

interface RequestLine {
  label: string;
  qty: number | null;
  unit: string | null;
  gap: string | null;
}

interface PricingRequest {
  supplierName: string;
  vendorId: string | null;
  projectId: string;
  lines: RequestLine[];
  neededBy: string | null;
  quoteBy: string | null;
  notes: string;
  /** supplier_pricing_requests.id when the estimating stager made it. */
  requestId: string | null;
}

/** Rebuild the approved pricing request and check it against the card. */
async function approvedPricingRequest(run: Run, d: Decision): Promise<PricingRequest | { reason: string }> {
  if (d.target_kind === "supplier_pricing_request") {
    const [row] = await run<{ id: string; project_id: string; supplier_name: string; vendor_id: string | null; recipient: string | null; status: string; payload: Record<string, unknown> }>(
      `SELECT id, project_id, supplier_name, vendor_id, recipient, status, payload FROM supplier_pricing_requests WHERE id = $1`,
      [d.target_id],
    );
    if (!row) return { reason: "The pricing request on this card no longer exists." };
    if (row.status === "sent") return { reason: `The request to ${row.supplier_name} was already sent.` };
    if (row.status === "superseded") return { reason: `A newer request to ${row.supplier_name} replaced this one.` };
    if (contentHashOf(row.payload) !== d.content_hash) return { reason: "The request changed after this card was made. Nothing was emailed." };
    const pl = row.payload as { products?: { product?: Record<string, string | undefined>; product_key?: string; quantity?: number | null; unit?: string | null; quantity_gap?: string | null }[]; need_dates?: { materials_on_site?: string | null; quote_by?: string | null }; notes?: string };
    return {
      supplierName: row.supplier_name,
      vendorId: row.vendor_id,
      projectId: row.project_id,
      lines: (pl.products ?? []).map((p) => ({ label: productLabel(p.product ?? {}) || p.product_key || "item", qty: p.quantity ?? null, unit: p.unit ?? null, gap: p.quantity_gap ?? null })),
      neededBy: pl.need_dates?.materials_on_site ?? null,
      quoteBy: pl.need_dates?.quote_by ?? null,
      notes: pl.notes ?? "",
      requestId: row.id,
    };
  }
  const req = (d.summary as { request?: { vendorId: string; projectId: string; products: { description: string; model?: string; variant?: string; finish?: string; unit: string; qty: number | null; qtyGap?: string | null }[]; neededBy: string | null; notes?: string } }).request;
  if (!req) return { reason: "This card is from before approved requests could send. Stage the pricing request again for a fresh card." };
  if (contentHashOf(req) !== d.content_hash) return { reason: "The request on this card doesn't match what was approved. Nothing was emailed." };
  const [v] = await run<{ name: string }>(`SELECT name FROM vendors WHERE id = $1`, [req.vendorId]);
  return {
    supplierName: v?.name ?? "the supplier",
    vendorId: req.vendorId,
    projectId: req.projectId,
    lines: req.products.map((p) => ({ label: [p.description, p.model, p.variant, p.finish].filter(Boolean).join(" · "), qty: p.qty, unit: p.unit, gap: p.qty == null ? (p.qtyGap ?? "quantity not yet measured — please quote per unit") : null })),
    neededBy: req.neededBy,
    quoteBy: null,
    notes: req.notes ?? "",
    requestId: null,
  };
}

function productLabel(p: Record<string, string | undefined>): string {
  const parts = [p.brand, p.name, p.model, p.variant, p.finish, p.sku ? `SKU ${p.sku}` : undefined].filter((x): x is string => Boolean(x && x.trim()));
  return [...new Set(parts)].join(" ");
}

function greetingName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/** The pricing request email: plain, nonbinding, nothing about the client's price. */
export function composePricingRequestEmail(supplierName: string, projectName: string, r: Pick<PricingRequest, "lines" | "neededBy" | "quoteBy" | "notes">, fileLabels: string[]): { subject: string; body: string } {
  const lines = r.lines.map((l) => `- ${l.qty != null ? `${l.qty}${l.unit ? ` ${l.unit}` : ""} ` : ""}${l.label}${l.gap ? ` (${l.gap})` : ""}`);
  const body = [
    `Hi ${greetingName(supplierName)},`,
    "",
    `Could you send current pricing, lead time, tax and delivery for these items? It's for a job I'm pricing (${projectName}).`,
    "",
    ...lines,
    ...(r.neededBy ? ["", `Materials would be needed on site by ${r.neededBy}.`] : []),
    ...(r.quoteBy ? ["", `A quote by ${r.quoteBy} would help.`] : []),
    ...(r.notes.trim() ? ["", r.notes.trim()] : []),
    ...(fileLabels.length ? ["", `Attached: ${fileLabels.join(", ")}.`] : []),
    "",
    "This is a request for pricing, not an order.",
    "",
    "Thanks,",
    "Joe",
    "SJ Carpentry LLC",
    "612-361-6585",
  ].join("\n");
  return { subject: `Pricing request: ${projectName}`, body };
}

async function pricingRelease(run: Run, d: Decision, files: ReleaseFile[]): Promise<ReleaseResult> {
  const req = await approvedPricingRequest(run, d);
  if ("reason" in req) return { ok: false, reason: req.reason };
  const [vendor] = req.vendorId ? await run<{ name: string; email: string | null; notes: string | null }>(`SELECT name, email, notes FROM vendors WHERE id = $1`, [req.vendorId]) : [];
  const manual = vendor ? manualMarketplaceFor({ name: vendor.name, email: vendor.email, notes: vendor.notes }) : null;
  if (manual) return { ok: false, reason: `${vendor!.name} is reached through ${manual.marketplace}: paste the request there yourself. Nothing was emailed.` };
  const to = (vendor?.email ?? "").trim().toLowerCase();
  if (!to) return { ok: false, reason: `${req.supplierName} has no email on the vendor record, so nothing was emailed.` };
  if (!d.recipient) return { ok: false, reason: `This card had no email for ${req.supplierName}, so it named no recipient. Stage the request again now that one is on file.` };
  if (d.recipient !== to) return { ok: false, reason: `${req.supplierName}'s email changed after this card was made (${d.recipient} → ${to}). Nothing was emailed; stage the request again.` };
  const [p] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [req.projectId]);
  const { subject, body } = composePricingRequestEmail(req.supplierName, p?.name ?? "a job", req, files.map((f) => f.label));
  const { intent } = await enqueueIntent(run, {
    operationKey: `release:${d.id}`,
    kind: "send_email",
    targetKind: d.target_kind,
    targetId: d.target_id,
    recipient: to,
    projectId: req.projectId,
    decisionId: d.id,
    principal: principalFor(d),
    payload: {
      to,
      subject,
      bodyText: body,
      attachments: files.map((f) => ({ filename: f.filename, mimeType: f.mimeType, fileId: f.fileId })),
      pricing_request_id: req.requestId,
      supplier_name: req.supplierName,
      project_name: p?.name ?? null,
      slug: p?.slug ?? null,
      _auth: { action: "send_supplier_pricing_request", target_kind: d.target_kind ?? undefined, target_id: d.target_id ?? undefined, to, content_hash: d.content_hash },
    },
  });
  return { ok: true, intentId: intent.id, state: intent.state, to, label: `pricing request to ${req.supplierName}` };
}
