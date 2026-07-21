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
  console.error("todos.json must be the full current Today-page inbox list: an array of { title, body?, priority?, status?, lead_slug?, project_slug?, due_at?, source_id? }");
  console.error("Any prior open inbox-cron email work_items omitted from the array are cancelled as stale.");
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
const activeIds = [];
let staleCancelled = 0;
try {
  await client.query("BEGIN");
  for (const todo of todos) {
    const leadId = await slugToId("leads", todo.lead_slug);
    const projectId = await slugToId("projects", todo.project_slug);

    const existing = await client.query(
      `SELECT id
         FROM work_items
        WHERE status NOT IN ('done','cancelled')
          AND source_kind = 'email'
          AND (
            ($1::text IS NOT NULL AND source_id = $1)
            OR ($1::text IS NULL AND lower(title) = lower($2))
          )
        ORDER BY updated_at DESC
        LIMIT 1`,
      [todo.source_id, todo.title],
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
                updated_at = now()
          WHERE id = $1
          RETURNING id, title, priority, status`,
        [existing.rows[0].id, todo.title, todo.body, todo.priority, todo.status, todo.due_at, leadId, projectId, todo.source_id],
      );
      results.push({ action: "updated", ...r.rows[0] });
      activeIds.push(r.rows[0].id);
    } else {
      const r = await client.query(
        `INSERT INTO work_items
           (title, body, status, priority, assignee_kind, assignee_key, due_at, lead_id, project_id,
            source_kind, source_id, requires_approval, created_by)
         VALUES ($1,$2,$3,$4,'human','human-joe',$5::timestamptz,$6,$7,'email',$8,true,'inbox-cron')
         RETURNING id, title, priority, status`,
        [todo.title, todo.body, todo.status, todo.priority, todo.due_at, leadId, projectId, todo.source_id],
      );
      results.push({ action: "created", ...r.rows[0] });
      activeIds.push(r.rows[0].id);
    }
  }

  const stale = await client.query(
    `UPDATE work_items
        SET status = 'cancelled',
            blocked_reason = 'Superseded by latest inbox scan',
            updated_at = now()
      WHERE status NOT IN ('done','cancelled')
        AND source_kind = 'email'
        AND created_by = 'inbox-cron'
        AND NOT (id = ANY($1::uuid[]))`,
    [activeIds],
  );
  staleCancelled = stale.rowCount ?? 0;

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}

console.log(JSON.stringify({ ok: true, count: results.length, stale_cancelled: staleCancelled, results }, null, 2));
