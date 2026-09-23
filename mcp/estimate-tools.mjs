// SJC OS MCP — estimates (Money › Estimate). Wired from sjcos-mcp.mjs:
//
//   import { pricingAndPaperwork, registerEstimateTools } from "./estimate-tools.mjs";
//   registerEstimateTools(server, { rows, json, pool, strippedDollarError });
//
// The rule these tools carry (docs/estimates-and-change-orders.md):
//   • The formal estimate IS the estimate in Money › Estimate (kind 'formal').
//     To add or change its lines, add_estimate_lines on that estimate.
//   • Documents › Formal Estimate is only the PDF generated from it
//     (create_document_draft { template_key: 'estimate_doc', estimate_id }).
//   • A client addition or change BEFORE the contract is signed is a new
//     estimate with kind 'precon_change'; AFTER it is a change order. No tool
//     here (or anywhere in this server) creates a change order — the client
//     portal lists every non-draft change order (mcp/financials-tools.mjs).
// The database decides which path a job is on (project_scope_change_path())
// and refuses the wrong row by trigger; these tools check first so the agent
// gets a plain-English answer instead of a constraint error.
//
// Nothing here sends or approves anything: sending an estimate for the
// client's approval stays Joe's click in Money › Estimate. Runtime: plain Node
// ESM importing the pure TypeScript lib directly (Node 22 strips types), same
// as financials-tools.mjs. MONEY IS INTEGER CENTS.

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

/** What a document template is generated from — so an agent never files paper without its numbers. */
function renderedFrom(templateKey) {
  switch (templateKey) {
    case "estimate_doc":
    case "contract":
      return `an estimate in ${WHERE.estimates} (estimate_id)`;
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
    to_add_lines_to_the_formal_estimate: formal
      ? `add_estimate_lines { estimate_id: ${Number(formal.id)}, lines: [...] } — then regenerate its PDF under ${WHERE.formalEstimateDoc} if one exists.`
      : `there is no formal estimate yet: create_estimate { project_slug, title } then add_estimate_lines.`,
    a_client_change_here_is:
      path === "change_order"
        ? `a CHANGE ORDER — draft it in ${WHERE.changeOrders} (no MCP tool creates one; ask Joe with ask_owner), ` +
          `then create_document_draft { template_key: 'change_order', change_order_id } for the paper.`
        : `a NEW estimate with kind 'precon_change' — create_estimate { kind: 'precon_change' } then add_estimate_lines. ` +
          `Joe sends it for the client's approval from ${WHERE.estimates}.`,
    estimates: {
      lives_in: WHERE.estimates,
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
      title: "List a job's estimates (Money › Estimate)",
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
      title: "Create a new estimate (Money › Estimate)",
      description:
        `Create a NEW estimate on a job. kind 'formal' (default): ${ESTIMATE_KIND_HELP.formal} A job normally has ` +
        `ONE formal estimate — to add to the existing one, use add_estimate_lines on ` +
        `get_project → pricing_and_paperwork.formal_estimate_id instead of creating another. kind 'precon_change': ` +
        `${ESTIMATE_KIND_HELP.precon_change} Refused on a job under contract — there a client change is a change ` +
        `order (${WHERE.changeOrders}), which no tool creates. Then add_estimate_lines; the client's PDF is ` +
        `create_document_draft { template_key: 'estimate_doc', estimate_id }. Nothing is sent. ` +
        `Never insert into estimates/estimate_lines by hand.`,
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
          lives_in: WHERE.estimates,
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
        "(1 + markup/100); the estimate's totals are recomputed. Works on any status — if the estimate was already " +
        "sent or approved the client saw the old total, so say so to Joe; and regenerate its Formal Estimate PDF " +
        "under Documents if one exists.",
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
          status: est.status,
          added,
          totals,
          ...(est.status !== "draft"
            ? { note: `This estimate is ${est.status} — the client saw the previous total. Tell Joe the total changed.` }
            : {}),
          ...(docs?.n
            ? { note_documents: `${docs.n} Formal Estimate PDF(s) exist under ${WHERE.formalEstimateDoc} — regenerate (render_document_draft) so the paper matches.` }
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
}
