// SJC OS MCP — estimate worksheets (Money › Estimate). Wired from sjcos-mcp.mjs:
//
//   import { pricingAndPaperwork, registerEstimateTools } from "./estimate-tools.mjs";
//   registerEstimateTools(server, { rows, json, pool, strippedDollarError });
//
// The rule these tools carry (docs/estimates-and-change-orders.md):
//   • Money › Estimate = the NUMBERS — estimate worksheets. kind 'formal' is the
//     job's base bid; kind 'precon_change' is a client addition or change priced
//     BEFORE the contract is signed.
//   • Documents › Formal Estimate = the PAPER, rendered FROM a worksheet
//     (create_document_draft { template_key: 'estimate_doc', estimate_id }).
//   • Change orders are for scope changes AFTER the contract is signed. No tool
//     here (or anywhere in this server) creates one — the client portal lists
//     every non-draft change order (mcp/financials-tools.mjs).
// The database decides which path a job is on (project_scope_change_path())
// and refuses the wrong row by trigger; these tools check first so the agent
// gets a plain-English answer instead of a constraint error.
//
// Drafts only: nothing here sends, approves, or touches status. Sending a
// worksheet for the client's approval stays Joe's click in Money › Estimate.
// Runtime: plain Node ESM importing the pure TypeScript lib directly (Node 22
// strips types), same as financials-tools.mjs. MONEY IS INTEGER CENTS.

import { z } from "zod";
import {
  ESTIMATE_KIND_HELP,
  ESTIMATE_KIND_LABEL,
  PRICING_RULE,
  WHERE,
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

/** What a template is rendered from — so an agent never files paper without its numbers. */
function renderedFrom(templateKey) {
  switch (templateKey) {
    case "estimate_doc":
    case "contract":
      return `an estimate worksheet in ${WHERE.worksheets} (estimate_id)`;
    case "change_order":
      return `a change order in ${WHERE.changeOrders} (change_order_id)`;
    case "invoice_doc":
      return "an invoice in Money › Invoices (invoice_id)";
    default:
      return null;
  }
}

/**
 * The `pricing_and_paperwork` block on get_project: the rule, which path a
 * client change takes on THIS job, and every worksheet / change order /
 * document draft tagged with where it lives. Read this before deciding where
 * something goes.
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
  return {
    rule: PRICING_RULE,
    status: ctx?.status ?? null,
    has_signed_contract: ctx?.hasSignedContract ?? false,
    scope_change_path: path,
    a_client_change_here_is:
      path === "change_order"
        ? `a CHANGE ORDER — draft it in ${WHERE.changeOrders} (no MCP tool creates one; ask Joe with ask_owner), ` +
          `then create_document_draft { template_key: 'change_order', change_order_id } for the paper.`
        : `a PRE-CON CHANGE estimate worksheet — create_estimate { kind: 'precon_change' } then add_estimate_lines; ` +
          `Joe sends it for the client's approval from ${WHERE.worksheets}.`,
    estimate_worksheets: {
      lives_in: WHERE.worksheets,
      items: estimates.map((e) => ({
        id: Number(e.id),
        title: e.title,
        kind: e.kind,
        kind_label: ESTIMATE_KIND_LABEL[e.kind] ?? e.kind,
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
      title: "List a job's estimate worksheets (Money › Estimate)",
      description:
        "Every estimate worksheet on a job with its lines, the job's change orders and document drafts (each " +
        "tagged with where it lives), and which record a client change becomes on this job right now " +
        "(`scope_change_path`). " + PRICING_RULE + " Read-only. ALL MONEY IS INTEGER CENTS.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      const p = await projectBySlug(project_slug);
      if (!p) return json({ error: `No project with slug "${project_slug}"` });
      const summary = await pricingAndPaperwork(rows, p.id);
      const ids = summary.estimate_worksheets.items.map((e) => e.id);
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
        estimate_worksheets: {
          ...summary.estimate_worksheets,
          items: summary.estimate_worksheets.items.map((e) => ({ ...e, lines: byEst.get(e.id) ?? [] })),
        },
      });
    },
  );

  server.registerTool(
    "create_estimate",
    {
      title: "Create a draft estimate worksheet (Money › Estimate)",
      description:
        `Start a DRAFT estimate worksheet on a job — the numbers, not the paper. kind 'formal': ` +
        `${ESTIMATE_KIND_HELP.formal} kind 'precon_change': ${ESTIMATE_KIND_HELP.precon_change} ` +
        `A pre-con change is REFUSED on a job that is under contract — there a client change is a change order ` +
        `(${WHERE.changeOrders}), which no tool creates. Check get_project → pricing_and_paperwork.scope_change_path ` +
        `first. Then add_estimate_lines. The client-facing document comes afterwards: create_document_draft ` +
        `{ template_key: 'estimate_doc', estimate_id }. Does NOT send anything — Joe sends a worksheet for the ` +
        `client's approval from ${WHERE.worksheets}. Never insert into estimates/estimate_lines by hand.`,
      inputSchema: {
        project_slug: z.string(),
        title: z.string(),
        kind: z.enum(["formal", "precon_change"]),
        rail: z.enum(["plans", "design_build"]).optional().describe("default 'plans'"),
      },
    },
    async (a) => {
      const mangled = strippedDollarError(a.title);
      if (mangled) return mangled;
      const p = await projectBySlug(a.project_slug);
      if (!p) return json({ ok: false, error: `No project with slug "${a.project_slug}"` });
      const title = a.title.trim();
      if (!title) return json({ ok: false, error: "Give the worksheet a title." });
      const ctx = await scopeContext(rows, p.id);
      if (a.kind === "precon_change" && ctx?.path === "change_order") {
        return json({ ok: false, error: preconChangeRefusal(ctx), scope_change_path: ctx.path });
      }
      try {
        const [row] = await rows(
          `INSERT INTO estimates (project_id, title, rail, kind) VALUES ($1, $2, $3, $4) RETURNING id`,
          [p.id, title, a.rail ?? "plans", a.kind],
        );
        await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ('estimates', 'mcp')`).catch(() => {});
        const id = Number(row.id);
        return json({
          ok: true,
          estimate_id: id,
          kind: a.kind,
          kind_label: ESTIMATE_KIND_LABEL[a.kind],
          status: "draft",
          lives_in: WHERE.worksheets,
          next:
            `add_estimate_lines { estimate_id: ${id}, lines: [...] }. For the client-facing paper afterwards: ` +
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
      title: "Add lines to a draft estimate worksheet",
      description:
        "Append lines to a DRAFT worksheet (estimate_id from create_estimate / list_project_estimates). Each line: " +
        "description; section = the trade or category the line is grouped under (default 'General'); unit " +
        "('ea', 'sf', 'lf', 'ls', 'hr', …); qty; unit_cost_cents = what it costs SJC, INTEGER CENTS; markup_pct " +
        "(default: the cost book's default markup). extended = qty × unit_cost × (1 + markup/100); the worksheet's " +
        "totals are recomputed. Refuses a worksheet that is sent/approved/declined — that one has been in front of " +
        "the client; put a revision on a new worksheet instead.",
      inputSchema: {
        estimate_id: z.number().int(),
        lines: z
          .array(
            z.object({
              description: z.string(),
              section: z.string().optional(),
              unit: z.string().optional(),
              qty: z.number().min(0),
              unit_cost_cents: cents,
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
        const [est] = await run(`SELECT id, status, project_id FROM estimates WHERE id = $1`, [a.estimate_id]);
        if (!est) return json({ ok: false, error: `No estimate worksheet #${a.estimate_id}.` });
        if (est.status !== "draft") {
          return json({
            ok: false,
            error:
              `Worksheet #${a.estimate_id} is ${est.status} — it has been in front of the client. ` +
              `Start a new worksheet (create_estimate) for the revision.`,
          });
        }
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
        return json({ ok: true, estimate_id: Number(est.id), added, totals });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return json({ ok: false, error: String(err?.message ?? err) });
      } finally {
        client.release();
      }
    },
  );
}
