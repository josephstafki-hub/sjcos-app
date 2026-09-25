#!/usr/bin/env node
// Enqueue an operating-agent trigger by hand (A24). Same idempotent path the
// feature hooks use (lib/agent-runtime/triggers.ts enqueueAgentTrigger).
//
//   node scripts/enqueue-trigger.mjs --kind signature --ref signature_request:12:signed --project <slug> [--lead <slug>] [--payload '{"...":...}']
//   printf '%s' '{"messages":[{"from":"client","text":"..."}]}' | node scripts/enqueue-trigger.mjs --kind message --ref gmail:abc --lead <slug> --payload -
//
// Kinds: signature | message | note | quote | selection | payment | field_report | approval | signoff | sweep.
// DATABASE_URL from env first, else .env.local. Payload may be '-' for stdin
// (preferred for prose — never pass dollar amounts through a double-quoted
// shell argument; see mcp/README.md).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { enqueueAgentTrigger, TRIGGER_KINDS } from "../lib/agent-runtime/triggers.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(REPO, ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const kind = arg("--kind");
  const ref = arg("--ref");
  if (!kind || !ref) throw new Error(`usage: --kind <${TRIGGER_KINDS.join("|")}> --ref <stable-id> [--project slug] [--lead slug] [--payload json|-] [--delay seconds]`);
  let payload = {};
  const p = arg("--payload");
  if (p === "-") payload = JSON.parse(readFileSync(0, "utf8"));
  else if (p) payload = JSON.parse(p);
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    const projectSlug = arg("--project");
    const leadSlug = arg("--lead");
    const projectId = projectSlug ? (await run(`SELECT id FROM projects WHERE slug = $1`, [projectSlug]))[0]?.id : null;
    const leadId = leadSlug ? (await run(`SELECT id FROM leads WHERE slug = $1`, [leadSlug]))[0]?.id : null;
    if (projectSlug && !projectId) throw new Error(`no project ${projectSlug}`);
    if (leadSlug && !leadId) throw new Error(`no lead ${leadSlug}`);
    await client.query("BEGIN");
    const r = await enqueueAgentTrigger(run, { kind, ref, projectId, leadId, payload, enqueuedBy: `cli:${process.env.USER ?? "user"}`, delaySeconds: Number(arg("--delay") ?? 0) });
    await client.query("COMMIT");
    console.log(JSON.stringify({ id: r.trigger.id, kind: r.trigger.kind, ref: r.trigger.ref, state: r.trigger.state, created: r.created, reopened: r.reopened, times_seen: r.trigger.times_seen }));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
