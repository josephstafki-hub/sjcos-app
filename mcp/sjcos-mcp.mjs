#!/usr/bin/env node
// SJC OS — MCP server (AI-agnostic).
//
// A standard Model Context Protocol server exposing curated tools over the SJC OS
// Postgres database, so ANY MCP client (Claude Desktop/Code, Cursor, Continue,
// Codex, Hermes …) can work with real business data with structure — not just
// Claude. Runs as its own process over stdio; reads DATABASE_URL from the app's
// .env.local (the client may spawn us with a clean env, so we don't rely on it).
//
// Register with a client, e.g. Claude Code:
//   claude mcp add sjcos -- node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs
// or a client config:
//   { "mcpServers": { "sjcos": { "command": "node",
//       "args": ["/home/joe/sjcos-app/mcp/sjcos-mcp.mjs"] } } }
//
// Tool surface (all tools are curated + parameterized — raw SQL is NEVER exposed):
//   • Curated READ tools: parameterized SELECTs over leads/projects/subs/
//     vendors/purchase orders/compliance/knowledge/work items/skills/runbooks +
//     business_snapshot + get_today_queue (Joe's Today rail with per-item lanes).
//   • Gated WRITE tools: capture_knowledge, create_work_item,
//     update_work_item_status, snooze_work_item, submit_draft_for_approval,
//     record_agent_run, record_receipt,
//     create_skill_proposal, record_skill_used. These are safe by construction —
//     they only touch internal records, an append-only audit trail, or land as
//     proposals (skills land 'proposed', invisible to the library until an owner
//     approves them in /engine).
//   • Draft/queue-only WRITE tools proxied through the app (doc drafts,
//     newsletter, purchase orders): can create/edit/queue, never send — see the
//     safety comment above each block for exactly where the line sits.
//   • Mood board tools (mcp/mood-tools.mjs, registered at the end of
//     buildServer): create per-room boards, pin sourced images, add swatches and
//     direction text, and compose a board into a real mood-board layout. Owner-
//     side only — a board is internal until the owner pushes selections.
//   • Owner-granted SENDS (mcp/grants-tools.mjs): send_bid_package,
//     send_purchase_order, send_invoice, release_newsletter_*,
//     send_document_for_signature, send_email. Each REQUIRES an owner grant
//     id — Joe's express permission for that action/target (Ask-window
//     "Express permission" checkbox, /engine/permissions, or an agent's
//     request_owner_permission that Joe approved). No grant, no send.
//   • NOT exposed: no destructive tools (no deletes/drops), no un-granted
//     client- or vendor-facing sends, and no raw-SQL passthrough. Secrets are
//     read from .env.local at runtime and never logged or returned in a tool
//     result.

import { readFileSync } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
// Shared with the app's lane classifier (lib/today-triage.ts) — single
// definition site for the triage-lane patterns.
import { DEEP_RE, CHAT_RE } from "../lib/triage-lanes.mjs";
import { registerMoodTools } from "./mood-tools.mjs";
import { registerBiddingTools } from "./bidding-tools.mjs";
import { registerChatgptTools } from "./chatgpt-tools.mjs";
import { registerGrantTools } from "./grants-tools.mjs";
import { registerRunbookTools } from "./runbook-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 4 });

/** Read a key from env or .env.local (same fallback as databaseUrl). */
function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    const m = env.match(new RegExp(`^${key}=(.+)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

/**
 * Call the app's internal doc-drafts route (single source of truth for the doc
 * template manifest, validation, and PDF/DOCX rendering — the .mjs server can't
 * import the TS modules). Trusted local caller, authed with CRON_SECRET. This
 * route deliberately has NO send/submit action: rendering a draft is safe;
 * sending it for signature stays owner-gated in the app.
 */
async function docDraftsCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3000";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app doc-drafts route." };
  try {
    const res = await fetch(`${base}/api/internal/doc-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is \`npm run dev\` running?` };
  }
}

/**
 * Call the app's internal newsletter route (single source of truth for recipient
 * management, issue compose/queue, and drip enrollment — the .mjs server can't
 * import the TS render/queue modules). Trusted local caller, authed with
 * CRON_SECRET. Defaults to the systemd service port (3017); override with
 * APP_INTERNAL_URL. This route deliberately has NO 'release' / 'arm_sequence'
 * action: queueing parks a send, but a real inbox is reached only when the owner
 * clicks Release in the app, and turning a drip on stays a human action.
 */
async function newsletterCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app newsletter route." };
  try {
    const res = await fetch(`${base}/api/internal/newsletter`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

/**
 * Call the app's internal purchase-orders route (single source of truth for
 * the subtotal/status recompute logic — the .mjs server can't import the TS
 * module). Trusted local caller, authed with CRON_SECRET. This route
 * deliberately has NO send/record-receipt/close/void action: emailing a
 * vendor and receiving/closing out stay owner-gated in the app.
 */
/**
 * Call the app's internal bidding route (single source of truth for publish/
 * award/thread logic — portal visibility, parked invite emails, notifications).
 * Trusted local caller, authed with CRON_SECRET. The route refuses send_package
 * (real email); sending goes through the owner-grant tools instead.
 */
async function biddingCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app bidding route." };
  try {
    const res = await fetch(`${base}/api/internal/bidding`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

/**
 * Call the app's internal owner-grants route: request/check/list grants and
 * PERFORM a granted send. The route spends the grant atomically for the exact
 * action + target before anything transmits (lib/agent-sends.ts).
 */
async function grantsCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app owner-grants route." };
  try {
    const res = await fetch(`${base}/api/internal/owner-grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

/**
 * Fire-and-forget report to the app's internal notify-owner route (W3 owner
 * push). The MCP server runs outside the app process, so pushes to Joe's
 * phone go through the app, which owns quiet hours / throttling / collapse.
 * Best-effort by design: a push is secondary to the tool call that caused it.
 */
function notifyOwnerCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return;
  fetch(`${base}/api/internal/notify-owner`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action, ...payload }),
  }).catch(() => {});
}

/**
 * Call the app's internal leads route. Lead ingestion lives in lib/intake.ts
 * (createInboundLead — intake rows, AI scoring, room, feed card, W6 runbook
 * auto-start), which the .mjs server can't import. Trusted local caller,
 * authed with CRON_SECRET — this is NOT the website's intake token.
 */
async function leadsCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app leads route." };
  try {
    const res = await fetch(`${base}/api/internal/leads`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

/**
 * Call the app's internal runbooks route (W6 stepper). Starting a runbook and
 * advancing an instance live in lib/runbook-engine.ts (work-item spawn + agent
 * ping machinery the .mjs server can't import). Trusted local caller, authed
 * with CRON_SECRET. The route deliberately has NO cancel action — cancelling
 * an instance is owner-only in the app UI.
 */
async function runbooksCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app runbooks route." };
  try {
    const res = await fetch(`${base}/api/internal/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

async function poCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app purchase-orders route." };
  try {
    const res = await fetch(`${base}/api/internal/purchase-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

// Mirrors writeScope() in lib/db.ts — the app's query() helper does the same.
const WRITE_SQL = /^\s*(insert\s+into|update|delete\s+from)\s+(?:only\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i;

async function rows(sql, params = []) {
  const r = await pool.query(sql, params);
  // Live-update signal: log writes to app_change_log so open browser tabs
  // (LiveUpdates poller in the app) refresh without a reload. Awaited — the
  // stdio MCP process can exit right after a tool returns, which would drop a
  // fire-and-forget insert. Swallowed on error: a missing table (migration not
  // applied yet) must not fail the tool call itself.
  const m = WRITE_SQL.exec(sql);
  if (m && (r.rowCount ?? 1) > 0 && m[2].toLowerCase() !== "app_change_log") {
    await pool
      .query(`INSERT INTO app_change_log (scope, source) VALUES ($1, $2)`, [m[2].toLowerCase(), "mcp"])
      .catch(() => {});
  }
  return r.rows;
}
/** Wrap a result set as MCP text content (pretty JSON). */
function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Shell-interpolation tripwire for free-text writes. Agents sometimes route a
// tool call through a double-quoted shell string (a /tmp helper taking JSON as
// an argv word, or psql -c "insert …"), where bash expands $1/$2/… to nothing
// and "$2,200" arrives here as ",200". Once stored the amount is gone, so the
// write gate rejects the signature outright — real prose never puts ",NNN"
// straight after whitespace.
const STRIPPED_DOLLAR_RE = /(^|\s),\d{3}\b/;
/** Non-null iff any of the texts carries the stripped-dollar signature. */
function strippedDollarError(...texts) {
  if (!texts.some((t) => typeof t === "string" && STRIPPED_DOLLAR_RE.test(t)))
    return null;
  return json({
    ok: false,
    error:
      'Rejected — nothing was written: the text contains ",NNN" right after whitespace, ' +
      'the signature of a dollar amount whose "$N" prefix was eaten by shell interpolation ' +
      '("$2,200" becomes ",200" inside double quotes). Re-send the call without a shell in ' +
      "the middle: call the MCP tool directly, or pipe the JSON via stdin — " +
      "printf '%s' '<json>' | node mcp/call-tool.mjs <tool> — never as a double-quoted argv word.",
  });
}

// Build a fully-registered MCP server. Called once for the stdio process, and
// once per HTTP session: Streamable HTTP binds a transport to exactly one server,
// so concurrent HTTP clients each need their own instance. The shared `pool` and
// module-level helpers are reused across instances — only tool registration (a
// handful of microseconds of zod schema setup) repeats.
function buildServer() {
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
    const [leads, projects, subs, ar, compliance, work, approvals] = await Promise.all([
      rows(`SELECT stage, count(*)::int AS n FROM leads
             WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)
             GROUP BY stage ORDER BY stage`),
      rows(`SELECT status, count(*)::int AS n FROM projects GROUP BY status ORDER BY status`),
      rows(`SELECT count(*)::int AS subs FROM subs`),
      rows(`SELECT COALESCE(sum(amount),0)::int AS outstanding FROM invoices WHERE status = 'sent'`),
      rows(`SELECT count(*)::int AS due_60d FROM compliance_items WHERE resolved = false AND due_date - CURRENT_DATE BETWEEN 0 AND 60`),
      rows(`SELECT status, count(*)::int AS n FROM work_items GROUP BY status ORDER BY status`),
      rows(`SELECT count(*)::int AS n FROM work_items WHERE approval_status = 'requested'`),
    ]);
    return json({
      leads_by_stage: leads,
      projects_by_status: projects,
      subs: subs[0]?.subs ?? 0,
      outstanding_ar: ar[0]?.outstanding ?? 0,
      compliance_due_60d: compliance[0]?.due_60d ?? 0,
      work_items_by_status: work,
      work_items_awaiting_approval: approvals[0]?.n ?? 0,
    });
  },
);

// `flag_label`/`flag_kind` ("Needs reply" etc.) and `last_contact_at` are
// self-maintaining: lib/lead-activity.ts's logLeadActivity() clears the flag
// and bumps last_contact_at automatically whenever the app logs a real
// contact-kind activity (stage move, contact edit, email sent) — NOT on
// AI/agent prep work like drafting an estimate. There is deliberately no MCP
// write tool for these fields: an agent should never set/clear a lead's
// "Needs reply" state directly. If you (an agent) actually reply to or
// otherwise contact a lead on Joe's behalf, that must happen through the
// app's own owner-approved send path (submit_draft_for_approval →
// owner sends), which is what logs the activity that clears this — not by
// asking for a lead-mutation tool.
server.registerTool(
  "list_leads",
  {
    title: "List leads",
    description:
      "List leads, optionally filtered by pipeline stage. Newest contact first. " +
      "Leads already converted to a project are excluded (use get_lead / list_projects for those).",
    inputSchema: { stage: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
  },
  async ({ stage, limit = 50 }) => {
    const notConverted = `NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)`;
    const where = stage ? `WHERE stage = $1 AND ${notConverted}` : `WHERE ${notConverted}`;
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
  "list_vendors",
  {
    title: "List vendors",
    description: "List materials suppliers (vendors), favorites first. Distinct from subs (labor).",
    inputSchema: {},
  },
  async () =>
    json(await rows(`SELECT id, slug, name, trade, email, phone, fav FROM vendors ORDER BY fav DESC, name`)),
);

server.registerTool(
  "list_purchase_orders",
  {
    title: "List purchase orders",
    description: "List a project's purchase orders (newest first), optionally filtered by status.",
    inputSchema: { project_slug: z.string(), status: z.string().optional() },
  },
  async ({ project_slug, status }) => {
    const params = [project_slug];
    let where = `p.slug = $1`;
    if (status) {
      params.push(status);
      where += ` AND po.status = $2`;
    }
    return json(
      await rows(
        `SELECT po.id, po.po_number, po.title, po.vendor_kind, po.vendor_name, po.vendor_email, po.status,
                po.subtotal, po.created_at, po.sent_at
           FROM purchase_orders po JOIN projects p ON p.id = po.project_id
          WHERE ${where} ORDER BY po.created_at DESC`,
        params,
      ),
    );
  },
);

server.registerTool(
  "get_purchase_order",
  {
    title: "Get a purchase order",
    description: "Full detail for one purchase order by id, including its lines.",
    inputSchema: { id: z.coerce.number().int() },
  },
  async ({ id }) => {
    const po = await rows(`SELECT * FROM purchase_orders WHERE id = $1`, [id]);
    if (po.length === 0) return json({ error: `No purchase order with id ${id}` });
    const lines = await rows(
      `SELECT id, description, unit, qty_ordered, qty_received, unit_cost, extended
         FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY sort_order, id`,
      [id],
    );
    return json({ purchaseOrder: po[0], lines });
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

// ════════════════════════════════════════════════════════════════════════════
//  OPEN BRAIN / OPEN ENGINE / OPEN SKILLS tools
//  Read tools (curated SELECTs) + gated/logged write tools. No raw SQL, no
//  client-facing sends (email/SMS/invoice/contract are out of scope here).
//  Writes are safe by construction: knowledge/work items are internal records,
//  skill proposals land as 'proposed' (out of the library until Joe approves),
//  and agent runs/receipts are append-only audit rows.
// ════════════════════════════════════════════════════════════════════════════

/** Resolve a lead/project slug → its uuid. `table` is a trusted literal. */
async function slugToId(table, slug) {
  if (!slug) return null;
  const r = await rows(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
  return r[0]?.id ?? null;
}

// ─── Open Brain: read ───────────────────────────────────────────────────────

server.registerTool(
  "search_knowledge",
  {
    title: "Search knowledge",
    description:
      "Full-text + fuzzy search across the SJC OS knowledge base (client/vendor " +
      "notes, decisions, business rules, SOPs, lessons, selection preferences, …). " +
      "Optionally scope to a project or lead slug.",
    inputSchema: {
      query: z.string(),
      project_slug: z.string().optional(),
      lead_slug: z.string().optional(),
      kind: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ query, project_slug, lead_slug, kind, limit = 20 }) => {
    const conds = [`(search_tsv @@ websearch_to_tsquery('english', $1) OR content ILIKE '%' || $1 || '%')`];
    const params = [query];
    const pid = await slugToId("projects", project_slug);
    const lid = await slugToId("leads", lead_slug);
    if (project_slug) { params.push(pid); conds.push(`project_id = $${params.length}`); }
    if (lead_slug) { params.push(lid); conds.push(`lead_id = $${params.length}`); }
    if (kind) { params.push(kind); conds.push(`kind = $${params.length}`); }
    params.push(limit);
    return json(
      await rows(
        `SELECT id, kind, source, left(content, 600) AS content, project_id, lead_id, created_at,
                ts_rank(search_tsv, websearch_to_tsquery('english', $1)) AS rank
           FROM knowledge_items
          WHERE ${conds.join(" AND ")}
          ORDER BY rank DESC, created_at DESC
          LIMIT $${params.length}`,
        params,
      ),
    );
  },
);

server.registerTool(
  "fetch_knowledge",
  {
    title: "Fetch knowledge item",
    description: "Full content + metadata + links for one knowledge item by id.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const r = await rows(
      `SELECT k.*, p.slug AS project_slug, l.slug AS lead_slug
         FROM knowledge_items k
         LEFT JOIN projects p ON p.id = k.project_id
         LEFT JOIN leads l ON l.id = k.lead_id
        WHERE k.id = $1`,
      [id],
    );
    return json(r[0] ?? { error: `No knowledge item ${id}` });
  },
);

server.registerTool(
  "list_recent_knowledge",
  {
    title: "List recent knowledge",
    description: "Most recent knowledge items within N days (default 30), optionally by kind/project/lead.",
    inputSchema: {
      days: z.number().int().min(1).max(365).optional(),
      kind: z.string().optional(),
      project_slug: z.string().optional(),
      lead_slug: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ days = 30, kind, project_slug, lead_slug, limit = 30 }) => {
    const conds = [`created_at >= now() - ($1 || ' days')::interval`];
    const params = [String(days)];
    if (kind) { params.push(kind); conds.push(`kind = $${params.length}`); }
    if (project_slug) { params.push(await slugToId("projects", project_slug)); conds.push(`project_id = $${params.length}`); }
    if (lead_slug) { params.push(await slugToId("leads", lead_slug)); conds.push(`lead_id = $${params.length}`); }
    params.push(limit);
    return json(
      await rows(
        `SELECT id, kind, source, left(content, 400) AS content, project_id, lead_id, created_at
           FROM knowledge_items WHERE ${conds.join(" AND ")}
          ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      ),
    );
  },
);

// ─── Open Engine: read ──────────────────────────────────────────────────────

server.registerTool(
  "list_work_items",
  {
    title: "List work items",
    description:
      "The SJC OS work queue. Filter by status, assignee_key (human-joe / " +
      "hermes-telegram / claude-code-server / …), project_slug/lead_slug (use " +
      "these to find the to-do tied to the specific job/lead someone is talking " +
      "about instead of paging through the whole queue), and/or a due_before ISO " +
      "date. needs_enrichment:true returns open detector-filed items whose " +
      "factual body hasn't been rewritten yet (enrich each via enrich_work_item " +
      "after reading its source). Ordered by priority then due date.",
    inputSchema: {
      status: z.string().optional(),
      assignee_key: z.string().optional(),
      project_slug: z.string().optional(),
      lead_slug: z.string().optional(),
      due_before: z.string().optional(),
      needs_enrichment: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ status, assignee_key, project_slug, lead_slug, due_before, needs_enrichment, limit = 50 }) => {
    const conds = ["(l.id IS NULL OR l.stage <> 'lost' OR w.status IN ('done','cancelled'))"];
    const params = [];
    if (status) { params.push(status); conds.push(`w.status = $${params.length}`); }
    if (assignee_key) { params.push(assignee_key); conds.push(`w.assignee_key = $${params.length}`); }
    if (project_slug) { params.push(project_slug); conds.push(`p.slug = $${params.length}`); }
    if (lead_slug) { params.push(lead_slug); conds.push(`l.slug = $${params.length}`); }
    if (due_before) { params.push(due_before); conds.push(`w.due_at <= $${params.length}::timestamptz`); }
    if (needs_enrichment) {
      conds.push(`w.created_by LIKE 'detector:%' AND w.enriched_at IS NULL AND w.status NOT IN ('done','cancelled')`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : ``;
    params.push(limit);
    return json(
      await rows(
        `SELECT w.id, w.title, w.status, w.priority, w.assignee_kind, w.assignee_key, w.due_at,
                w.expected_skill_slug, w.expected_runbook_slug, w.requires_approval, w.approval_status,
                w.blocked_reason, w.created_by, w.enriched_at, p.slug AS project_slug, l.slug AS lead_slug
           FROM work_items w
           LEFT JOIN projects p ON p.id = w.project_id
           LEFT JOIN leads l ON l.id = w.lead_id
           ${where}
          ORDER BY array_position(ARRAY['urgent','high','normal','low'], w.priority),
                   w.due_at NULLS LAST, w.created_at DESC
          LIMIT $${params.length}`,
        params,
      ),
    );
  },
);

server.registerTool(
  "get_work_item",
  {
    title: "Get work item",
    description: "One work item by id, with its recent agent runs + receipts.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const item = await rows(
      `SELECT w.*, p.slug AS project_slug, l.slug AS lead_slug
         FROM work_items w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN leads l ON l.id = w.lead_id
        WHERE w.id = $1`,
      [id],
    );
    if (item.length === 0) return json({ error: `No work item ${id}` });
    const [runs, receipts] = await Promise.all([
      rows(`SELECT id, runtime_name, model, status, input_summary, output_summary, started_at, finished_at
              FROM agent_runs WHERE work_item_id = $1 ORDER BY started_at DESC LIMIT 20`, [id]),
      rows(`SELECT id, receipt_kind, uri, label, created_at
              FROM agent_receipts WHERE work_item_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    ]);
    return json({ work_item: item[0], runs, receipts });
  },
);

// ─── Open Skills: read ──────────────────────────────────────────────────────

server.registerTool(
  "list_skills",
  {
    title: "List skills",
    description: "Reusable operating procedures. Filter by category and/or active. Approved skills only unless include_proposed.",
    inputSchema: {
      category: z.string().optional(),
      active: z.boolean().optional(),
      include_proposed: z.boolean().optional(),
    },
  },
  async ({ category, active, include_proposed }) => {
    const conds = [];
    const params = [];
    if (!include_proposed) conds.push(`review_status = 'approved'`);
    if (category) { params.push(category); conds.push(`category = $${params.length}`); }
    if (active !== undefined) { params.push(active); conds.push(`active = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : ``;
    return json(
      await rows(
        `SELECT slug, title, description, category, when_to_use, review_status, active
           FROM skills ${where} ORDER BY category, title`,
        params,
      ),
    );
  },
);

server.registerTool(
  "get_skill",
  {
    title: "Get skill",
    description: "Full skill by slug, including the current approved procedure body (skill_versions).",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const s = await rows(`SELECT * FROM skills WHERE slug = $1`, [slug]);
    if (s.length === 0) return json({ error: `No skill "${slug}"` });
    const body = await rows(
      `SELECT version, body_markdown, change_summary, status, created_at
         FROM skill_versions WHERE id = $1`,
      [s[0].current_version_id],
    );
    return json({ skill: s[0], current_version: body[0] ?? null });
  },
);

server.registerTool(
  "search_skills",
  {
    title: "Search skills",
    description: "Find skills by matching a query against title/description/when_to_use/trigger_phrases.",
    inputSchema: { query: z.string(), category: z.string().optional() },
  },
  async ({ query, category }) => {
    const params = [query];
    let where = `(title ILIKE '%'||$1||'%' OR description ILIKE '%'||$1||'%'
                  OR when_to_use ILIKE '%'||$1||'%' OR array_to_string(trigger_phrases, ' ') ILIKE '%'||$1||'%')`;
    if (category) { params.push(category); where += ` AND category = $${params.length}`; }
    return json(
      await rows(
        `SELECT slug, title, description, category, when_to_use, review_status
           FROM skills WHERE review_status = 'approved' AND ${where} ORDER BY title`,
        params,
      ),
    );
  },
);

server.registerTool(
  "suggest_skill_for_work_item",
  {
    title: "Suggest skill for a work item",
    description:
      "Given a work item id, return the skill/runbook it expects (if set), else the " +
      "best-matching approved skills by fuzzy match against its title/body. An agent " +
      "should load the expected skill before working a non-trivial item.",
    inputSchema: { work_item_id: z.string() },
  },
  async ({ work_item_id }) => {
    const w = await rows(`SELECT title, body, expected_skill_slug, expected_runbook_slug FROM work_items WHERE id = $1`, [work_item_id]);
    if (w.length === 0) return json({ error: `No work item ${work_item_id}` });
    const item = w[0];
    if (item.expected_skill_slug) {
      const s = await rows(`SELECT slug, title, description, when_to_use FROM skills WHERE slug = $1`, [item.expected_skill_slug]);
      return json({ expected_skill_slug: item.expected_skill_slug, expected_runbook_slug: item.expected_runbook_slug, skill: s[0] ?? null, matched_by: "expected" });
    }
    const q = `${item.title} ${item.body || ""}`.slice(0, 400);
    const suggestions = await rows(
      `SELECT slug, title, description, when_to_use
         FROM skills
        WHERE review_status = 'approved' AND active = true
          AND (title ILIKE '%'||$1||'%' OR when_to_use ILIKE '%'||$1||'%'
               OR array_to_string(trigger_phrases,' ') ILIKE '%'||$1||'%'
               OR $1 ILIKE '%'||slug||'%')
        ORDER BY title LIMIT 5`,
      [q],
    );
    return json({ expected_skill_slug: null, expected_runbook_slug: item.expected_runbook_slug, matched_by: "search", suggestions });
  },
);

server.registerTool(
  "list_runbooks",
  {
    title: "List runbooks",
    description: "Ordered chains of skills for larger workflows. Filter by active.",
    inputSchema: { active: z.boolean().optional() },
  },
  async ({ active }) => {
    const where = active !== undefined ? `WHERE active = $1` : ``;
    return json(
      await rows(`SELECT slug, title, description, active FROM runbooks ${where} ORDER BY title`, active !== undefined ? [active] : []),
    );
  },
);

server.registerTool(
  "get_runbook",
  {
    title: "Get runbook",
    description: "One runbook by slug, with its ordered steps (each naming the skill to run + approval gate).",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const rb = await rows(`SELECT * FROM runbooks WHERE slug = $1`, [slug]);
    if (rb.length === 0) return json({ error: `No runbook "${slug}"` });
    const steps = await rows(
      `SELECT step_order, title, skill_slug, expected_output, requires_human_approval
         FROM runbook_steps WHERE runbook_id = $1 ORDER BY step_order`,
      [rb[0].id],
    );
    return json({ runbook: rb[0], steps });
  },
);

// ─── Gated / logged writes ──────────────────────────────────────────────────
// Safe by construction (internal records + append-only audit + proposals).
// No client-facing sends. Every write attributes a runtime and returns its id.

server.registerTool(
  "capture_knowledge",
  {
    title: "Capture knowledge",
    description:
      "Save a durable knowledge item (note/decision/business_rule/sop/lesson/…). " +
      "De-duped by content fingerprint. Optionally link a project/lead slug and " +
      "attribute a runtime; pass agent_run_id to also log a receipt.",
    inputSchema: {
      content: z.string(),
      kind: z.string().optional(),
      project_slug: z.string().optional(),
      lead_slug: z.string().optional(),
      source_uri: z.string().optional(),
      created_by: z.string().optional(),
      agent_run_id: z.string().optional(),
    },
  },
  async ({ content, kind = "note", project_slug, lead_slug, source_uri, created_by = "agent", agent_run_id }) => {
    const mangled = strippedDollarError(content);
    if (mangled) return mangled;
    const fp = createHash("md5").update(content).digest("hex");
    const r = await rows(
      `INSERT INTO knowledge_items (content, kind, source, source_uri, project_id, lead_id, content_fingerprint, created_by)
       VALUES ($1,$2,'agent',$3,$4,$5,$6,$7)
       ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO NOTHING
       RETURNING id`,
      [content, kind, source_uri ?? null, await slugToId("projects", project_slug), await slugToId("leads", lead_slug), fp, created_by],
    );
    const id = r[0]?.id ?? null;
    if (id && agent_run_id) {
      await rows(
        `INSERT INTO agent_receipts (agent_run_id, receipt_kind, uri, label) VALUES ($1,'db_row',$2,$3)`,
        [agent_run_id, `knowledge_items/${id}`, `captured knowledge (${kind})`],
      );
    }
    return json({ ok: true, id, deduped: !id });
  },
);

server.registerTool(
  "import_lead",
  {
    title: "Import an inbound lead",
    description:
      "Create a new lead from an inbound inquiry — the intended path for web-lead " +
      "emails that land in Joe's inbox: parse the email, then import it here. Runs " +
      "the full intake funnel (flexible intake rows, AI scoring, chat room, owner " +
      "feed card) and AUTO-STARTS the lead-intake runbook, which spawns the Gate-1 " +
      "triage work item. Pass the client's answers as provided — do not invent " +
      "fields they skipped. Unknown extra fields go in `extra`. Refuses when a " +
      "non-lost lead with the same email exists (same inquiry → work that lead); " +
      "override with allow_duplicate ONLY for a genuinely new project from the " +
      "same person.",
    inputSchema: {
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      project: z.string().optional(),
      budget: z.string().optional(),
      timeline: z.string().optional(),
      address: z.string().optional(),
      message: z.string().optional(),
      source: z.string().optional(),
      extra: z.record(z.string()).optional(),
      allow_duplicate: z.boolean().optional(),
    },
  },
  async (a) => {
    const mangled = strippedDollarError(
      a.name, a.project, a.budget, a.message, a.timeline,
      ...(a.extra ? Object.values(a.extra) : []),
    );
    if (mangled) return mangled;
    return json(await leadsCall("import", a));
  },
);

server.registerTool(
  "create_work_item",
  {
    title: "Create work item",
    description:
      "Add an item to the SJC OS work queue. requires_approval defaults true. " +
      "Optionally link project/lead slug, set assignee_key, due date, and the " +
      "expected skill/runbook the worker should load.",
    inputSchema: {
      title: z.string(),
      body: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      assignee_kind: z.enum(["human", "agent"]).optional(),
      assignee_key: z.string().optional(),
      due_at: z.string().optional(),
      project_slug: z.string().optional(),
      lead_slug: z.string().optional(),
      expected_skill_slug: z.string().optional(),
      expected_runbook_slug: z.string().optional(),
      requires_approval: z.boolean().optional(),
      created_by: z.string().optional(),
    },
  },
  async (a) => {
    const mangled = strippedDollarError(a.title, a.body);
    if (mangled) return mangled;
    const r = await rows(
      `INSERT INTO work_items
         (title, body, priority, assignee_kind, assignee_key, due_at, project_id, lead_id,
          expected_skill_slug, expected_runbook_slug, requires_approval, source_kind, created_by)
       VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')::timestamptz,$7,$8,$9,$10,$11,'agent',$12)
       RETURNING id`,
      [
        a.title, a.body ?? "", a.priority ?? "normal", a.assignee_kind ?? "human",
        a.assignee_key ?? null, a.due_at ?? "", await slugToId("projects", a.project_slug),
        await slugToId("leads", a.lead_slug), a.expected_skill_slug ?? null,
        a.expected_runbook_slug ?? null, a.requires_approval ?? true, a.created_by ?? "agent",
      ],
    );
    return json({ ok: true, id: r[0].id });
  },
);

server.registerTool(
  "update_work_item_status",
  {
    title: "Update work item status",
    description:
      "Move a work item to a new status (queued/in_progress/waiting_on_*/blocked/" +
      "approval_needed/done/cancelled). Optional note becomes the blocked_reason; " +
      "done sets completed_at. When completing a Today-queue item, include a short " +
      "note and also record_agent_run + record_receipt so the owner sees proof of work.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["queued", "in_progress", "waiting_on_human", "waiting_on_client",
                       "waiting_on_sub", "blocked", "approval_needed", "done", "cancelled"]),
      note: z.string().optional(),
    },
  },
  async ({ id, status, note }) => {
    const mangled = strippedDollarError(note);
    if (mangled) return mangled;
    const r = await rows(
      `UPDATE work_items
          SET status = $2,
              blocked_reason = CASE WHEN $2 IN ('blocked','waiting_on_human','waiting_on_client','waiting_on_sub')
                                    THEN $3 ELSE blocked_reason END,
              completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END
        WHERE id = $1 RETURNING id, status, runbook_instance_id`,
      [id, status, note ?? null],
    );
    if (!r[0]) return json({ ok: false, error: `No work item ${id}` });
    // W6: a status change on a runbook step advances its instance (spawns the
    // next step / completes / cancels). Proxied to the app; best-effort — the
    // status change above already committed either way.
    if (r[0].runbook_instance_id) {
      const adv = await runbooksCall("advance", { work_item_id: id });
      return json({
        ok: true,
        id: r[0].id,
        status: r[0].status,
        runbook_advanced: adv?.ok === true,
        ...(adv?.ok === true ? {} : { runbook_error: adv?.error ?? "advance failed" }),
      });
    }
    return json({ ok: true, id: r[0].id, status: r[0].status });
  },
);

// Enrichment is the ONLY write an agent gets on a detector-filed item's
// content, and it is deliberately narrow: body + enriched_at only. Status,
// priority, assignee, due date, and approval fields stay under the detector's
// (and the owner's) control — the detector auto-resolves the item when the
// underlying condition clears, and enrichment must never fight that.
server.registerTool(
  "enrich_work_item",
  {
    title: "Enrich a detector work item",
    description:
      "Rewrite a detector-filed work item's plain factual body into a short " +
      "readable brief (2–3 sentences: what happened, what to do next, any " +
      "deadline). Only valid on items created_by 'detector:*'; refuses others. " +
      "The original factual body is preserved under '--- source facts ---'. " +
      "Does NOT change status, priority, assignee, due date, or approvals.",
    inputSchema: {
      id: z.string(),
      body: z.string(),
      suggested_next_action: z.string().optional(),
    },
  },
  async ({ id, body, suggested_next_action }) => {
    const mangled = strippedDollarError(body, suggested_next_action);
    if (mangled) return mangled;
    const item = await rows(`SELECT id, body, created_by FROM work_items WHERE id = $1`, [id]);
    if (item.length === 0) return json({ ok: false, error: `No work item ${id}` });
    if (!/^detector:/.test(item[0].created_by)) {
      return json({
        ok: false,
        error: `Refused: work item ${id} was created by "${item[0].created_by}", not a detector. enrich_work_item only rewrites detector-filed items.`,
      });
    }
    // Re-enrichment keeps exactly one source-facts block: the detector's
    // original body, not a stack of earlier briefs.
    const marker = "\n\n--- source facts ---\n";
    const prev = item[0].body ?? "";
    const facts = prev.includes(marker) ? prev.slice(prev.indexOf(marker) + marker.length) : prev;
    const next =
      body.trim() +
      (suggested_next_action ? `\n\nNext action: ${suggested_next_action.trim()}` : "") +
      marker +
      facts;
    await rows(
      `UPDATE work_items SET body = $2, enriched_at = now(), updated_at = now() WHERE id = $1`,
      [id, next],
    );
    return json({ ok: true, id });
  },
);

server.registerTool(
  "record_agent_run",
  {
    title: "Record agent run",
    description:
      "Append an audit row for an automated/assisted AI run. Returns its id (use it " +
      "with record_receipt). Pass status started to open a run, or a terminal status " +
      "with summaries to log a completed one.",
    inputSchema: {
      runtime_name: z.string(),
      model: z.string().optional(),
      status: z.enum(["started", "succeeded", "failed", "cancelled"]).optional(),
      input_summary: z.string().optional(),
      output_summary: z.string().optional(),
      error_summary: z.string().optional(),
      work_item_id: z.string().optional(),
      skill_slug: z.string().optional(),
    },
  },
  async (a) => {
    const terminal = a.status && a.status !== "started";
    const r = await rows(
      `INSERT INTO agent_runs
         (runtime_name, model, status, input_summary, output_summary, error_summary, work_item_id, skill_slug, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9 THEN now() ELSE NULL END)
       RETURNING id`,
      [a.runtime_name, a.model ?? null, a.status ?? "started", a.input_summary ?? "",
       a.output_summary ?? "", a.error_summary ?? null, a.work_item_id ?? null, a.skill_slug ?? null, terminal],
    );
    // W3: a failed run buzzes Joe's phone (the app collapses to one push per
    // runtime per hour and applies quiet hours / throttling).
    if (a.status === "failed") {
      notifyOwnerCall("agent_failure", {
        runtime_name: a.runtime_name,
        error_summary: a.error_summary ?? a.output_summary ?? "",
      });
    }
    return json({ ok: true, id: r[0].id });
  },
);

server.registerTool(
  "record_receipt",
  {
    title: "Record receipt",
    description:
      "Append proof that something happened (email id, calendar event, file path, " +
      "db row, git SHA, draft, invoice number, approval, …). Link an agent_run_id " +
      "and/or work_item_id.",
    inputSchema: {
      receipt_kind: z.string(),
      uri: z.string().optional(),
      label: z.string().optional(),
      agent_run_id: z.string().optional(),
      work_item_id: z.string().optional(),
    },
  },
  async (a) => {
    const r = await rows(
      `INSERT INTO agent_receipts (receipt_kind, uri, label, agent_run_id, work_item_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [a.receipt_kind, a.uri ?? null, a.label ?? "", a.agent_run_id ?? null, a.work_item_id ?? null],
    );
    return json({ ok: true, id: r[0].id });
  },
);

server.registerTool(
  "create_skill_proposal",
  {
    title: "Propose a skill (pending review)",
    description:
      "Suggest a new reusable procedure. Lands as review_status 'proposed' with a " +
      "proposed v1 body — it stays OUT of the active library until Joe approves in " +
      "the SJC OS UI. Use a stable kebab-case slug.",
    inputSchema: {
      slug: z.string(),
      title: z.string(),
      body_markdown: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      when_to_use: z.string().optional(),
      change_summary: z.string().optional(),
      proposed_by: z.string().optional(),
    },
  },
  async (a) => {
    const exists = await rows(`SELECT id FROM skills WHERE slug = $1`, [a.slug]);
    if (exists.length) return json({ ok: false, error: `Skill "${a.slug}" already exists; propose a new version instead.` });
    const s = await rows(
      `INSERT INTO skills (slug, title, description, category, when_to_use, review_status, proposed_by)
       VALUES ($1,$2,$3,$4,$5,'proposed',$6) RETURNING id`,
      [a.slug, a.title, a.description ?? "", a.category ?? "operations", a.when_to_use ?? "", a.proposed_by ?? "agent"],
    );
    const skillId = s[0].id;
    const v = await rows(
      `INSERT INTO skill_versions (skill_id, version, body_markdown, change_summary, status, created_by)
       VALUES ($1,1,$2,$3,'proposed',$4) RETURNING id`,
      [skillId, a.body_markdown, a.change_summary ?? "initial proposal", a.proposed_by ?? "agent"],
    );
    // Point current_version at the proposed v1 so the UI can render it for review.
    await rows(`UPDATE skills SET current_version_id = $2 WHERE id = $1`, [skillId, v[0].id]);
    return json({ ok: true, skill_id: skillId, version_id: v[0].id, review_status: "proposed" });
  },
);

server.registerTool(
  "record_skill_used",
  {
    title: "Record skill used",
    description: "Log that an agent loaded/followed a skill while working an item (stamps the run's skill_slug + a receipt).",
    inputSchema: {
      skill_slug: z.string(),
      work_item_id: z.string().optional(),
      agent_run_id: z.string().optional(),
    },
  },
  async ({ skill_slug, work_item_id, agent_run_id }) => {
    if (agent_run_id) {
      await rows(`UPDATE agent_runs SET skill_slug = $2 WHERE id = $1`, [agent_run_id, skill_slug]);
    }
    const r = await rows(
      `INSERT INTO agent_receipts (agent_run_id, work_item_id, receipt_kind, label)
       VALUES ($1,$2,'skill',$3) RETURNING id`,
      [agent_run_id ?? null, work_item_id ?? null, `used skill ${skill_slug}`],
    );
    return json({ ok: true, receipt_id: r[0].id });
  },
);

// ─── Today queue (Today v2) ─────────────────────────────────────────────────
// Lane patterns are shared with the app's classifier (lib/today-triage.ts) via
// lib/triage-lanes.mjs — the single definition site for DEEP_RE / CHAT_RE.
function laneForMjs(w) {
  if (["chat", "quick", "deep"].includes(w.effort_class)) return w.effort_class;
  const hay = `${w.title} ${w.body ?? ""}`.toLowerCase();
  if (DEEP_RE.test(hay)) return "deep";
  if (CHAT_RE.test(hay)) return "chat";
  return "quick";
}

server.registerTool(
  "get_today_queue",
  {
    title: "Get today's queue",
    description:
      "Joe's Today rail: promoted priorities (promoted_at set) and the " +
      "waiting backlog, with each item's lane (chat = an agent may complete " +
      "it via MCP; quick = one-click for Joe; deep = needs page work). " +
      "READ-ONLY — promotion is app-owned; complete items via " +
      "update_work_item_status.",
    inputSchema: {},
  },
  async () => {
    // WHERE clause kept in lockstep with OPEN_WORK_ITEMS_SQL in lib/today.ts.
    const items = await rows(
      `SELECT w.id, w.title, left(NULLIF(w.body,''),140) AS body, w.status,
              w.priority, w.due_at, w.effort_class,
              (w.promoted_at IS NOT NULL) AS promoted,
              p.slug AS project_slug, l.slug AS lead_slug
         FROM work_items w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN leads l ON l.id = w.lead_id
        WHERE w.status NOT IN ('done','cancelled')
          AND w.assignee_kind = 'human'
          AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')
          AND (w.lead_id IS NOT NULL OR w.project_id IS NOT NULL)
          AND (l.id IS NULL OR l.stage <> 'lost')
        ORDER BY (w.promoted_at IS NOT NULL) DESC,
                 array_position(ARRAY['urgent','high','normal','low'], w.priority),
                 w.due_at NULLS LAST, w.updated_at DESC, w.id`,
    );
    return json(items.map((w) => ({ ...w, lane: laneForMjs(w) })));
  },
);

server.registerTool(
  "snooze_work_item",
  {
    title: "Snooze a work item",
    description:
      "Push a work item's due date out and drop it back to the Waiting-on-me " +
      "backlog (clears app-owned promotion). Use ONLY when Joe asks or the item " +
      "literally can't proceed yet — state the reason. Logs a receipt.",
    inputSchema: {
      id: z.string(),
      days: z.number().int().min(1).max(30).optional(),
      reason: z.string().optional(),
    },
  },
  async ({ id, days = 3, reason }) => {
    const r = await rows(
      `UPDATE work_items
          SET due_at = GREATEST(now(), COALESCE(due_at, now())) + make_interval(days => $2),
              snoozed_until = now() + make_interval(days => $2),
              promoted_at = NULL,
              updated_at = now()
        WHERE id = $1 AND status NOT IN ('done','cancelled')
        RETURNING id, due_at`,
      [id, days],
    );
    if (!r[0]) return json({ ok: false, error: `No open work item ${id}` });
    await rows(
      `INSERT INTO agent_receipts (work_item_id, receipt_kind, label)
       VALUES ($1,'db_row',$2)`,
      [id, `snoozed ${days}d${reason ? `: ${reason}` : ""}`],
    );
    return json({ ok: true, id: r[0].id, due_at: r[0].due_at });
  },
);

server.registerTool(
  "submit_draft_for_approval",
  {
    title: "Submit a draft for owner approval",
    description:
      "For a chat-lane item that turns out to need a client-facing step. NEVER " +
      "sends anything — sets the work item to approval_needed / requested, saves " +
      "the draft as a knowledge item, and logs a receipt. Joe reviews + sends " +
      "from the app.",
    inputSchema: {
      work_item_id: z.string(),
      draft: z.string(),
      kind: z.string().optional(),
    },
  },
  async ({ work_item_id, draft, kind = "draft" }) => {
    const item = await rows(
      `SELECT id, lead_id, project_id, runbook_instance_id FROM work_items WHERE id = $1`,
      [work_item_id],
    );
    if (!item[0]) return json({ ok: false, error: `No work item ${work_item_id}` });
    const fp = createHash("md5").update(draft).digest("hex");
    const k = await rows(
      `INSERT INTO knowledge_items (content, kind, source, project_id, lead_id, content_fingerprint, created_by)
       VALUES ($1,$2,'agent',$3,$4,$5,'agent')
       ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO NOTHING
       RETURNING id`,
      [draft, kind, item[0].project_id, item[0].lead_id, fp],
    );
    const knowledgeId = k[0]?.id ?? null;
    await rows(
      `UPDATE work_items
          SET status = 'approval_needed', approval_status = 'requested', updated_at = now()
        WHERE id = $1`,
      [work_item_id],
    );
    await rows(
      `INSERT INTO agent_receipts (work_item_id, receipt_kind, uri, label)
       VALUES ($1,'draft',$2,$3)`,
      [work_item_id, knowledgeId ? `knowledge_items/${knowledgeId}` : null, `draft ready for approval (${kind})`],
    );
    // W6: keep a runbook instance's status honest (→ waiting_approval).
    if (item[0].runbook_instance_id) await runbooksCall("advance", { work_item_id });
    return json({ ok: true, knowledge_id: knowledgeId });
  },
);

// ─── Document templates (doc-templates plan) ───────────────────────────────
// Create / fill / render AI-fillable business documents (contract, precon, lien
// release, completion cert, …). Drives the app's internal route so the field
// manifest, validation, and rendering stay in one place. AI may fill ONLY
// narrative fields; money/date/statutory fields are locked, and NOTHING here can
// send — submitting for signature is owner-gated in the app.

server.registerTool(
  "list_doc_templates",
  {
    title: "List document templates",
    description:
      "List the AI-fillable document templates with their field manifests (key, " +
      "label, kind, source, required). `source:'ai'` fields are the only ones an " +
      "agent may write via update_document_draft.",
    inputSchema: {},
  },
  async () => json(await docDraftsCall("list_templates")),
);

server.registerTool(
  "create_document_draft",
  {
    title: "Create a document draft",
    description:
      "Start a draft from a template, scoped to a project (project_slug) or lead " +
      "(lead_slug). Auto fields are resolved from the DB; returns the draft id, " +
      "fill report, and the list of fields still missing. Does NOT send anything.",
    inputSchema: {
      template_key: z.string(),
      project_slug: z.string().optional(),
      lead_slug: z.string().optional(),
      estimate_id: z.number().int().optional(),
      invoice_id: z.number().int().optional(),
      change_order_id: z.number().int().optional(),
    },
  },
  async (a) => json(await docDraftsCall("create", a)),
);

server.registerTool(
  "get_document_draft",
  {
    title: "Get a document draft",
    description: "Read one draft: its field values, fill report, status, and missing required fields.",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => json(await docDraftsCall("get", { id })),
);

server.registerTool(
  "list_document_drafts",
  {
    title: "List document drafts",
    description: "List drafts for a project (project_slug) or lead (lead_slug), newest first.",
    inputSchema: { project_slug: z.string().optional(), lead_slug: z.string().optional() },
  },
  async (a) => json(await docDraftsCall("list", a)),
);

server.registerTool(
  "update_document_draft",
  {
    title: "Update a document draft",
    description:
      "Fill narrative fields on a draft. `edits` is a map of field_key → value. " +
      "AI may write ONLY `source:'ai'` narrative fields — edits to money, date, " +
      "enum, or statutory fields are rejected (returned in `rejected`). Re-editing " +
      "a rendered draft marks it stale (re-render to refresh the files).",
    inputSchema: { id: z.number().int(), edits: z.record(z.any()) },
  },
  async (a) => json(await docDraftsCall("update", a)),
);

server.registerTool(
  "render_document_draft",
  {
    title: "Render a document draft",
    description:
      "Validate + render the draft to PDF (signable) and DOCX (editable), saved to " +
      "the project Files browser. Returns file ids, or the still-missing required " +
      "fields. Rendering does NOT send: to get it signed, ask Joe to submit it for " +
      "signature in the app (use submit_draft_for_approval to flag it).",
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => json(await docDraftsCall("render", { id })),
);

// ─── Newsletter (email list + issues) ───────────────────────────────────────
// Reads are direct SELECTs like every other read tool. Writes go THROUGH the
// app's internal route (newsletterCall) so an agent reuses the exact compose /
// queue / drip-enroll logic the browser uses.
//
// THE LINE, restated so no future tool crosses it by accident: there is no send
// tool here. `queue_newsletter_issue` PARKS a copy per recipient in the outbox;
// the owner still clicks Release in /newsletter for anything to reach a real
// inbox. `add_newsletter_recipient` enrolls the contact into whatever welcome
// drip the owner has already armed (the one path that then mails on its own —
// pre-existing + guarded); arming a sequence is NOT exposed here. Do not add a
// release/arm tool without the owner explicitly deciding to move that line.

server.registerTool(
  "list_newsletter_recipients",
  {
    title: "List newsletter recipients",
    description: "The newsletter email list: id, email, name, active flag. Active-first.",
    inputSchema: {},
  },
  async () =>
    json(
      await rows(
        `SELECT id, email, name, active FROM newsletter_recipients ORDER BY active DESC, name, email`,
      ),
    ),
);

server.registerTool(
  "list_newsletter_issues",
  {
    title: "List newsletter issues",
    description:
      "Newsletter issues with status (draft/queued/sent), recipient_count, and block_count. Newest first.",
    inputSchema: {},
  },
  async () =>
    json(
      await rows(
        `SELECT id, title, status, recipient_count,
                jsonb_array_length(COALESCE(blocks,'[]'::jsonb)) AS block_count,
                to_char(created_at, 'FMMon FMDD, YYYY') AS created_label
           FROM newsletters ORDER BY created_at DESC, id DESC`,
      ),
    ),
);

server.registerTool(
  "get_newsletter_issue",
  {
    title: "Get a newsletter issue",
    description: "Full editable content of one issue: title, intro, blocks (JSON), template, status.",
    inputSchema: { id: z.coerce.number().int() },
  },
  async ({ id }) => {
    const r = await rows(
      `SELECT id, title, intro, blocks, template, status, recipient_count FROM newsletters WHERE id = $1`,
      [id],
    );
    return json(r[0] ?? { error: `No issue with id ${id}` });
  },
);

server.registerTool(
  "list_newsletter_outbox",
  {
    title: "List the newsletter outbox",
    description:
      "Parked/sent messages: kind (issue/greeting), the issue title, email, subject, status " +
      "(queued/released/skipped/failed), open_count. 'queued' rows await the owner's Release.",
    inputSchema: {},
  },
  async () =>
    json(
      await rows(
        `SELECT o.id, o.kind, n.title AS issue_title, o.email, o.subject, o.status, o.error, o.open_count,
                to_char(o.queued_at, 'FMMon FMDD, HH12:MI AM') AS queued_label
           FROM newsletter_outbox o
           LEFT JOIN newsletters n ON n.id = o.newsletter_id
          ORDER BY (o.status = 'queued') DESC, o.queued_at DESC, o.id DESC`,
      ),
    ),
);

server.registerTool(
  "list_newsletter_sequences",
  {
    title: "List welcome/drip sequences",
    description:
      "Drip sequences with their active flag, live subscriber count, and step count. `active=true` " +
      "means the owner has armed it — new recipients auto-enroll and it mails on its own. Arming a " +
      "sequence is a human action in the app; it is NOT an agent tool.",
    inputSchema: {},
  },
  async () =>
    json(
      await rows(
        `SELECT s.id, s.name, s.active,
                (SELECT count(*)::int FROM newsletter_subscriptions x
                  WHERE x.sequence_id = s.id AND x.status = 'active') AS subscribers,
                (SELECT count(*)::int FROM newsletter_sequence_steps t
                  WHERE t.sequence_id = s.id) AS steps
           FROM newsletter_sequences s ORDER BY s.created_at DESC, s.id DESC`,
      ),
    ),
);

server.registerTool(
  "list_newsletter_groups",
  {
    title: "List newsletter audiences",
    description:
      "Named subsets of the recipient list (email groups), each with a live member count. Selectable " +
      "as `group_ids` on queue_newsletter_issue to scope a send. Creating/renaming groups and assigning " +
      "membership is a Recipients-tab action in the app, not exposed here yet.",
    inputSchema: {},
  },
  async () => json(await newsletterCall("list_groups", {})),
);

server.registerTool(
  "set_newsletter_welcome_issue",
  {
    title: "Set (or unset) the welcome-email issue",
    description:
      "Mark an issue as THE welcome email sent to new contacts (or unmark it with on:false). It's just " +
      "an issue with is_welcome=true — edit its content with update_newsletter_issue like any other. " +
      "Marking a new one automatically displaces whatever issue was welcome before it: only one at a time.",
    inputSchema: { id: z.coerce.number().int(), on: z.boolean().optional() },
  },
  async ({ id, on }) => json(await newsletterCall("set_welcome", { id, on })),
);

server.registerTool(
  "add_newsletter_recipient",
  {
    title: "Add a newsletter recipient",
    description:
      "Add (or reactivate) an email on the list. Idempotent on email. Parks a one-time welcome " +
      "greeting for the owner to Release, and enrolls the contact into every ACTIVE welcome drip — " +
      "so this is how you 'start the welcome sequence for an email you add'. It only auto-sends if " +
      "the owner has already armed a sequence; otherwise the greeting simply waits in the outbox.",
    inputSchema: { email: z.string(), name: z.string().optional() },
  },
  async (a) => json(await newsletterCall("add_recipient", a)),
);

server.registerTool(
  "update_newsletter_recipient",
  {
    title: "Update a newsletter recipient",
    description:
      "Change a recipient's name and/or active flag. Identify them by `id` or `email`. Setting " +
      "active=false suppresses them from future sends without deleting their history.",
    inputSchema: {
      id: z.coerce.number().int().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
      active: z.boolean().optional(),
    },
  },
  async (a) => json(await newsletterCall("update_recipient", a)),
);

server.registerTool(
  "remove_newsletter_recipient",
  {
    title: "Remove a newsletter recipient",
    description: "Delete a recipient from the list. Identify them by `id` or `email`.",
    inputSchema: { id: z.coerce.number().int().optional(), email: z.string().optional() },
  },
  async (a) => json(await newsletterCall("remove_recipient", a)),
);

server.registerTool(
  "import_client_newsletter_recipients",
  {
    title: "Import client emails to the newsletter",
    description:
      "Add every active client user's email onto the list. Parks a greeting + enrolls each NEWLY " +
      "added contact (no backfill blast). Returns how many were added.",
    inputSchema: {},
  },
  async () => json(await newsletterCall("import_client_recipients", {})),
);

server.registerTool(
  "create_newsletter_issue",
  {
    title: "Create a newsletter issue",
    description:
      "Start a new DRAFT issue from a template (template_key: classic | jobsite | seasonal; " +
      "default classic). Returns its id — then fill it with update_newsletter_issue.",
    inputSchema: { template_key: z.string().optional() },
  },
  async (a) => json(await newsletterCall("create_issue", a)),
);

server.registerTool(
  "update_newsletter_issue",
  {
    title: "Update a newsletter issue",
    description:
      "Edit a DRAFT issue's title, intro, and/or blocks (rejected once queued/sent). `blocks` is an " +
      "array of { kind:'text'|'image'|'button'|'divider'|'quote', heading, body, projectSlug?, " +
      "buttonLabel?, buttonUrl? }; omit `blocks` to leave content untouched.",
    inputSchema: {
      id: z.coerce.number().int(),
      title: z.string().optional(),
      intro: z.string().optional(),
      blocks: z.array(z.any()).optional(),
    },
  },
  async (a) => json(await newsletterCall("update_issue", a)),
);

server.registerTool(
  "queue_newsletter_issue",
  {
    title: "Queue a newsletter issue for send",
    description:
      "Park a copy of the issue in the outbox and flip it to 'queued'. `group_ids`, if given, scopes " +
      "the send to recipients in ANY of those audiences (list_newsletter_groups for ids) — a recipient " +
      "in more than one selected group still gets exactly one copy. Omit for every active recipient. " +
      "NOTHING is emailed here — the owner Releases each row in /newsletter. This is the agent's " +
      "'send', and it deliberately stops one click short of a real inbox.",
    inputSchema: { id: z.coerce.number().int(), group_ids: z.array(z.coerce.number().int()).optional() },
  },
  async ({ id, group_ids }) => json(await newsletterCall("queue_issue", { id, group_ids })),
);

// ─── Purchase orders (per-project procurement) ──────────────────────────────
// Reads are direct SELECTs (list_purchase_orders/get_purchase_order/list_vendors
// above). Writes go THROUGH the app's internal route (poCall) so an agent
// reuses the exact subtotal/status recompute logic the browser uses.
//
// THE LINE, restated: there is no send tool here. create/update/add_line/
// update_line/delete_line only ever touch a draft or queued PO; queue_purchase_
// order just flags it "ready for review" — the owner still clicks "Send to
// vendor" in the app for anything to reach a real inbox. Receiving progress and
// closing out are also owner-only in the app (not exposed here) — do not add
// send/record-receipt/close/void tools without Joe explicitly deciding to move
// that line.

server.registerTool(
  "create_purchase_order",
  {
    title: "Create a draft purchase order",
    description:
      "Draft a PO on a project. vendor_kind is 'vendor' (pass vendor_id from list_vendors), 'sub' " +
      "(pass sub_slug from list_subs — must be assigned to the project), or 'one_off' (just vendor_name/" +
      "email/phone, not saved as a vendor). Does NOT send anything.",
    inputSchema: {
      project_slug: z.string(),
      title: z.string(),
      notes: z.string().optional(),
      vendor_kind: z.enum(["vendor", "sub", "one_off"]).optional(),
      vendor_id: z.string().optional(),
      sub_slug: z.string().optional(),
      vendor_name: z.string(),
      vendor_email: z.string().optional(),
      vendor_phone: z.string().optional(),
    },
  },
  async (a) => json(await poCall("create", a)),
);

server.registerTool(
  "update_purchase_order",
  {
    title: "Update a purchase order",
    description: "Edit a draft/queued PO's title and/or notes (locked once sent).",
    inputSchema: { id: z.coerce.number().int(), title: z.string().optional(), notes: z.string().optional() },
  },
  async (a) => json(await poCall("update", a)),
);

server.registerTool(
  "add_purchase_order_line",
  {
    title: "Add a line to a purchase order",
    description: "Add a line item. unit_cost is a dollar figure (e.g. \"12.50\" or \"$1,200\").",
    inputSchema: {
      po_id: z.coerce.number().int(),
      description: z.string(),
      unit: z.string().optional(),
      qty_ordered: z.number(),
      unit_cost: z.union([z.string(), z.number()]),
    },
  },
  async (a) => json(await poCall("add_line", a)),
);

server.registerTool(
  "update_purchase_order_line",
  {
    title: "Update a purchase order line",
    description: "Edit one line's description/unit/qty/unit_cost. Omitted fields are left as-is.",
    inputSchema: {
      id: z.coerce.number().int(),
      description: z.string().optional(),
      unit: z.string().optional(),
      qty_ordered: z.number().optional(),
      unit_cost: z.union([z.string(), z.number()]).optional(),
    },
  },
  async (a) => json(await poCall("update_line", a)),
);

server.registerTool(
  "delete_purchase_order_line",
  {
    title: "Delete a purchase order line",
    description: "Remove one line from its purchase order.",
    inputSchema: { id: z.coerce.number().int() },
  },
  async ({ id }) => json(await poCall("delete_line", { id })),
);

server.registerTool(
  "queue_purchase_order",
  {
    title: "Mark a purchase order ready to send",
    description:
      "Draft → queued: flags the PO ready for Joe's review. NOTHING is emailed — the owner still " +
      "clicks 'Send to vendor' in the app for anything to reach a real inbox.",
    inputSchema: { id: z.coerce.number().int() },
  },
  async ({ id }) => json(await poCall("queue", { id })),
);

// ─── Selections board ───────────────────────────────────────────────────────
// Safety: everything here lands as a DRAFT on the owner's board. There is
// deliberately NO tool that pushes a decision to the client portal or records a
// client's pick — sending options to a client and answering on their behalf both
// stay owner-gated in the app, same line as newsletter Release and PO Send.
// Deletes are not exposed either; an agent can build and refine a board, not
// tear one down.

server.registerTool(
  "get_project_selections",
  {
    title: "Get a project's selections board",
    description:
      "The full selections tree for one project: rooms and sub-sections with budgets, the " +
      "decisions filed under each (with allowance + status), and the options offered for each " +
      "decision. Use this before adding anything so you don't duplicate rooms or decisions.",
    inputSchema: { slug: z.string() },
  },
  async ({ slug }) => {
    const projectId = await slugToId("projects", slug);
    if (!projectId) return json({ error: `No project with slug "${slug}"` });
    const [budgetRow, sections, items, options] = await Promise.all([
      rows(`SELECT selections_budget FROM projects WHERE id = $1`, [projectId]),
      rows(
        `SELECT id, parent_id, name, budget, sort_order FROM project_sections
          WHERE project_id = $1 ORDER BY sort_order, id`,
        [projectId],
      ),
      rows(
        `SELECT id, section_id, area, choice, notes, allowance, status, chosen_option_id
           FROM project_selections WHERE project_id = $1 ORDER BY sort_order, id`,
        [projectId],
      ),
      rows(
        `SELECT o.id, o.selection_id, o.name, o.brand, o.sku, o.product_url, o.price, o.note
           FROM project_selection_options o
           JOIN project_selections s ON s.id = o.selection_id
          WHERE s.project_id = $1 ORDER BY o.sort_order, o.id`,
        [projectId],
      ),
    ]);
    // Same roll-up the board shows: committed = chosen option price on approved
    // decisions (allowance if the pick has no price); the budget the total is
    // measured against is the overall figure when set, else the room budgets.
    const overallBudget = Number(budgetRow[0]?.selections_budget) || 0;
    const allocatedBudget = sections
      .filter((s) => s.parent_id === null)
      .reduce((n, s) => n + (Number(s.budget) || 0), 0);
    const totalBudget = overallBudget > 0 ? overallBudget : allocatedBudget;
    const committed = items
      .filter((i) => i.status === "approved")
      .reduce((n, i) => {
        const pick = options.find((o) => o.id === i.chosen_option_id);
        return n + ((pick && Number(pick.price)) || Number(i.allowance) || 0);
      }, 0);
    return json({
      project: slug,
      budget: {
        overall: overallBudget,
        allocated_to_rooms: allocatedBudget,
        measured_against: totalBudget,
        committed,
        remaining: totalBudget - committed,
      },
      sections,
      decisions: items,
      options,
      summary: {
        decisions: items.length,
        open: items.filter((i) => i.status !== "approved").length,
        without_options: items.filter((i) => !options.some((o) => o.selection_id === i.id)).length,
      },
    });
  },
);

server.registerTool(
  "set_selections_budget",
  {
    title: "Set a project's overall selections budget",
    description:
      "Set the project-wide selections budget (whole dollars) that the client's running total of " +
      "chosen options is measured against on the portal. Room and sub-section budgets are separate " +
      "(create_selection_section / build_selection_plan); when this is 0 the board falls back to " +
      "their sum. Pass 0 to clear it.",
    inputSchema: {
      project_slug: z.string(),
      budget: z.number().int().min(0),
    },
  },
  async (a) => {
    const projectId = await slugToId("projects", a.project_slug);
    if (!projectId) return json({ error: `No project with slug "${a.project_slug}"` });
    await rows(`UPDATE projects SET selections_budget = $2 WHERE id = $1`, [projectId, a.budget]);
    return json({ ok: true, project: a.project_slug, selections_budget: a.budget });
  },
);

server.registerTool(
  "create_selection_section",
  {
    title: "Create a selections room or sub-section",
    description:
      "Add a room (or, with parent_section_id, a sub-section of one) to a project's selections " +
      "board. Nesting is one level deep — passing a sub-section as the parent files the new " +
      "section under that sub-section's room instead. Budget is whole dollars.",
    inputSchema: {
      project_slug: z.string(),
      name: z.string(),
      budget: z.number().int().min(0).optional(),
      parent_section_id: z.coerce.number().int().optional(),
    },
  },
  async (a) => {
    const projectId = await slugToId("projects", a.project_slug);
    if (!projectId) return json({ error: `No project with slug "${a.project_slug}"` });
    const parentId = await resolveSectionParent(projectId, a.parent_section_id);
    const r = await rows(
      `INSERT INTO project_sections (project_id, name, budget, parent_id, sort_order)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order)+1,0) FROM project_sections WHERE project_id=$1))
       RETURNING id`,
      [projectId, a.name, a.budget ?? 0, parentId],
    );
    return json({ ok: true, id: r[0].id, parent_id: parentId });
  },
);

server.registerTool(
  "create_selection_item",
  {
    title: "Create a selection decision",
    description:
      "Add one decision that needs an answer — 'Kitchen faucet', 'Primary bath floor tile' — to a " +
      "project's board. `area` names the decision itself, not the pick. `allowance` is what the " +
      "budget carries for it (whole dollars). Lands as a draft; options are added separately and " +
      "the owner is the one who sends it to the client.",
    inputSchema: {
      project_slug: z.string(),
      area: z.string(),
      section_id: z.coerce.number().int().optional(),
      allowance: z.number().int().min(0).optional(),
      spec: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    const projectId = await slugToId("projects", a.project_slug);
    if (!projectId) return json({ error: `No project with slug "${a.project_slug}"` });
    const sectionId = await scopedSectionId(projectId, a.section_id);
    const r = await rows(
      `INSERT INTO project_selections
         (project_id, section_id, area, choice, notes, allowance, status, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',
               (SELECT COALESCE(MAX(sort_order)+1,0) FROM project_selections WHERE project_id=$1))
       RETURNING id`,
      [projectId, sectionId, a.area, a.spec ?? "", a.notes ?? "", a.allowance ?? 0],
    );
    return json({ ok: true, id: r[0].id, section_id: sectionId });
  },
);

server.registerTool(
  "update_selection_item",
  {
    title: "Update a selection decision",
    description:
      "Edit a decision's name, spec note, internal notes, allowance, or section. Only the fields " +
      "you pass change. Status and the client's pick are never touched here.",
    inputSchema: {
      id: z.coerce.number().int(),
      area: z.string().optional(),
      allowance: z.number().int().min(0).optional(),
      spec: z.string().optional(),
      notes: z.string().optional(),
      section_id: z.coerce.number().int().optional(),
    },
  },
  async (a) => {
    const cur = await rows(`SELECT project_id FROM project_selections WHERE id = $1`, [a.id]);
    if (cur.length === 0) return json({ error: `No selection with id ${a.id}` });
    const sectionId =
      a.section_id === undefined ? undefined : await scopedSectionId(cur[0].project_id, a.section_id);
    await rows(
      `UPDATE project_selections
          SET area       = COALESCE($2, area),
              choice     = COALESCE($3, choice),
              notes      = COALESCE($4, notes),
              allowance  = COALESCE($5, allowance),
              section_id = COALESCE($6, section_id)
        WHERE id = $1`,
      [a.id, a.area ?? null, a.spec ?? null, a.notes ?? null, a.allowance ?? null, sectionId ?? null],
    );
    return json({ ok: true, id: a.id });
  },
);

server.registerTool(
  "add_selection_option",
  {
    title: "Add an option to a selection decision",
    description:
      "Hang one candidate product off a decision for the client to choose between. Two or three " +
      "per decision is the useful number. Price is whole dollars. Images are NOT fetched here — " +
      "the owner pastes the product link in the app and clicks Fetch, or uploads a photo.",
    inputSchema: {
      selection_id: z.coerce.number().int(),
      name: z.string(),
      brand: z.string().optional(),
      sku: z.string().optional(),
      product_url: z.string().optional(),
      price: z.number().int().min(0).optional(),
      note: z.string().optional(),
    },
  },
  async (a) => {
    const owner = await rows(`SELECT id FROM project_selections WHERE id = $1`, [a.selection_id]);
    if (owner.length === 0) return json({ error: `No selection with id ${a.selection_id}` });
    const r = await rows(
      `INSERT INTO project_selection_options
         (selection_id, name, brand, sku, product_url, price, note, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               (SELECT COALESCE(MAX(sort_order)+1,0) FROM project_selection_options WHERE selection_id=$1))
       RETURNING id`,
      [
        a.selection_id, a.name, a.brand ?? "", a.sku ?? "",
        a.product_url ?? "", a.price ?? 0, a.note ?? "",
      ],
    );
    return json({ ok: true, id: r[0].id });
  },
);

server.registerTool(
  "build_selection_plan",
  {
    title: "Build a whole selections plan at once",
    description:
      "Create an entire room → sub-section → decision → option tree in one transactional call. " +
      "This is the tool to use after reading a project's plan set: one room per space, " +
      "sub-sections where a room needs them, and every finish that needs a decision as an item. " +
      "Idempotent by name — a room or decision that already exists at the same place is reused, " +
      "not duplicated, so re-running after adding a page of plans only adds what's new. " +
      "Everything lands as a draft for the owner to review; nothing reaches the client.",
    inputSchema: {
      project_slug: z.string(),
      sections: z.array(
        z.object({
          name: z.string(),
          budget: z.number().int().min(0).optional(),
          items: z
            .array(
              z.object({
                area: z.string(),
                allowance: z.number().int().min(0).optional(),
                spec: z.string().optional(),
                notes: z.string().optional(),
                options: z
                  .array(
                    z.object({
                      name: z.string(),
                      brand: z.string().optional(),
                      sku: z.string().optional(),
                      product_url: z.string().optional(),
                      price: z.number().int().min(0).optional(),
                      note: z.string().optional(),
                    }),
                  )
                  .optional(),
              }),
            )
            .optional(),
          subsections: z
            .array(
              z.object({
                name: z.string(),
                budget: z.number().int().min(0).optional(),
                items: z
                  .array(
                    z.object({
                      area: z.string(),
                      allowance: z.number().int().min(0).optional(),
                      spec: z.string().optional(),
                      notes: z.string().optional(),
                      options: z
                        .array(
                          z.object({
                            name: z.string(),
                            brand: z.string().optional(),
                            sku: z.string().optional(),
                            product_url: z.string().optional(),
                            price: z.number().int().min(0).optional(),
                            note: z.string().optional(),
                          }),
                        )
                        .optional(),
                    }),
                  )
                  .optional(),
              }),
            )
            .optional(),
        }),
      ),
    },
  },
  async (a) => {
    const projectId = await slugToId("projects", a.project_slug);
    if (!projectId) return json({ error: `No project with slug "${a.project_slug}"` });

    const client = await pool.connect();
    const created = { sections: 0, subsections: 0, decisions: 0, options: 0 };
    const reused = { sections: 0, decisions: 0 };
    try {
      await client.query("BEGIN");

      // Reuse a section with the same name at the same level, so re-running the
      // tool after reading another plan page tops the board up instead of
      // building a second "Kitchen".
      const upsertSection = async (name, budget, parentId) => {
        const found = await client.query(
          `SELECT id FROM project_sections
            WHERE project_id = $1 AND lower(name) = lower($2)
              AND parent_id IS NOT DISTINCT FROM $3
            LIMIT 1`,
          [projectId, name, parentId],
        );
        if (found.rows.length) {
          if (budget) {
            await client.query(`UPDATE project_sections SET budget = $2 WHERE id = $1`, [
              found.rows[0].id, budget,
            ]);
          }
          if (parentId === null) reused.sections++;
          return found.rows[0].id;
        }
        const r = await client.query(
          `INSERT INTO project_sections (project_id, name, budget, parent_id, sort_order)
           VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order)+1,0) FROM project_sections WHERE project_id=$1))
           RETURNING id`,
          [projectId, name, budget ?? 0, parentId],
        );
        if (parentId === null) created.sections++;
        else created.subsections++;
        return r.rows[0].id;
      };

      const addItems = async (items, sectionId) => {
        for (const it of items ?? []) {
          const found = await client.query(
            `SELECT id FROM project_selections
              WHERE project_id = $1 AND lower(area) = lower($2)
                AND section_id IS NOT DISTINCT FROM $3
              LIMIT 1`,
            [projectId, it.area, sectionId],
          );
          let itemId;
          if (found.rows.length) {
            itemId = found.rows[0].id;
            reused.decisions++;
          } else {
            const r = await client.query(
              `INSERT INTO project_selections
                 (project_id, section_id, area, choice, notes, allowance, status, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,'draft',
                       (SELECT COALESCE(MAX(sort_order)+1,0) FROM project_selections WHERE project_id=$1))
               RETURNING id`,
              [projectId, sectionId, it.area, it.spec ?? "", it.notes ?? "", it.allowance ?? 0],
            );
            itemId = r.rows[0].id;
            created.decisions++;
          }
          for (const op of it.options ?? []) {
            const dupe = await client.query(
              `SELECT id FROM project_selection_options
                WHERE selection_id = $1 AND lower(name) = lower($2) LIMIT 1`,
              [itemId, op.name],
            );
            if (dupe.rows.length) continue;
            await client.query(
              `INSERT INTO project_selection_options
                 (selection_id, name, brand, sku, product_url, price, note, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,
                       (SELECT COALESCE(MAX(sort_order)+1,0) FROM project_selection_options WHERE selection_id=$1))`,
              [itemId, op.name, op.brand ?? "", op.sku ?? "", op.product_url ?? "", op.price ?? 0, op.note ?? ""],
            );
            created.options++;
          }
        }
      };

      for (const sec of a.sections) {
        const sectionId = await upsertSection(sec.name, sec.budget, null);
        await addItems(sec.items, sectionId);
        for (const sub of sec.subsections ?? []) {
          const subId = await upsertSection(sub.name, sub.budget, sectionId);
          await addItems(sub.items, subId);
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      return json({ ok: false, error: e.message });
    } finally {
      client.release();
    }
    return json({ ok: true, project: a.project_slug, created, reused });
  },
);

  // ─── Agent memories (W5 learning layer) ─────────────────────────────────────
  // Standing instructions are the ONLY agent-memory rows with authority, and
  // only Joe's click in /engine can mint one. Everything an agent writes here
  // lands pending / evidence-only (the table's safe defaults) — these tools
  // never set review_status, can_use_as_instruction, or confidence.

  server.registerTool(
    "get_standing_instructions",
    {
      title: "Get standing instructions",
      description:
        "Joe's standing instructions for how agents work. Load at the start of " +
        "every pass and honor them. Read-only.",
      inputSchema: {},
    },
    async () => {
      const r = await rows(
        `SELECT id, summary, content FROM agent_memories
          WHERE review_status = 'approved' AND can_use_as_instruction = true
            AND (stale_after IS NULL OR stale_after > now())
          ORDER BY confidence DESC NULLS LAST, updated_at DESC
          LIMIT 20`,
      );
      return json(r);
    },
  );

  server.registerTool(
    "remember_agent_instruction",
    {
      title: "Remember an agent-work preference",
      description:
        "Store a preference Joe explicitly told an agent to remember about HOW " +
        "AGENTS WORK (business facts still go to capture_knowledge). It lands " +
        "pending for Joe's review in /engine — it is NOT active the moment you " +
        "call this; only his approval makes it a standing instruction.",
      inputSchema: {
        content: z.string(),
        summary: z.string().optional(),
        lead_slug: z.string().optional(),
        project_slug: z.string().optional(),
      },
    },
    async ({ content, summary, lead_slug, project_slug }) => {
      const mangled = strippedDollarError(content);
      if (mangled) return mangled;
      const line = (summary ?? content).split("\n")[0].trim().slice(0, 200);
      // Same near-duplicate guard as the app's capture hooks: a pending memory
      // with this summary absorbs the repeat instead of spawning a sibling.
      const existing = await rows(
        `SELECT id FROM agent_memories
          WHERE review_status = 'pending' AND summary = $1
          ORDER BY created_at DESC LIMIT 1`,
        [line],
      );
      if (existing[0]) {
        await rows(`UPDATE agent_memories SET updated_at = now() WHERE id = $1`, [existing[0].id]);
        return json({ ok: true, id: existing[0].id, deduped: true, status: "pending Joe's review in /engine" });
      }
      const r = await rows(
        `INSERT INTO agent_memories (summary, content, memory_type, lead_id, project_id)
         VALUES ($1, $2, 'preference', $3, $4) RETURNING id`,
        [line, content, await slugToId("leads", lead_slug), await slugToId("projects", project_slug)],
      );
      return json({ ok: true, id: r[0].id, status: "pending Joe's review in /engine" });
    },
  );

  server.registerTool(
    "list_agent_memories",
    {
      title: "List agent memories",
      description:
        "Read-only list of agent memories (for the weekly distill pass, or Joe " +
        "asking what's pending). Filter by review_status pending/approved/rejected.",
      inputSchema: {
        review_status: z.enum(["pending", "approved", "rejected"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ review_status, limit = 50 }) => {
      const params = [];
      let cond = "";
      if (review_status) { params.push(review_status); cond = `WHERE review_status = $${params.length}`; }
      params.push(limit);
      const r = await rows(
        `SELECT id, summary, content, memory_type, review_status, can_use_as_instruction,
                confidence, stale_after, runtime_name, created_at
           FROM agent_memories ${cond}
          ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      return json(r);
    },
  );

  // Mood boards live in their own module — same rules as everything above (no
  // deletes, nothing client-facing), just kept separate to keep this file from
  // growing without bound. See mcp/mood-tools.mjs.
  registerMoodTools(server, { rows, json, uploadDir: path.join(__dirname, "..", "uploads") });

  // Bidding lives in its own module too: stage + award. Sending a package is
  // real email, so it is NOT here — it's a granted send (below).
  registerBiddingTools(server, { rows, json, biddingCall });

  // Owner-granted sends + the request/check/list tools around them. These are
  // the only tools that can reach a real inbox, and each one needs an owner
  // grant id for its exact target. See mcp/grants-tools.mjs.
  registerGrantTools(server, { json, grantsCall });

  // W6 runbook stepper: start a runbook + read live instances. Starting is
  // proxied to the app (spawn + pings live in lib/runbook-engine.ts); reads are
  // direct SQL. No cancel tool — owner-only in the UI. See mcp/runbook-tools.mjs.
  registerRunbookTools(server, { rows, json, runbooksCall });

  // `search` + `fetch`: the two tools ChatGPT's connector requires by name (it
  // rejects a server without them). Read-only unified lookups over the same
  // curated queries — see mcp/chatgpt-tools.mjs.
  registerChatgptTools(server, {
    rows,
    json,
    appUrl: envValue("NEXT_PUBLIC_APP_URL") || "https://os.sjcarpentryllc.com",
  });

  return server;
}

/** Normalise a parent-section id to one level of nesting: handing us a
 *  sub-section files the new section under that sub-section's room instead. */
async function resolveSectionParent(projectId, sectionId) {
  if (!sectionId) return null;
  const r = await rows(
    `SELECT id, parent_id FROM project_sections WHERE id = $1 AND project_id = $2`,
    [sectionId, projectId],
  );
  if (r.length === 0) return null;
  return r[0].parent_id ?? r[0].id;
}

/** Confirm a section id belongs to this project; unknown ids fall back to
 *  Ungrouped rather than leaking a decision into another project's room. */
async function scopedSectionId(projectId, sectionId) {
  if (!sectionId) return null;
  const r = await rows(`SELECT id FROM project_sections WHERE id = $1 AND project_id = $2`, [
    sectionId,
    projectId,
  ]);
  return r[0]?.id ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Transport. Two mutually-exclusive modes, chosen at startup:
//   • stdio (default): an MCP client spawns this file and talks over stdin/stdout.
//     Nothing is exposed on the network; this is the safe local default.
//   • HTTP (set MCP_HTTP_PORT): run as a long-lived Streamable-HTTP service so an
//     off-box / remote agent can connect. Every request is Bearer-gated against
//     MCP_HTTP_TOKEN (a DISTINCT secret from CRON_SECRET). Bind loopback and let
//     nginx terminate TLS + proxy a `/mcp` location to it, exactly like the app.
//     The tool surface is identical — the same curated, no-raw-SQL, send-gated
//     tools — so the DB blast radius does not change; the token just controls who
//     can reach them.
// ───────────────────────────────────────────────────────────────────────────

// Deliberately process.env ONLY (not envValue's .env.local fallback): if this
// fell back to the file, every plain stdio spawn (e.g. the `claude mcp add`
// registration) would also read it and try to bind the port the systemd HTTP
// service already holds, crashing the stdio session with EADDRINUSE. Only the
// systemd unit sets this, via its own `Environment=MCP_HTTP_PORT=...` line.
const httpPort = Number(process.env.MCP_HTTP_PORT || 0);

if (!Number.isFinite(httpPort) || httpPort <= 0) {
  // Default: a single server over stdio.
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // stdio servers stay alive on the transport; nothing to log to stdout (it's the
  // JSON-RPC channel). Errors go to stderr.
} else {
  startHttpServer(httpPort);
}

/**
 * Constant-time Bearer check against MCP_HTTP_TOKEN. Fails closed when the token
 * is unset. Deliberately its own secret — reusing CRON_SECRET would hand every
 * remote MCP client the app's internal-route key.
 */
function httpAuthorized(req) {
  const token = envValue("MCP_HTTP_TOKEN");
  if (!token) return false;
  const got = Buffer.from(req.headers["authorization"] || "");
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Read and JSON-parse a request body; Streamable HTTP wants the parsed body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function rpcError(res, status, code, message, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function startHttpServer(port) {
  if (!envValue("MCP_HTTP_TOKEN")) {
    console.error(
      "[sjcos-mcp] MCP_HTTP_PORT is set but MCP_HTTP_TOKEN is not — refusing to " +
        "start an unauthenticated network server. Set MCP_HTTP_TOKEN and retry.",
    );
    process.exit(1);
  }
  const host = envValue("MCP_HTTP_HOST") || "127.0.0.1";

  // Live sessions: sessionId -> transport. Streamable HTTP keeps one session per
  // client; each has its own server (see buildServer) so requests never cross.
  const transports = Object.create(null);

  const httpServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || host}`);

      // Unauthenticated liveness probe for nginx / systemd health checks.
      if (req.method === "GET" && url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }

      if (url.pathname !== "/mcp") {
        rpcError(res, 404, -32601, "Not found");
        return;
      }

      if (!httpAuthorized(req)) {
        rpcError(res, 401, -32001, "Unauthorized", { "www-authenticate": "Bearer" });
        return;
      }

      const sessionId = req.headers["mcp-session-id"];

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        let transport = sessionId ? transports[sessionId] : undefined;

        if (!transport && isInitializeRequest(body)) {
          // New session: dedicated server + transport, registered on init.
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) delete transports[transport.sessionId];
          };
          const server = buildServer();
          await server.connect(transport);
        } else if (!transport) {
          // Spec: a request carrying a session id the server no longer knows
          // (typically: we restarted) MUST get 404 — that is the signal a
          // client uses to re-initialize. A 400 here left ChatGPT / claude.ai
          // stuck erroring after every deploy until the connector was re-added.
          if (sessionId) {
            rpcError(res, 404, -32001, "Session not found — send a new initialize request.");
          } else {
            rpcError(res, 400, -32000, "No valid session — send an initialize request first.");
          }
          return;
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        // GET opens the server->client SSE stream; DELETE terminates the session.
        const transport = sessionId ? transports[sessionId] : undefined;
        if (!transport) {
          // Same rule: unknown id → 404 (re-init), no id at all → 400.
          rpcError(res, sessionId ? 404 : 400, sessionId ? -32001 : -32000,
            sessionId ? "Session not found — send a new initialize request." : "Missing session id.");
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      rpcError(res, 405, -32000, "Method not allowed", { allow: "GET, POST, DELETE" });
    } catch (e) {
      console.error("[sjcos-mcp] HTTP request error:", e?.message || e);
      rpcError(res, 500, -32603, "Internal server error");
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`[sjcos-mcp] Streamable HTTP transport listening on http://${host}:${port}/mcp`);
  });
}
