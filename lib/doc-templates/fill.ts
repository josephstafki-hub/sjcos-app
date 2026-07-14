import "server-only";

// DB-backed auto-field resolution for document templates. Pulls facts from
// projects / estimates / invoices / retainers / project_punch / app_settings and
// marks each field 'auto' (resolved) or 'missing'. Owner/AI fields start
// 'missing' and are filled later via applyFieldEdits. Re-exports the pure fill
// logic so callers have a single import surface. See docs/doc-templates-plan.md.

import { query, queryOne } from "../db";
import { fmtUsd, unitLabel } from "../cost-book-units";
import {
  drawAmount,
  gatherDocData,
  getCompanyDocInfo,
  type CompanyDocInfo,
} from "../documents";
import { DRAW_TRIGGER_STATUSES } from "../draw-schedule";
import { BILLING_RATE_ROWS, MARKUP_KEY, MARKUP_DEFAULT } from "../billing-rates";
import type { FieldValues, TableValue } from "./types";
import { getTemplate } from "./registry";
import { type FillReport, type FillMark } from "./fill-validate";

export { applyFieldEdits, validateForRender } from "./fill-validate";
export type { FillReport, FillMark, Actor, ApplyResult } from "./fill-validate";

export interface FillScope {
  slug?: string; // project slug
  leadSlug?: string; // lead slug (precon before a project row exists)
  estimateId?: number;
  invoiceId?: number;
  changeOrderId?: number;
}

export interface ResolveResult {
  values: FieldValues;
  fillReport: FillReport;
  title: string;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
function today(): string {
  return fmtDate(new Date());
}
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

const drawTriggerLabel = (key?: string) =>
  DRAW_TRIGGER_STATUSES.find((t) => t.key === (key ?? ""))?.label ?? "Manual";

/** Accumulator that records auto/missing marks as values are set. */
class Fill {
  values: FieldValues = {};
  report: FillReport = {};
  set(key: string, value: unknown, mark: FillMark = "auto") {
    const empty =
      value == null ||
      value === "" ||
      (typeof value === "object" && "rows" in (value as object) && (value as TableValue).rows.length === 0);
    this.values[key] = (value ?? null) as FieldValues[string];
    this.report[key] = empty ? "missing" : mark;
  }
  /** Mark a field the caller will require but can't auto-resolve (owner/ai). */
  pending(key: string) {
    if (!(key in this.report)) this.report[key] = "missing";
  }
}

function setCompany(f: Fill, info: CompanyDocInfo) {
  f.set("company_name", info.company.name);
  f.set("company_address", info.company.address);
  f.set("company_phone", info.company.phone);
  f.set("company_email", info.company.email);
  f.set("company_license", info.company.license);
}

/** Mark every field in the manifest that wasn't set (owner/ai) as pending. */
function fillPending(f: Fill, templateKey: string) {
  const t = getTemplate(templateKey);
  if (!t) return;
  for (const field of t.fields) f.pending(field.key);
}

// ─── Per-template resolvers ──────────────────────────────────────────────────

async function resolveContract(f: Fill, scope: FillScope) {
  if (!scope.slug || !scope.estimateId) return;
  const d = await gatherDocData(scope.estimateId, scope.slug);
  if (!d) return;

  f.set("contract_number", `SJC-C-${d.projectSlug}-${scope.estimateId}`);
  f.set("contract_date", today());
  f.set("contract_total", d.total); // cents
  f.set("client_name", d.clientName);
  f.set("client_email", d.clientEmail);
  f.set("project_address", await projectAddress(scope.slug));

  // Payment schedule table.
  const payRows = d.drawSchedule.map((dl) => [
    dl.label,
    `${dl.percent}%`,
    fmtUsd(drawAmount(d.total, dl.percent)),
    drawTriggerLabel(dl.triggerStatus),
  ]);
  f.set("payment_schedule_table", {
    columns: ["Milestone", "% of total", "Amount", "Due"],
    rows: payRows,
  } as TableValue);

  // SOW line items table (grouped, with subtotals + grand total).
  const rows: string[][] = [];
  for (const g of d.groups) {
    rows.push([g.section.toUpperCase(), "", ""]);
    for (const l of g.lines) {
      rows.push([l.description, `${l.qty} ${unitLabel(l.unit)}`, fmtUsd(l.extended)]);
    }
    rows.push([`${g.section} subtotal`, "", fmtUsd(g.subtotal)]);
  }
  rows.push(["TOTAL", "", fmtUsd(d.total)]);
  f.set("sow_line_items_table", {
    columns: ["Description", "Qty", "Amount"],
    rows,
    emphasizeLast: true,
  } as TableValue);
}

async function resolvePrecon(f: Fill, scope: FillScope) {
  const ref = scope.leadSlug ?? scope.slug ?? "";
  f.set("agreement_number", ref ? `SJC-P-${ref}` : "");
  f.set("agreement_date", today());

  if (scope.slug) {
    const p = await queryOne<{ client_name: string; address: string | null }>(
      `SELECT client_name, address FROM projects WHERE slug = $1`,
      [scope.slug],
    );
    if (p) {
      f.set("client_name", p.client_name);
      f.set("project_address", p.address ?? "");
    }
    f.set("client_email", await clientEmailForProject(scope.slug));
  } else if (scope.leadSlug) {
    const lead = await queryOne<{
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
    }>(`SELECT name, email, phone, address FROM leads WHERE slug = $1`, [scope.leadSlug]);
    if (lead) {
      f.set("client_name", lead.name);
      f.set("client_email", lead.email ?? "");
      f.set("client_phone", lead.phone ?? "");
      f.set("project_address", lead.address ?? "");
    }
  }

  const s = await settings([MARKUP_KEY]);
  f.set("markup_pct", s.get(MARKUP_KEY) || MARKUP_DEFAULT);
  f.set("billing_rates_table", await billingRatesTable());
}

async function resolveLienRelease(f: Fill, scope: FillScope) {
  if (!scope.slug) return;
  const acct = await projectAccount(scope.slug);
  if (!acct) return;
  f.set("project_name", acct.name);
  f.set("document_date", today());
  f.set("owner_name", acct.clientName);
  f.set("property_address", acct.address);
  f.set("contract_number", `SJC-C-${scope.slug}`);
  f.set("contract_total", acct.contractTotalCents);
  f.set("paid_to_date", acct.paidCents);
  f.set("balance_remaining", acct.contractTotalCents - acct.paidCents);
}

async function resolveCompletionCert(f: Fill, scope: FillScope) {
  if (!scope.slug) return;
  const acct = await projectAccount(scope.slug);
  if (!acct) return;
  f.set("certificate_number", `SJC-SC-${scope.slug}`);
  f.set("document_date", today());
  f.set("contract_number", `SJC-C-${scope.slug}`);
  f.set("project_name", acct.name);
  f.set("project_address", acct.address);
  f.set("client_name", acct.clientName);
  f.set("contract_total", acct.contractTotalCents);
  f.set("paid_to_date", acct.paidCents);
  f.set("balance_due", acct.contractTotalCents - acct.paidCents);

  const punch = await queryOne<{ open: number; done: number }>(
    `SELECT count(*) FILTER (WHERE NOT done)::int AS open,
            count(*) FILTER (WHERE done)::int      AS done
       FROM project_punch WHERE project_id = $1`,
    [acct.id],
  );
  f.set("punch_done", String(punch?.done ?? 0));
  f.set("punch_open", String(punch?.open ?? 0));

  const { rows: open } = await query<{ item: string }>(
    `SELECT item FROM project_punch WHERE project_id = $1 AND NOT done ORDER BY sort_order, id`,
    [acct.id],
  );
  f.set(
    "punch_list_items",
    { columns: ["Open punch list item"], rows: open.map((o) => [o.item]) } as TableValue,
    "auto",
  );
}

async function resolveChangeOrder(f: Fill, scope: FillScope) {
  if (!scope.slug || !scope.changeOrderId) return;
  const co = await queryOne<{
    title: string;
    description: string;
    price_cents: number;
    project_name: string;
    client_name: string;
    address: string | null;
  }>(
    `SELECT c.title, c.description, c.price_cents,
            p.name AS project_name, p.client_name, p.address
       FROM change_orders c JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1 AND p.slug = $2`,
    [scope.changeOrderId, scope.slug],
  );
  if (!co) return;
  f.set("co_number", `SJC-CO-${scope.changeOrderId}`);
  f.set("co_date", today());
  f.set("contract_number", `SJC-C-${scope.slug}`);
  f.set("project_name", co.project_name);
  f.set("client_name", co.client_name);
  f.set("job_site_address", co.address ?? "");
  f.set("added_scope_total", co.price_cents > 0 ? co.price_cents : 0);
  f.set("net_change", co.price_cents);
  f.set("pricing_impact_table", {
    columns: ["Description", "Qty / Unit", "Unit Price", "Total"],
    rows: [[co.title || "Scope change", "1", fmtUsd(co.price_cents), fmtUsd(co.price_cents)]],
  } as TableValue);
}

interface EstimateData {
  projectName: string;
  clientName: string;
  address: string;
  phoneEmail: string;
  subtotal: number;
  total: number;
  lineRows: string[][];
}

async function estimateData(scope: FillScope): Promise<EstimateData | null> {
  if (!scope.estimateId) return null;
  const est = await queryOne<{
    project_id: string | null;
    lead_slug: string | null;
    title: string;
    subtotal: number;
    total: number;
  }>(`SELECT project_id, lead_slug, title, subtotal, total FROM estimates WHERE id = $1`, [scope.estimateId]);
  if (!est) return null;

  let projectName = est.title || "Estimate";
  let clientName = "";
  let address = "";
  let phoneEmail = "";
  if (est.project_id) {
    const p = await queryOne<{ name: string; client_name: string; address: string | null; slug: string }>(
      `SELECT name, client_name, address, slug FROM projects WHERE id = $1`,
      [est.project_id],
    );
    if (p) {
      projectName = p.name;
      clientName = p.client_name;
      address = p.address ?? "";
      phoneEmail = await clientEmailForProject(p.slug);
    }
  } else if (est.lead_slug) {
    const l = await queryOne<{ name: string; email: string | null; phone: string | null; address: string | null }>(
      `SELECT name, email, phone, address FROM leads WHERE slug = $1`,
      [est.lead_slug],
    );
    if (l) {
      clientName = l.name;
      address = l.address ?? "";
      phoneEmail = [l.phone, l.email].filter(Boolean).join(" · ");
    }
  }

  const { rows: lines } = await query<{ description: string; section: string; unit: string; qty: string; extended: number }>(
    `SELECT description, section, unit, qty, extended FROM estimate_lines WHERE estimate_id = $1 ORDER BY section, sort_order, id`,
    [scope.estimateId],
  );
  // Totals render in the grid below the table (matching the docx), so the table
  // holds only the line items.
  const lineRows = lines.map((l) => [l.description, l.section, `${Number(l.qty)} ${unitLabel(l.unit)}`, fmtUsd(l.extended)]);

  return { projectName, clientName, address, phoneEmail, subtotal: est.subtotal, total: est.total, lineRows };
}

async function resolveEstimateDoc(f: Fill, scope: FillScope) {
  const d = await estimateData(scope);
  if (!d) return;
  f.set("estimate_number", `SJC-EST-${scope.estimateId}`);
  f.set("date_prepared", today());
  f.set("valid_until", daysFromNow(30));
  f.set("project_name", d.projectName);
  f.set("client_name", d.clientName);
  f.set("property_address", d.address);
  f.set("client_phone_email", d.phoneEmail);
  f.set("subtotal", d.subtotal);
  f.set("total", d.total);
  f.set("line_items_table", {
    columns: ["Description", "Category", "Qty", "Amount"],
    rows: d.lineRows,
  } as TableValue);
}

async function resolveInvoiceDoc(f: Fill, scope: FillScope) {
  if (!scope.invoiceId) return;
  const inv = await queryOne<{
    number: string;
    amount: number;
    line_items: unknown;
    project_id: string;
    project_name: string;
    client_name: string;
    address: string | null;
    slug: string;
  }>(
    `SELECT i.number, i.amount, i.line_items, i.project_id,
            p.name AS project_name, p.client_name, p.address, p.slug
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1`,
    [scope.invoiceId],
  );
  if (!inv) return;
  const retainer = await queryOne<{ applied: number }>(
    `SELECT applied FROM retainers WHERE project_id = $1`,
    [inv.project_id],
  );
  const applied = retainer?.applied ?? 0;

  f.set("invoice_number", inv.number || `INV-${scope.invoiceId}`);
  f.set("invoice_date", today());
  f.set("due_date", daysFromNow(7));
  f.set("project_name", inv.project_name);
  f.set("client_name", inv.client_name);
  f.set("job_site_address", inv.address ?? "");
  f.set("client_phone_email", await clientEmailForProject(inv.slug));
  f.set("subtotal", inv.amount);
  f.set("retainer_applied", applied);
  f.set("total_due", inv.amount - applied);

  const items = Array.isArray(inv.line_items) ? (inv.line_items as { label?: string; amount?: number }[]) : [];
  const rows = items.map((it) => [String(it.label ?? ""), "", "", fmtUsd(Number(it.amount) || 0)]);
  if (rows.length === 0) rows.push([inv.number || "Invoice", "", "", fmtUsd(inv.amount)]);
  f.set("line_items_table", { columns: ["Description", "Qty", "Rate", "Amount"], rows } as TableValue);
}

async function resolveRoughEstimate(f: Fill, scope: FillScope) {
  if (!scope.leadSlug) return;
  const lead = await queryOne<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  }>(`SELECT id, name, email, phone, address FROM leads WHERE slug = $1`, [scope.leadSlug]);
  if (!lead) return;

  f.set("estimate_number", `SJC-RE-${scope.leadSlug}`);
  f.set("date_prepared", today());
  f.set("valid_until", daysFromNow(30));
  f.set("client_name", lead.name);
  f.set("property_address", lead.address ?? "");
  f.set("client_phone_email", [lead.phone, lead.email].filter(Boolean).join(" · "));

  const est = await queryOne<{ line_items: unknown; total: string }>(
    `SELECT line_items, total FROM lead_estimates WHERE lead_id = $1`,
    [lead.id],
  );
  const items = Array.isArray(est?.line_items) ? (est!.line_items as { label?: string; value?: string }[]) : [];
  f.set("line_items_table", {
    columns: ["Item", "Estimate"],
    rows: items.map((it) => [String(it.label ?? ""), String(it.value ?? "")]),
  } as TableValue);
  f.set("rough_total", est?.total ?? "");
}

// ─── Shared DB helpers ───────────────────────────────────────────────────────

async function settings(keys: string[]): Promise<Map<string, string>> {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
    [keys],
  );
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function projectAddress(slug: string): Promise<string> {
  const p = await queryOne<{ address: string | null }>(
    `SELECT address FROM projects WHERE slug = $1`,
    [slug],
  );
  return p?.address ?? "";
}

async function clientEmailForProject(slug: string): Promise<string> {
  const u = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE role = 'client' AND link_slug = $1 LIMIT 1`,
    [slug],
  );
  return u?.email ?? "";
}

interface ProjectAccount {
  id: string;
  name: string;
  clientName: string;
  address: string;
  contractTotalCents: number;
  paidCents: number;
}

/**
 * Money for the closeout docs. projects.contract_value / collected_to_date are
 * whole DOLLARS (Phase 5.0 left the project headline figures in dollars);
 * approved change_orders.price_cents are CENTS. Everything here is normalized to
 * CENTS. Internally consistent so balance = total − paid (attorney/owner review
 * the figures — see the disclaimer footer).
 */
async function projectAccount(slug: string): Promise<ProjectAccount | null> {
  const p = await queryOne<{
    id: string;
    name: string;
    client_name: string;
    address: string | null;
    contract_value: number;
    collected_to_date: number;
  }>(
    `SELECT id, name, client_name, address, contract_value, collected_to_date
       FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!p) return null;
  const co = await queryOne<{ sum: number }>(
    `SELECT COALESCE(sum(price_cents), 0)::int AS sum
       FROM change_orders WHERE project_id = $1 AND status = 'approved'`,
    [p.id],
  );
  return {
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    address: p.address ?? "",
    contractTotalCents: (p.contract_value ?? 0) * 100 + (co?.sum ?? 0),
    paidCents: (p.collected_to_date ?? 0) * 100,
  };
}

async function billingRatesTable(): Promise<TableValue> {
  const s = await settings(BILLING_RATE_ROWS.map((r) => r.key));
  return {
    columns: ["Role", "Rate"],
    rows: BILLING_RATE_ROWS.map((r) => [r.label, s.get(r.key) || r.default]),
  };
}

// ─── Public entry ────────────────────────────────────────────────────────────

export async function resolveAutoFields(
  templateKey: string,
  scope: FillScope,
): Promise<ResolveResult> {
  const template = getTemplate(templateKey);
  if (!template) throw new Error(`Unknown template: ${templateKey}`);

  const f = new Fill();
  setCompany(f, await getCompanyDocInfo());

  switch (templateKey) {
    case "contract":
      await resolveContract(f, scope);
      break;
    case "precon":
      await resolvePrecon(f, scope);
      break;
    case "lien_release":
      await resolveLienRelease(f, scope);
      break;
    case "completion_cert":
      await resolveCompletionCert(f, scope);
      break;
    case "change_order":
      await resolveChangeOrder(f, scope);
      break;
    case "estimate_doc":
      await resolveEstimateDoc(f, scope);
      break;
    case "invoice_doc":
      await resolveInvoiceDoc(f, scope);
      break;
    case "rough_estimate":
      await resolveRoughEstimate(f, scope);
      break;
    default:
      break;
  }

  fillPending(f, templateKey);
  const title = template.titleFor ? template.titleFor(f.values) : template.title;
  return { values: f.values, fillReport: f.report, title };
}
