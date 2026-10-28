// SJC OS MCP — estimates. Wired from sjcos-mcp.mjs:
//
//   import { pricingAndPaperwork, registerEstimateTools } from "./estimate-tools.mjs";
//   registerEstimateTools(server, { rows, json, pool, strippedDollarError });
//
// The rule these tools carry (docs/estimates-and-change-orders.md):
//   • The formal estimate lives under Documents › Formal Estimate (kind
//     'formal'). To add or change its lines, add_estimate_lines on it; the
//     client's PDF is generated from those lines
//     (create_document_draft { template_key: 'estimate_doc', estimate_id }).
//   • Money › Pre-con changes holds client additions or changes priced BEFORE
//     the contract is signed (kind 'precon_change'). AFTER the contract a
//     client change is a change order. No tool here (or anywhere in this
//     server) creates a change order — the client portal lists every non-draft
//     change order (mcp/financials-tools.mjs).
// The database decides which path a job is on (project_scope_change_path())
// and refuses the wrong row by trigger; these tools check first so the agent
// gets a plain-English answer instead of a constraint error.
//
// Nothing here sends or approves anything: sending an estimate for the
// client's approval stays Joe's click in the app. Runtime: plain Node ESM
// importing the pure TypeScript lib directly (Node 22 strips types), same as
// financials-tools.mjs. MONEY IS INTEGER CENTS.

import { z } from "zod";
import {
  ESTIMATE_KIND_HELP,
  ESTIMATE_KIND_LABEL,
  PRICING_RULE,
  WHERE,
  estimateLivesIn,
  preconChangeRefusal,
  scopeChangeContext,
} from "../lib/estimate-kinds.ts";

/** Same fallback as lib/cost-book.ts when the setting is unset. */
const DEFAULT_MARKUP_FALLBACK = 20;

async function scopeContext(rows, projectId) {
  const [p] = await rows(
    `SELECT status, project_has_signed_contract(id) AS signed, project_scope_change_path(id) AS path
       FROM projects WHERE id = $1`,
    [projectId],
  );
  if (!p) return null;
  const ctx = scopeChangeContext(p.status, p.signed);
  ctx.path = p.path ?? ctx.path; // the SQL is authoritative
  return ctx;
}

/** What a document template is generated from — so an agent never files paper without its numbers. */
function renderedFrom(templateKey) {
  switch (templateKey) {
    case "estimate_doc":
    case "contract":
      return `an estimate's lines (estimate_id) — the formal estimate lives under ${WHERE.formalEstimate}`;
    case "change_order":
      return `a change order in ${WHERE.changeOrders} (change_order_id)`;
    case "invoice_doc":
      return "an invoice in Money › Invoices (invoice_id)";
    default:
      return null;
  }
}

/**
 * The `pricing_and_paperwork` block on get_project: the rule, the job's
 * estimates (with the formal one called out), change orders and document
 * drafts, each tagged with where it lives, and which one a client change
 * becomes on THIS job right now.
 */
export async function pricingAndPaperwork(rows, projectId) {
  const ctx = await scopeContext(rows, projectId);
  const [estimates, changeOrders, docs] = await Promise.all([
    rows(
      `SELECT id, title, kind, rail, status, total, sent_at, approved_at, created_at
         FROM estimates WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    ),
    rows(
      `SELECT id, number, title, price_cents, status, created_at
         FROM change_orders WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    ),
    rows(
      `SELECT id, template_key, title, status, created_at
         FROM document_drafts WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    ),
  ]);
  const path = ctx?.path ?? "precon_estimate";
  // "The formal estimate": the approved one if any, else the newest kind='formal'.
  const formal =
    estimates.find((e) => e.kind === "formal" && e.status === "approved") ??
    estimates.find((e) => e.kind === "formal") ??
    null;
  return {
    rule: PRICING_RULE,
    status: ctx?.status ?? null,
    has_signed_contract: ctx?.hasSignedContract ?? false,
    scope_change_path: path,
    formal_estimate_id: formal ? Number(formal.id) : null,
    formal_estimate_lives_in: WHERE.formalEstimate,
    to_add_lines_to_the_formal_estimate: formal
      ? `add_estimate_lines { estimate_id: ${Number(formal.id)}, lines: [...] } — then render_document_draft its Formal Estimate PDF, if one exists under ${WHERE.formalEstimate}, to re-print it with the current lines.`
      : `there is no formal estimate yet: create_estimate { project_slug, title } then add_estimate_lines.`,
    a_client_change_here_is:
      path === "change_order"
        ? `a CHANGE ORDER — draft it in ${WHERE.changeOrders} (no MCP tool creates one; ask Joe with ask_owner), ` +
          `then create_document_draft { template_key: 'change_order', change_order_id } for the paper.`
        : `a new pre-con change estimate under ${WHERE.preconChanges} — create_estimate { kind: 'precon_change' } ` +
          `then add_estimate_lines. Joe sends it for the client's approval from there.`,
    estimates: {
      lives_in: `formal: ${WHERE.formalEstimate}; precon_change: ${WHERE.preconChanges}`,
      items: estimates.map((e) => ({
        id: Number(e.id),
        title: e.title,
        kind: e.kind,
        kind_label: ESTIMATE_KIND_LABEL[e.kind] ?? e.kind,
        lives_in: estimateLivesIn(e.kind),
        rail: e.rail,
        status: e.status,
        total_cents: e.total,
        sent_at: e.sent_at,
        approved_at: e.approved_at,
        created_at: e.created_at,
      })),
    },
    change_orders: {
      lives_in: WHERE.changeOrders,
      items: changeOrders.map((c) => ({
        id: Number(c.id),
        number: c.number,
        title: c.title,
        price_cents: c.price_cents,
        status: c.status,
        created_at: c.created_at,
      })),
    },
    documents: {
      lives_in: "Documents tab (one section per template)",
      items: docs.map((d) => ({
        id: Number(d.id),
        template_key: d.template_key,
        title: d.title,
        status: d.status,
        rendered_from: renderedFrom(d.template_key),
        created_at: d.created_at,
      })),
    },
  };
}

export function registerEstimateTools(server, { rows, json, pool, strippedDollarError }) {
  const cents = z.number().int().min(0).describe("integer cents");

  async function projectBySlug(slug) {
    const [p] = await rows(`SELECT id, status FROM projects WHERE slug = $1`, [slug]);
    return p ?? null;
  }

  server.registerTool(
    "list_project_estimates",
    {
      title: "List a job's estimates",
      description:
        "Every estimate on a job with its lines (`formal_estimate_id` says which one is THE formal estimate), " +
        "plus the job's change orders and document drafts and which one a client change becomes right now " +
        "(`scope_change_path`). " + PRICING_RULE + " Read-only. ALL MONEY IS INTEGER CENTS.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      const p = await projectBySlug(project_slug);
      if (!p) return json({ error: `No project with slug "${project_slug}"` });
      const summary = await pricingAndPaperwork(rows, p.id);
      const ids = summary.estimates.items.map((e) => e.id);
      const lines = ids.length
        ? await rows(
            `SELECT id, estimate_id, description, section, unit, qty, unit_cost, markup, extended, sort_order
               FROM estimate_lines WHERE estimate_id = ANY($1::bigint[])
              ORDER BY estimate_id, section, sort_order, id`,
            [ids],
          )
        : [];
      const byEst = new Map();
      for (const l of lines) {
        const k = Number(l.estimate_id);
        if (!byEst.has(k)) byEst.set(k, []);
        byEst.get(k).push({
          id: Number(l.id),
          description: l.description,
          section: l.section,
          unit: l.unit,
          qty: Number(l.qty),
          unit_cost_cents: l.unit_cost,
          markup_pct: Number(l.markup),
          extended_cents: l.extended,
        });
      }
      return json({
        project: project_slug,
        ...summary,
        estimates: {
          ...summary.estimates,
          items: summary.estimates.items.map((e) => ({ ...e, lines: byEst.get(e.id) ?? [] })),
        },
      });
    },
  );

  server.registerTool(
    "create_estimate",
    {
      title: "Create a new estimate",
      description:
        `Create a NEW estimate on a job. kind 'formal' (default): ${ESTIMATE_KIND_HELP.formal} It shows under ` +
        `${WHERE.formalEstimate}. A job normally has ONE formal estimate — to add to the existing one, use ` +
        `add_estimate_lines on get_project → pricing_and_paperwork.formal_estimate_id instead of creating another. ` +
        `kind 'precon_change': ${ESTIMATE_KIND_HELP.precon_change} It shows under ${WHERE.preconChanges}; refused on ` +
        `a job under contract — there a client change is a change order (${WHERE.changeOrders}), which no tool ` +
        `creates. Then add_estimate_lines; the client's PDF is create_document_draft { template_key: ` +
        `'estimate_doc', estimate_id }. Nothing is sent. Never insert into estimates/estimate_lines by hand.`,
      inputSchema: {
        project_slug: z.string(),
        title: z.string(),
        kind: z.enum(["formal", "precon_change"]).optional().describe("default 'formal'"),
        rail: z.enum(["plans", "design_build"]).optional().describe("default 'plans'"),
      },
    },
    async (a) => {
      const mangled = strippedDollarError(a.title);
      if (mangled) return mangled;
      const p = await projectBySlug(a.project_slug);
      if (!p) return json({ ok: false, error: `No project with slug "${a.project_slug}"` });
      const title = a.title.trim();
      if (!title) return json({ ok: false, error: "Give the estimate a title." });
      const kind = a.kind ?? "formal";
      const ctx = await scopeContext(rows, p.id);
      if (kind === "precon_change" && ctx?.path === "change_order") {
        return json({ ok: false, error: preconChangeRefusal(ctx), scope_change_path: ctx.path });
      }
      try {
        const existing =
          kind === "formal"
            ? await rows(`SELECT id, title, status FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY created_at DESC`, [p.id])
            : [];
        const [row] = await rows(
          `INSERT INTO estimates (project_id, title, rail, kind) VALUES ($1, $2, $3, $4) RETURNING id`,
          [p.id, title, a.rail ?? "plans", kind],
        );
        await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ('estimates', 'mcp')`).catch(() => {});
        const id = Number(row.id);
        return json({
          ok: true,
          estimate_id: id,
          kind,
          kind_label: ESTIMATE_KIND_LABEL[kind],
          status: "draft",
          lives_in: estimateLivesIn(kind),
          ...(existing.length
            ? {
                note:
                  `This job already had ${existing.length} formal estimate(s): ` +
                  existing.map((e) => `#${e.id} "${e.title}" (${e.status})`).join(", ") +
                  `. If Joe meant that one, delete this new one in the app and add lines there instead.`,
              }
            : {}),
          next:
            `add_estimate_lines { estimate_id: ${id}, lines: [...] }. For the client's PDF afterwards: ` +
            `create_document_draft { template_key: 'estimate_doc', project_slug: '${a.project_slug}', estimate_id: ${id} }.`,
        });
      } catch (err) {
        // The estimates trigger is the backstop for the check above.
        return json({ ok: false, error: String(err?.message ?? err) });
      }
    },
  );

  server.registerTool(
    "add_estimate_lines",
    {
      title: "Add lines to an estimate",
      description:
        "Add line items to an estimate (estimate_id from get_project → pricing_and_paperwork.formal_estimate_id, " +
        "or list_project_estimates). Each line: description; section = the trade or category it is grouped under " +
        "(default 'General'); unit ('ea', 'sf', 'lf', 'ls', 'hr', …); qty; unit_cost_cents = what it costs SJC, " +
        "INTEGER CENTS; markup_pct (default: the cost book's default markup). extended = qty × unit_cost × " +
        "(1 + markup/100); the estimate's totals are recomputed. A credit (e.g. a scope reduction Joe agreed to) is " +
        "a line with a NEGATIVE unit_cost_cents and markup_pct 0. Works on any status — if the estimate was already " +
        "sent or approved the client saw the old total, so say so to Joe; and if a Formal Estimate PDF exists, " +
        "render_document_draft it — that re-prints it with the current lines.",
      inputSchema: {
        estimate_id: z.number().int(),
        lines: z
          .array(
            z.object({
              description: z.string(),
              section: z.string().optional(),
              unit: z.string().optional(),
              qty: z.number().min(0),
              unit_cost_cents: z.number().int().describe("integer cents; negative for a credit line"),
              markup_pct: z.number().min(0).max(999).optional(),
            }),
          )
          .min(1),
      },
    },
    async (a) => {
      const mangled = strippedDollarError(...a.lines.flatMap((l) => [l.description, l.section ?? ""]));
      if (mangled) return mangled;
      const client = await pool.connect();
      try {
        const run = async (sql, params) => (await client.query(sql, params)).rows;
        const [est] = await run(`SELECT id, status, kind, title FROM estimates WHERE id = $1`, [a.estimate_id]);
        if (!est) return json({ ok: false, error: `No estimate #${a.estimate_id}.` });
        const [setting] = await run(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`);
        const parsed = setting ? Number(setting.value) : NaN;
        const defaultMarkup = Number.isFinite(parsed) ? parsed : DEFAULT_MARKUP_FALLBACK;

        await client.query("BEGIN");
        const [{ next }] = await run(
          `SELECT coalesce(max(sort_order), -1) + 1 AS next FROM estimate_lines WHERE estimate_id = $1`,
          [est.id],
        );
        const added = [];
        for (const [i, l] of a.lines.entries()) {
          const description = l.description.trim();
          if (!description) throw new Error("Every line needs a description.");
          const markup = l.markup_pct ?? defaultMarkup;
          const extended = Math.round(l.qty * l.unit_cost_cents * (1 + markup / 100));
          const [r] = await run(
            `INSERT INTO estimate_lines
               (estimate_id, description, section, unit, qty, unit_cost, markup, extended, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              est.id,
              description,
              (l.section ?? "General").trim() || "General",
              (l.unit ?? "ea").trim() || "ea",
              l.qty,
              l.unit_cost_cents,
              markup,
              extended,
              Number(next) + i,
            ],
          );
          added.push({ id: Number(r.id), description, extended_cents: extended, markup_pct: markup });
        }
        // Same recompute as lib/actions/estimates.ts — totals live on the row.
        const [totals] = await run(
          `UPDATE estimates e
              SET subtotal = s.sub, total = s.tot, markup_total = s.tot - s.sub
             FROM (SELECT coalesce(round(sum(qty * unit_cost)), 0)::int AS sub,
                          coalesce(sum(extended), 0)::int AS tot
                     FROM estimate_lines WHERE estimate_id = $1) s
            WHERE e.id = $1
            RETURNING e.subtotal AS subtotal_cents, e.markup_total AS markup_cents, e.total AS total_cents`,
          [est.id],
        );
        await client.query("COMMIT");
        await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ('estimate_lines', 'mcp')`).catch(() => {});
        const [docs] = await run(
          `SELECT count(*)::int AS n FROM document_drafts d JOIN estimates e ON e.project_id = d.project_id
            WHERE e.id = $1 AND d.template_key = 'estimate_doc' AND d.status <> 'void'`,
          [est.id],
        );
        return json({
          ok: true,
          estimate_id: Number(est.id),
          title: est.title,
          kind: est.kind,
          lives_in: estimateLivesIn(est.kind),
          status: est.status,
          added,
          totals,
          ...(est.status !== "draft"
            ? { note: `This estimate is ${est.status} — the client saw the previous total. Tell Joe the total changed.` }
            : {}),
          ...(docs?.n
            ? { note_documents: `${docs.n} Formal Estimate PDF(s) exist under ${WHERE.formalEstimate} — render_document_draft each one; that re-prints it with the current lines. Until then it can't be sent or published.` }
            : {}),
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return json({ ok: false, error: String(err?.message ?? err) });
      } finally {
        client.release();
      }
    },
  );

  // Change or remove lines that are already on an estimate: the same edits as
  // the pencil and trash buttons in the estimate editor (lib/actions/estimates.ts
  // updateEstimateLine / deleteEstimateLine), so an agent never has to fake a
  // removal with a credit line.
  const lineEditNotes = async (run, est) => {
    const [docs] = await run(
      `SELECT count(*)::int AS n FROM document_drafts d JOIN estimates e ON e.project_id = d.project_id
        WHERE e.id = $1 AND d.template_key IN ('estimate_doc','contract') AND d.status <> 'void'`,
      [est.id],
    );
    return {
      ...(est.status !== "draft"
        ? { note: `This estimate is ${est.status} — the client saw the previous total. Tell Joe the total changed.` }
        : {}),
      ...(docs?.n
        ? { note_documents: `${docs.n} Formal Estimate / contract PDF(s) on this job are built from these lines — render_document_draft each one to re-print it with the current lines.` }
        : {}),
    };
  };

  server.registerTool(
    "update_estimate_line",
    {
      title: "Change a line on an estimate",
      description:
        "Change one existing estimate line (line ids come from list_project_estimates). Pass only the fields to change; " +
        "unit_cost_cents is INTEGER CENTS (negative for a credit). extended is recomputed as qty × unit_cost × " +
        "(1 + markup/100) and so are the estimate's totals. Use it to correct a price, a quantity, the wording, or a " +
        "lump-sum line that depends on others (e.g. an overhead-and-profit line after another line was removed). " +
        "Same notes as add_estimate_lines: if the estimate was sent or approved say so to Joe, and re-render its PDFs.",
      inputSchema: {
        line_id: z.number().int(),
        description: z.string().optional(),
        section: z.string().optional(),
        unit: z.string().optional(),
        qty: z.number().min(0).optional(),
        unit_cost_cents: z.number().int().optional().describe("integer cents; negative for a credit line"),
        markup_pct: z.number().min(0).max(999).optional(),
      },
    },
    async (a) => {
      const mangled = strippedDollarError(a.description ?? "", a.section ?? "");
      if (mangled) return mangled;
      const client = await pool.connect();
      try {
        const run = async (sql, params) => (await client.query(sql, params)).rows;
        const [line] = await run(
          `SELECT l.id, l.estimate_id, l.description, l.section, l.unit, l.qty::float AS qty, l.unit_cost, l.markup::float AS markup,
                  e.status, e.kind, e.title
             FROM estimate_lines l JOIN estimates e ON e.id = l.estimate_id WHERE l.id = $1`,
          [a.line_id],
        );
        if (!line) return json({ ok: false, error: `No estimate line #${a.line_id}.` });
        const description = a.description != null ? a.description.trim() : line.description;
        if (!description) return json({ ok: false, error: "A line needs a description." });
        const section = a.section != null ? a.section.trim() || "General" : line.section;
        const unit = a.unit != null ? a.unit.trim() || "ea" : line.unit;
        const qty = a.qty ?? Number(line.qty);
        const unitCost = a.unit_cost_cents ?? Number(line.unit_cost);
        const markup = a.markup_pct ?? Number(line.markup);
        const extended = Math.round(qty * unitCost * (1 + markup / 100));
        const before = { description: line.description, qty: Number(line.qty), unit_cost_cents: Number(line.unit_cost), markup_pct: Number(line.markup) };

        await client.query("BEGIN");
        await run(
          `UPDATE estimate_lines SET description=$2, section=$3, unit=$4, qty=$5, unit_cost=$6, markup=$7, extended=$8 WHERE id=$1`,
          [line.id, description, section, unit, qty, unitCost, markup, extended],
        );
        const totals = await recomputeTotals(run, line.estimate_id);
        await client.query("COMMIT");
        await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ('estimate_lines', 'mcp')`).catch(() => {});
        return json({
          ok: true,
          estimate_id: Number(line.estimate_id),
          title: line.title,
          lives_in: estimateLivesIn(line.kind),
          status: line.status,
          line: { id: Number(line.id), before, after: { description, qty, unit_cost_cents: unitCost, markup_pct: markup, extended_cents: extended } },
          totals,
          ...(await lineEditNotes(run, { id: line.estimate_id, status: line.status })),
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return json({ ok: false, error: String(err?.message ?? err) });
      } finally {
        client.release();
      }
    },
  );

  server.registerTool(
    "delete_estimate_lines",
    {
      title: "Remove lines from an estimate",
      description:
        "Remove one or more lines from ONE estimate (line ids from list_project_estimates; every id must belong to " +
        "estimate_id). This is the real removal, the same as the trash button in the estimate editor. Use it when Joe " +
        "drops scope from an estimate that hasn't been signed. Don't use it to fake a credit the client should see; " +
        "that's a negative line via add_estimate_lines. The estimate's totals are recomputed. Lump-sum lines that " +
        "were figured from the removed ones (overhead and profit, tax) don't recalculate on their own: fix them with " +
        "update_estimate_line. Same notes as add_estimate_lines: if the estimate was sent or approved say so to Joe, " +
        "and re-render its PDFs.",
      inputSchema: {
        estimate_id: z.number().int(),
        line_ids: z.array(z.number().int()).min(1),
      },
    },
    async (a) => {
      const client = await pool.connect();
      try {
        const run = async (sql, params) => (await client.query(sql, params)).rows;
        const [est] = await run(`SELECT id, status, kind, title FROM estimates WHERE id = $1`, [a.estimate_id]);
        if (!est) return json({ ok: false, error: `No estimate #${a.estimate_id}.` });
        const found = await run(
          `SELECT id::int AS id, description, extended::int AS extended_cents FROM estimate_lines WHERE estimate_id = $1 AND id = ANY($2::bigint[])`,
          [est.id, a.line_ids],
        );
        const missing = a.line_ids.filter((id) => !found.some((f) => f.id === id));
        if (missing.length) return json({ ok: false, error: `Not lines on estimate #${est.id}: ${missing.join(", ")}. Nothing was removed.` });

        await client.query("BEGIN");
        await run(`DELETE FROM estimate_lines WHERE estimate_id = $1 AND id = ANY($2::bigint[])`, [est.id, a.line_ids]);
        const totals = await recomputeTotals(run, est.id);
        await client.query("COMMIT");
        await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ('estimate_lines', 'mcp')`).catch(() => {});
        return json({
          ok: true,
          estimate_id: Number(est.id),
          title: est.title,
          lives_in: estimateLivesIn(est.kind),
          status: est.status,
          removed: found,
          totals,
          check: "If a lump-sum line (overhead and profit, tax, contingency) was figured from what you removed, correct it with update_estimate_line.",
          ...(await lineEditNotes(run, est)),
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return json({ ok: false, error: String(err?.message ?? err) });
      } finally {
        client.release();
      }
    },
  );
}

/** Same recompute as lib/actions/estimates.ts — totals live on the row. */
async function recomputeTotals(run, estimateId) {
  const [totals] = await run(
    `UPDATE estimates e
        SET subtotal = s.sub, total = s.tot, markup_total = s.tot - s.sub
       FROM (SELECT coalesce(round(sum(qty * unit_cost)), 0)::int AS sub,
                    coalesce(sum(extended), 0)::int AS tot
               FROM estimate_lines WHERE estimate_id = $1) s
      WHERE e.id = $1
      RETURNING e.subtotal AS subtotal_cents, e.markup_total AS markup_cents, e.total AS total_cents`,
    [estimateId],
  );
  return totals;
}
