#!/usr/bin/env node
// Inbox scan batch → work items (A01 shape). Every item goes through
// lib/obligations/work-items.ts refreshSourcedWorkItem, which enforces:
//   • identity = Gmail THREAD id (source_id) + Gmail MESSAGE id (message_id),
//     never the title — a same-title thread with a different id is a separate
//     item, and a new message id on an old thread is NEW work;
//   • a refresh of an existing OPEN item touches only source facts (body/title
//     while nobody has worked the card, last_seen_in_scan_at, empty lead/project
//     links). It never resets owner/assignee, status, priority, approval,
//     due_at, snoozed_until or promoted_at;
//   • a thread whose item is done/cancelled is NOT resurrected by a re-scan;
//   • an item with no thread/message id becomes a review item.
// This script never cancels anything. Items absent from a batch keep a stale
// last_seen_in_scan_at and are flagged for review (never cancelled) after 14
// untouched days by runReminders() in lib/reminders.ts.
//
//   node scripts/upsert-inbox-work-items.mjs todos.json
//   todos.json: [{ title, body?, priority?, status?, lead_slug?, project_slug?,
//                  due_at?, thread_id | source_id, message_id?, from?, mailbox? }]

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { refreshSourcedWorkItem } from "../lib/obligations/work-items.ts";

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
  console.error("todos.json is the current inbox scan batch: an array of { title, body?, priority?, status?, lead_slug?, project_slug?, due_at?, thread_id | source_id, message_id?, mailbox? }");
  console.error("thread_id (Gmail THREAD id) is the stable identity; message_id (Gmail MESSAGE id) makes a new message in an old thread new work. source_id is accepted as an alias for thread_id.");
  console.error("Items with neither id are filed as REVIEW items. This script never cancels items and never resets status/owner/priority/due/approval on existing ones.");
  process.exit(2);
}


const priorities = new Set(["low", "normal", "high", "urgent"]);
const statuses = new Set(["queued", "in_progress", "waiting_on_human", "waiting_on_client", "waiting_on_sub", "blocked", "approval_needed"]);

export function normalizeBatch(raw) {
  if (!Array.isArray(raw)) throw new Error("batch must be an array");
  return raw.map((item, index) => {
  if (!item || typeof item.title !== "string" || !item.title.trim()) throw new Error(`Item ${index + 1} is missing a title`);
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
    thread_id: item.thread_id || item.source_id || null,
    message_id: item.message_id || null,
    mailbox: item.mailbox || "",
  };
});
}

export async function applyBatch(client, batch) {
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  const slugToId = async (table, slug) => {
    if (!slug) return null;
    const r = await client.query(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
    if (!r.rows[0]) throw new Error(`No ${table.slice(0, -1)} with slug ${slug}`);
    return r.rows[0].id;
  };
  const results = [];
  for (const todo of batch) {
    const leadId = await slugToId("leads", todo.lead_slug);
    const projectId = await slugToId("projects", todo.project_slug);
    const r = await refreshSourcedWorkItem(run, {
      sourceKind: "email",
      sourceId: todo.thread_id,
      messageId: todo.message_id,
      provider: "gmail",
      account: todo.mailbox,
      title: todo.title,
      body: todo.body,
      status: todo.status,
      priority: todo.priority,
      leadId,
      projectId,
      dueAt: todo.due_at,
      requiresApproval: true,
      createdBy: "inbox-cron",
      stampScan: true,
    });
    results.push({ action: r.action, id: r.id, obligation_id: r.obligationId, title: todo.title, ...(r.action === "review" ? { reason: r.reason } : {}) });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const inputPath = process.argv[2];
  if (!inputPath) usage();
  const todos = normalizeBatch(JSON.parse(readFileSync(inputPath, "utf8")));
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  let results;
  try {
    await client.query("BEGIN");
    results = await applyBatch(client, todos);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2));
}
