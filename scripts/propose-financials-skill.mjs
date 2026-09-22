#!/usr/bin/env node
// File the "Fill a project's financials from documents" skill as a PROPOSAL.
//
// docs/open-skills-authoring.md: a skill an agent wrote always lands
// `review_status = 'proposed'` and stays out of the active library until Joe
// approves it in /engine › Skills & runbooks. This script takes that path — it
// does exactly what the MCP `create_skill_proposal` tool does — rather than
// seeding the skill as approved. Run it after the financials tools are deployed
// (the skill names tools that do not exist on the live MCP server before then).
//
//   node scripts/propose-financials-skill.mjs            # DRY RUN: show what would be filed
//   node scripts/propose-financials-skill.mjs --approve  # file the proposal
//
// Idempotent: if the slug already exists it says so and changes nothing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const url =
  process.env.DATABASE_URL ??
  readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found (env or ${envFile})`);

const SLUG = "fill-project-financials";
const doc = readFileSync(path.join(here, "..", "docs", "skills", "fill-project-financials.md"), "utf8");
// The body is the document from its first "## " heading on; the preamble above it is repo-facing.
const body = doc.slice(doc.indexOf("\n## ") + 1);
const skill = {
  slug: SLUG,
  title: "Fill a project's financials from documents",
  description: "Take a job from \"profit not known\" to an honest projected profit: budget lines, costs, payers, settings — each dollar counted once.",
  category: "money",
  when_to_use: "Joe asks what a job is making, asks to set up a job's budget or enter its costs, or a job's Money › Overview reads \"Profit not known yet\".",
};

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows: existing } = await client.query(`SELECT review_status FROM skills WHERE slug = $1`, [SLUG]);
  if (existing.length) {
    console.log(`Skill "${SLUG}" already exists (${existing[0].review_status}). Nothing changed.`);
  } else if (!process.argv.includes("--approve")) {
    console.log(`DRY RUN — would file "${skill.title}" as a PROPOSED skill (${body.length} chars, ${body.split("\n").length} lines).`);
    console.log("It stays out of the active library until Joe approves it in /engine › Skills & runbooks.");
    console.log("Re-run with --approve to file it.");
  } else {
    await client.query("BEGIN");
    const { rows: [s] } = await client.query(
      `INSERT INTO skills (slug, title, description, category, when_to_use, review_status, proposed_by)
       VALUES ($1, $2, $3, $4, $5, 'proposed', 'claude') RETURNING id`,
      [skill.slug, skill.title, skill.description, skill.category, skill.when_to_use]);
    const { rows: [v] } = await client.query(
      `INSERT INTO skill_versions (skill_id, version, body_markdown, change_summary, status, created_by)
       VALUES ($1, 1, $2, 'initial proposal — project financials phase 4b', 'proposed', 'claude') RETURNING id`, [s.id, body]);
    await client.query(`UPDATE skills SET current_version_id = $2 WHERE id = $1`, [s.id, v.id]);
    await client.query("COMMIT");
    console.log(`Filed "${SLUG}" as PROPOSED. Joe approves it in /engine › Skills & runbooks.`);
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("FAILED, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
