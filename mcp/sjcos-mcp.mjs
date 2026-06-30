#!/usr/bin/env node
// SJC OS — MCP server (Phase-1 foundation, AI-agnostic).
//
// A standard Model Context Protocol server exposing curated, read-only tools
// over the SJC OS Postgres database, so ANY MCP client (Claude Desktop/Code,
// Cursor, Continue, …) can query real business data with structure — not just
// Claude. Runs as its own process over stdio; reads DATABASE_URL from the app's
// .env.local (the client may spawn us with a clean env, so we don't rely on it).
//
// Register with a client, e.g. Claude Code:
//   claude mcp add sjcos -- node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs
// or a client config:
//   { "mcpServers": { "sjcos": { "command": "node",
//       "args": ["/home/joe/sjcos-app/mcp/sjcos-mcp.mjs"] } } }
//
// Read-only by design: every tool is a parameterized SELECT. Write tools (gated)
// can be added later. Keep tools curated — do NOT expose raw SQL.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });

async function rows(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}
/** Wrap a result set as MCP text content (pretty JSON). */
function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "sjcos", version: "1.0.0" });

server.registerTool(
  "business_snapshot",
  {
    title: "Business snapshot",
    description:
      "High-level counts across the business: leads by stage, active projects, " +
      "subs, upcoming compliance, and outstanding A/R (sum of sent invoices).",
    inputSchema: {},
  },
  async () => {
    const [leads, projects, subs, ar, compliance] = await Promise.all([
      rows(`SELECT stage, count(*)::int AS n FROM leads GROUP BY stage ORDER BY stage`),
      rows(`SELECT status, count(*)::int AS n FROM projects GROUP BY status ORDER BY status`),
      rows(`SELECT count(*)::int AS subs FROM subs`),
      rows(`SELECT COALESCE(sum(amount),0)::int AS outstanding FROM invoices WHERE status = 'sent'`),
      rows(`SELECT count(*)::int AS due_60d FROM compliance_items WHERE resolved = false AND due_date - CURRENT_DATE BETWEEN 0 AND 60`),
    ]);
    return json({
      leads_by_stage: leads,
      projects_by_status: projects,
      subs: subs[0]?.subs ?? 0,
      outstanding_ar: ar[0]?.outstanding ?? 0,
      compliance_due_60d: compliance[0]?.due_60d ?? 0,
    });
  },
);

server.registerTool(
  "list_leads",
  {
    title: "List leads",
    description: "List leads, optionally filtered by pipeline stage. Newest contact first.",
    inputSchema: { stage: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
  },
  async ({ stage, limit = 50 }) => {
    const where = stage ? `WHERE stage = $1` : ``;
    const params = stage ? [stage, limit] : [limit];
    return json(
      await rows(
        `SELECT slug, name, scope, stage, value_display, source, hot, flag_label, email, phone,
                last_contact_at
           FROM leads ${where}
          ORDER BY last_contact_at DESC NULLS LAST
          LIMIT $${stage ? 2 : 1}`,
        params,
      ),
    );
  },
);

server.registerTool(
  "get_lead",
  {
    title: "Get lead",
    description: "Full detail for one lead by slug: the lead row, intake answers, and recent activity.",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const lead = await rows(`SELECT * FROM leads WHERE slug = $1`, [slug]);
    if (lead.length === 0) return json({ error: `No lead with slug "${slug}"` });
    const id = lead[0].id;
    const [intake, activity] = await Promise.all([
      rows(`SELECT sort_order, question, answer FROM lead_intake WHERE lead_id = $1 ORDER BY sort_order`, [id]),
      rows(`SELECT kind, summary, actor, created_at FROM lead_activity WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    ]);
    return json({ lead: lead[0], intake, activity });
  },
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "List projects, optionally filtered by status (mood_board/selections/construction/closeout/complete).",
    inputSchema: { status: z.string().optional() },
  },
  async ({ status }) => {
    const where = status ? `WHERE status = $1` : ``;
    return json(
      await rows(
        `SELECT slug, name, status, client_name, value_display, collected_to_date, progress, stage_label
           FROM projects ${where} ORDER BY created_at DESC`,
        status ? [status] : [],
      ),
    );
  },
);

server.registerTool(
  "get_project",
  {
    title: "Get project",
    description: "Full detail for one project by slug, including its invoices and a money summary.",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const proj = await rows(`SELECT * FROM projects WHERE slug = $1`, [slug]);
    if (proj.length === 0) return json({ error: `No project with slug "${slug}"` });
    const id = proj[0].id;
    const [invoices, subs] = await Promise.all([
      rows(`SELECT number, milestone, amount, status, sent_at, paid_at FROM invoices WHERE project_id = $1 ORDER BY created_at`, [id]),
      rows(`SELECT sub_slug, role_label FROM project_subs WHERE project_id = $1`, [id]),
    ]);
    const paid = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
    const outstanding = invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.amount, 0);
    return json({ project: proj[0], invoices, subs, money: { paid, outstanding } });
  },
);

server.registerTool(
  "list_subs",
  {
    title: "List subcontractors",
    description: "List subs, optionally filtered by trade (substring match). Includes COI status + expiry.",
    inputSchema: { trade: z.string().optional() },
  },
  async ({ trade }) => {
    const where = trade ? `WHERE trade ILIKE $1` : ``;
    return json(
      await rows(
        `SELECT slug, name, trade, rate, rating, jobs_count, coi_status, coi_expires_at, email, phone
           FROM subs ${where} ORDER BY fav DESC, name`,
        trade ? [`%${trade}%`] : [],
      ),
    );
  },
);

server.registerTool(
  "list_compliance",
  {
    title: "List compliance items",
    description: "Upcoming unresolved compliance items due within N days (default 90), soonest first.",
    inputSchema: { within_days: z.number().int().min(1).max(365).optional() },
  },
  async ({ within_days = 90 }) => {
    return json(
      await rows(
        `SELECT title, kind, due_date, (due_date - CURRENT_DATE) AS days_out, owner, step
           FROM compliance_items
          WHERE resolved = false AND due_date - CURRENT_DATE BETWEEN 0 AND $1
          ORDER BY due_date`,
        [within_days],
      ),
    );
  },
);

server.registerTool(
  "list_signature_requests",
  {
    title: "List signature requests",
    description: "E-signature requests, optionally filtered by project slug and/or status (sent/signed/declined/void).",
    inputSchema: { project_slug: z.string().optional(), status: z.string().optional() },
  },
  async ({ project_slug, status }) => {
    const conds = [];
    const params = [];
    if (project_slug) { params.push(project_slug); conds.push(`p.slug = $${params.length}`); }
    if (status) { params.push(status); conds.push(`sr.status = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : ``;
    return json(
      await rows(
        `SELECT sr.id, sr.doc_type, sr.title, sr.status, sr.signer_name, sr.signed_name,
                sr.signed_at, p.slug AS project_slug
           FROM signature_requests sr
           LEFT JOIN projects p ON p.id = sr.project_id
           ${where}
          ORDER BY sr.created_at DESC`,
        params,
      ),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdio servers stay alive on the transport; nothing to log to stdout (it's the
// JSON-RPC channel). Errors go to stderr.
