#!/usr/bin/env node
// Read-only invoice collision report (A07a).
//
//   DATABASE_URL=postgresql://… node scripts/invoice-collision-report.mjs
//   node scripts/invoice-collision-report.mjs            # reads .env.local
//
// Prints JSON: invoices per project sharing a milestone label or an amount,
// invoices with no economic_key, duplicate display numbers. Runs inside a
// READ ONLY transaction — it cannot write, whichever database it is aimed at.

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { invoiceCollisionReport } from "../lib/billing/core.ts";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
  const m = readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error(`DATABASE_URL not found in ${envFile}`);
  return m[1].trim().replace(/^"|"$/g, "");
}

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET TRANSACTION READ ONLY");
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  const report = await invoiceCollisionReport(run);
  await client.query("ROLLBACK");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  await client.end();
}
