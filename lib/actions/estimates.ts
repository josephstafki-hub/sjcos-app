"use server";

// Estimate write paths (Phase-2 B2). Owner-gated. Reads stay in lib/estimates.ts.
// Money is cents. Estimate totals are recomputed from the lines after every line
// mutation. Lines snapshot their unit_cost/markup so later cost-book edits don't
// rewrite historical estimates.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { dollarsToCents, fmtUsd, unitLabel } from "@/lib/cost-book-units";
import { getDefaultMarkup } from "@/lib/cost-book";
import { getProjectSignerDefaults } from "@/lib/esign";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import { renderProjectEstimatePdf } from "@/lib/doc-drafts";
import { renderInlineDocPdf } from "@/lib/documents";
import { storeBuffer } from "@/lib/upload-store";
import type { EstimateRail } from "@/lib/estimates";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const RAILS: EstimateRail[] = ["design_build", "plans", "merged"];

/** Recompute + persist an estimate's subtotal / markup / total from its lines. */
async function recompute(estimateId: number) {
  await query(
    `UPDATE estimates
        SET subtotal = s.sub, total = s.tot, markup_total = s.tot - s.sub
       FROM (
         SELECT COALESCE(round(sum(qty * unit_cost)), 0)::int AS sub,
                COALESCE(sum(extended), 0)::int            AS tot
           FROM estimate_lines WHERE estimate_id = $1
       ) s
      WHERE estimates.id = $1`,
    [estimateId],
  );
}

function parseLine(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  const section = String(formData.get("section") ?? "General").trim() || "General";
  const unit = String(formData.get("unit") ?? "ea").trim() || "ea";
  const qty = Math.max(0, Number(formData.get("qty")) || 0);
  const unitCost = dollarsToCents(String(formData.get("unitCost") ?? ""));
  const markup = Math.max(0, Math.min(999, Number(formData.get("markup")) || 0));
  const costItemRaw = String(formData.get("costItemId") ?? "").trim();
  const costItemId = costItemRaw && /^\d+$/.test(costItemRaw) ? Number(costItemRaw) : null;
  const extended = Math.round(qty * unitCost * (1 + markup / 100));
  return { description, section, unit, qty, unitCost, markup, costItemId, extended };
}

export async function createEstimate(slug: string, formData: FormData): Promise<Result> {
  const user = await requireRole("owner");
  const title = String(formData.get("title") ?? "").trim() || "Estimate";
  const railRaw = String(formData.get("rail") ?? "plans") as EstimateRail;
  const rail = RAILS.includes(railRaw) ? railRaw : "plans";

  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return { ok: false, error: "Project not found." };

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO estimates (project_id, title, rail, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [proj.id, title, rail, user.id],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: Number(ins!.id) };
}

export async function deleteEstimate(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM estimates WHERE id = $1`, [id]);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function addEstimateLine(estimateId: number, slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parseLine(formData);
  if (!v.description) return { ok: false, error: "A line description is required." };
  await query(
    `INSERT INTO estimate_lines
       (estimate_id, cost_item_id, description, section, unit, qty, unit_cost, markup, extended,
        sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
        COALESCE((SELECT max(sort_order)+1 FROM estimate_lines WHERE estimate_id = $1), 0))`,
    [estimateId, v.costItemId, v.description, v.section, v.unit, v.qty, v.unitCost, v.markup, v.extended],
  );
  await recompute(estimateId);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function updateEstimateLine(lineId: number, slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parseLine(formData);
  if (!v.description) return { ok: false, error: "A line description is required." };
  const row = await queryOne<{ estimate_id: string }>(
    `UPDATE estimate_lines
        SET description=$2, section=$3, unit=$4, qty=$5, unit_cost=$6, markup=$7, extended=$8,
            cost_item_id=$9
      WHERE id=$1 RETURNING estimate_id`,
    [lineId, v.description, v.section, v.unit, v.qty, v.unitCost, v.markup, v.extended, v.costItemId],
  );
  if (row) await recompute(Number(row.estimate_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function deleteEstimateLine(lineId: number, slug: string): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ estimate_id: string }>(
    `DELETE FROM estimate_lines WHERE id = $1 RETURNING estimate_id`,
    [lineId],
  );
  if (row) await recompute(Number(row.estimate_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Send an estimate to the client for e-signature approval (B4). Renders the
 *  estimate to a signature_request (doc_type=estimate, linked via estimate_id),
 *  marks the estimate 'sent'. When the client signs (lib/actions/esign), the
 *  linked estimate flips to 'approved'. */
export async function sendEstimate(slug: string, estimateId: number): Promise<Result> {
  const user = await requireRole("owner");

  const est = await queryOne<{
    id: string;
    title: string;
    status: string;
    subtotal: number;
    markup_total: number;
    total: number;
    project_id: string;
    project_name: string;
  }>(
    `SELECT e.id, e.title, e.status, e.subtotal, e.markup_total, e.total,
            e.project_id, p.name AS project_name
       FROM estimates e JOIN projects p ON p.id = e.project_id
      WHERE e.id = $1 AND p.slug = $2`,
    [estimateId, slug],
  );
  if (!est) return { ok: false, error: "Estimate not found." };
  if (est.status === "sent") return { ok: false, error: "This estimate is already out for signature." };
  if (est.status === "approved") return { ok: false, error: "This estimate is already approved." };

  const { rows: lines } = await query<{
    description: string;
    section: string;
    unit: string;
    qty: string;
    unit_cost: number;
    markup: string;
    extended: number;
  }>(
    `SELECT description, section, unit, qty, unit_cost, markup, extended
       FROM estimate_lines WHERE estimate_id = $1 ORDER BY section, sort_order, id`,
    [estimateId],
  );
  if (lines.length === 0) return { ok: false, error: "Add at least one line before sending." };

  // Build the document body grouped by section.
  const out: string[] = [`ESTIMATE — ${est.title}`, est.project_name, ""];
  let currentSection = "";
  for (const l of lines) {
    if (l.section !== currentSection) {
      currentSection = l.section;
      out.push(`== ${currentSection} ==`);
    }
    out.push(
      `  • ${l.description}: ${Number(l.qty)} ${unitLabel(l.unit)} × ${fmtUsd(l.unit_cost)} (+${Number(l.markup)}%) = ${fmtUsd(l.extended)}`,
    );
  }
  out.push("");
  out.push(`Subtotal (cost): ${fmtUsd(est.subtotal)}`);
  out.push(`Overhead & profit: ${fmtUsd(est.markup_total)}`);
  out.push(`TOTAL: ${fmtUsd(est.total)}`);
  out.push("");
  out.push("By signing, you approve this estimate and authorize SJ Carpentry LLC to proceed to contract.");
  const body = out.join("\n");

  const signer = await getProjectSignerDefaults(slug);

  // The client reviews (and downloads/prints) a real PDF in their portal.
  // Prefer the estimate_doc template render; fall back to the inline body on
  // letterhead; fall back to body-only if PDF generation fails entirely.
  let fileId: string | null = null;
  const pdf =
    (await renderProjectEstimatePdf(slug, estimateId).catch(() => null)) ??
    (await renderInlineDocPdf({
      title: est.title || "Estimate",
      subtitle: est.project_name,
      body,
    }).catch(() => null));
  if (pdf) {
    const stored = await storeBuffer(pdf, {
      filename: `${est.title || "Estimate"}.pdf`,
      mime: "application/pdf",
      idPrefix: "sig",
      projectKey: slug,
      tag: "ESTIMATE",
      subtitle: "Estimate — sent for signature",
    });
    if (stored.ok) fileId = stored.id;
  }

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, estimate_id, doc_type, title, body, file_id, status, signer_name, signer_email, created_by, sent_at)
     VALUES ($1, $2, 'estimate', $3, $4, $5, 'sent', $6, $7, $8, now())
     RETURNING id`,
    [est.project_id, estimateId, est.title, body, fileId, signer.name, signer.email, user.id],
  );
  const reqId = Number(ins!.id);

  await query(
    `INSERT INTO signature_events (request_id, kind, actor, detail)
     VALUES ($1, 'created', $2, $3), ($1, 'sent', $2, $4)`,
    [reqId, user.name || "Owner", est.title, `Sent to ${signer.name || signer.email || "client"}`],
  );

  await query(`UPDATE estimates SET status = 'sent', sent_at = now() WHERE id = $1`, [estimateId]);

  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "mail",
    accent: "ai",
    title: `Estimate sent for approval: ${est.title}`,
    subline: `${fmtUsd(est.total)} — awaiting client signature`,
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true };
}

/** Merge two or more of a project's estimates into a new rail='merged' estimate
 *  (B7). Unions every source line as-is (snapshotted unit_cost/markup/extended
 *  preserved — no re-pricing), keeps section grouping, recomputes totals. The
 *  source estimates are left untouched (non-destructive). */
export async function mergeEstimates(slug: string, sourceIds: number[], title: string): Promise<Result> {
  const user = await requireRole("owner");
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return { ok: false, error: "Project not found." };

  const uniq = Array.from(new Set((sourceIds ?? []).map(Number).filter((n) => Number.isFinite(n))));
  if (uniq.length < 2) return { ok: false, error: "Pick at least two estimates to merge." };

  // Only merge estimates that actually belong to this project.
  const { rows: valid } = await query<{ id: string }>(
    `SELECT e.id FROM estimates e JOIN projects p ON p.id = e.project_id
      WHERE p.slug = $1 AND e.id = ANY($2::bigint[])`,
    [slug, uniq],
  );
  const validIds = valid.map((r) => Number(r.id));
  if (validIds.length < 2) return { ok: false, error: "Pick at least two estimates from this project." };

  const cleanTitle = title.trim() || "Merged estimate";
  const ins = await queryOne<{ id: string }>(
    `INSERT INTO estimates (project_id, title, rail, created_by) VALUES ($1, $2, 'merged', $3) RETURNING id`,
    [proj.id, cleanTitle, user.id],
  );
  const newId = Number(ins!.id);

  // Copy all source lines into the merged estimate, ordered by source then
  // section, re-numbering sort_order sequentially across the union.
  await query(
    `INSERT INTO estimate_lines
       (estimate_id, cost_item_id, description, section, unit, qty, unit_cost, markup, extended, sort_order)
     SELECT $1, cost_item_id, description, section, unit, qty, unit_cost, markup, extended,
            (row_number() OVER (
               ORDER BY array_position($2::bigint[], estimate_id), section, sort_order, id
             ) - 1)::int
       FROM estimate_lines
      WHERE estimate_id = ANY($2::bigint[])`,
    [newId, validIds],
  );
  await recompute(newId);
  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: newId };
}

/** Takeoff: bulk-add lines from cost-book items in one pass (B3). Re-reads each
 *  cost item server-side to snapshot authoritative price/markup (never trusts
 *  client-sent money), then recomputes the estimate once. */
export async function addTakeoffLines(
  estimateId: number,
  slug: string,
  section: string,
  entries: { costItemId: number; qty: number }[],
): Promise<Result> {
  await requireRole("owner");
  const valid = (entries ?? []).filter((e) => e.costItemId && e.qty > 0);
  if (valid.length === 0) return { ok: false, error: "Enter a quantity for at least one item." };

  const def = await getDefaultMarkup();
  const ids = valid.map((e) => e.costItemId);
  const { rows } = await query<{
    id: string;
    name: string;
    unit: string;
    unit_cost: number;
    default_markup: string | null;
  }>(
    `SELECT id, name, unit, unit_cost, default_markup FROM cost_items WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const sec = section.trim() || "General";

  for (const e of valid) {
    const item = byId.get(e.costItemId);
    if (!item) continue;
    const markup = item.default_markup == null ? def : Number(item.default_markup);
    const extended = Math.round(e.qty * item.unit_cost * (1 + markup / 100));
    await query(
      `INSERT INTO estimate_lines
         (estimate_id, cost_item_id, description, section, unit, qty, unit_cost, markup, extended, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
          COALESCE((SELECT max(sort_order)+1 FROM estimate_lines WHERE estimate_id = $1), 0))`,
      [estimateId, item.id, item.name, sec, item.unit, e.qty, item.unit_cost, markup, extended],
    );
  }
  await recompute(estimateId);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Qwen estimate assist: rough phased ranges to guide the owner (advisory only —
 *  not auto-inserted, since local-model dollar figures aren't precise). */
export async function suggestEstimate(
  slug: string,
  notes: string,
): Promise<{ ok: true; lines: { label: string; value: string }[]; total: string } | { ok: false; error: string }> {
  await requireRole("owner");
  const proj = await queryOne<{ name: string; stage_label: string | null }>(
    `SELECT name, stage_label FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };
  const res = await ai.estimate({
    name: proj.name,
    scope: proj.stage_label || proj.name,
    intake: [],
    notes: notes?.trim() || undefined,
  });
  return { ok: true, lines: res.lines, total: res.total };
}
