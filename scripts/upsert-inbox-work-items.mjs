#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found in .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function usage() {
  console.error("Usage: node scripts/upsert-inbox-work-items.mjs todos.json");
  console.error("todos.json is the current inbox scan batch: an array of { title, body?, priority?, status?, lead_slug?, project_slug?, due_at?, source_id?, thread_id? }");
  console.error("source_id should be the Gmail THREAD id (message ids change on every reply); thread_id is accepted as an explicit alias.");
  console.error("This script never cancels items. Items absent from the batch keep a stale last_seen_in_scan_at and are aged out (14 days, if untouched) by runReminders() in lib/reminders.ts.");
  process.exit(2);
}

const inputPath = process.argv[2];
if (!inputPath) usage();

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(raw)) usage();

const priorities = new Set(["low", "normal", "high", "urgent"]);
const statuses = new Set([
  "queued",
  "in_progress",
  "waiting_on_human",
  "waiting_on_client",
  "waiting_on_sub",
  "blocked",
  "approval_needed",
]);

const todos = raw.map((item, index) => {
  if (!item || typeof item.title !== "string" || !item.title.trim()) {
    throw new Error(`Item ${index + 1} is missing a title`);
  }
  const priority = item.priority ?? "normal";
  if (!priorities.has(priority)) throw new Error(`Invalid priority for ${item.title}: ${priority}`);
  const status = item.status ?? "waiting_on_human";
  if (!statuses.has(status)) throw new Error(`Invalid status for ${item.title}: ${status}`);
  return {
    title: item.title.trim(),
    body: typeof item.body === "string" ? item.body.trim() : "",
    priority,
    status,
    lead_slug: item.lead_slug || null,
    project_slug: item.project_slug || null,
    due_at: item.due_at || null,
    // Gmail THREAD id, preferred for dedup + stored on the row (message ids
    // change on every reply, which used to recreate the same task repeatedly).
    thread_id: item.thread_id || null,
    // Legacy per-message id — still matched transitionally so existing rows
    // keyed by message id are found (and upgraded to the thread id).
    source_id: item.source_id || null,
  };
});

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();

async function slugToId(table, slug) {
  if (!slug) return null;
  const r = await client.query(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
  if (!r.rows[0]) throw new Error(`No ${table.slice(0, -1)} with slug ${slug}`);
  return r.rows[0].id;
}

const results = [];
try {
  await client.query("BEGIN");
  for (const todo of todos) {
    const leadId = await slugToId("leads", todo.lead_slug);
    const projectId = await slugToId("projects", todo.project_slug);

    // The id we store going forward: the Gmail thread id when the scan provides
    // one, else whatever id it sent (which should itself be the thread id).
    const preferredId = todo.thread_id ?? todo.source_id;

    // Dedup: prefer a thread-id match, then a legacy message-id match, then the
    // title fallback (message ids change on every reply, so a title-only match
    // is what keeps a long thread from spawning a new item per reply while old
    // rows still carry message ids).
    const existing = await client.query(
      `SELECT id
         FROM work_items
        WHERE status NOT IN ('done','cancelled')
          AND source_kind = 'email'
          AND (
            ($1::text IS NOT NULL AND source_id = $1)
            OR ($2::text IS NOT NULL AND source_id = $2)
            OR lower(title) = lower($3)
          )
        ORDER BY CASE
                   WHEN $1::text IS NOT NULL AND source_id = $1 THEN 0
                   WHEN $2::text IS NOT NULL AND source_id = $2 THEN 1
                   ELSE 2
                 END,
                 updated_at DESC
        LIMIT 1`,
      [todo.thread_id, todo.source_id, todo.title],
    );

    if (existing.rows[0]) {
      const r = await client.query(
        `UPDATE work_items
            SET title = $2,
                -- Inbox scans are source-derived and can lag Joe's operational
                -- update. Once an agent has recorded work against a card, keep
                -- the human/agent-refined body instead of clobbering it with the
                -- same stale email summary on the next inbox cron pass.
                body = CASE
                  WHEN EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.work_item_id = work_items.id)
                    OR EXISTS (SELECT 1 FROM agent_receipts rr WHERE rr.work_item_id = work_items.id)
                  THEN work_items.body
                  ELSE $3
                END,
                priority = $4,
                status = $5,
                assignee_kind = 'human',
                assignee_key = 'human-joe',
                due_at = $6::timestamptz,
                lead_id = COALESCE($7, lead_id),
                project_id = COALESCE($8, project_id),
                source_id = COALESCE($9, source_id),
                requires_approval = true,
                last_seen_in_scan_at = now(),
                updated_at = now()
          WHERE id = $1
          RETURNING id, title, priority, status`,
        [existing.rows[0].id, todo.title, todo.body, todo.priority, todo.status, todo.due_at, leadId, projectId, preferredId],
      );
      results.push({ action: "updated", ...r.rows[0] });
    } else {
      const r = await client.query(
        `INSERT INTO work_items
           (title, body, status, priority, assignee_kind, assignee_key, due_at, lead_id, project_id,
            source_kind, source_id, requires_approval, created_by, last_seen_in_scan_at)
         VALUES ($1,$2,$3,$4,'human','human-joe',$5::timestamptz,$6,$7,'email',$8,true,'inbox-cron',now())
         RETURNING id, title, priority, status`,
        [todo.title, todo.body, todo.status, todo.priority, todo.due_at, leadId, projectId, preferredId],
      );
      results.push({ action: "created", ...r.rows[0] });
    }
  }

  // Deliberately NO stale-cancel pass here: this script must never terminate a
  // work item. Items missing from a scan simply keep an old last_seen_in_scan_at
  // and are aged out (after 14 untouched days) by runReminders() in
  // lib/reminders.ts.

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}

console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2));
