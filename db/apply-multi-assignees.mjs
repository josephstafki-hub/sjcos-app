// Migration runner for MULTI-PERSON TO-DOS — a to-do can be on Joe and
// Abigail (and any team member after her) at once, instead of one person.
//
// Joe, 2026-09-30: "make tasks in the open engine assignable to both me and
// abigail (and any other employee in the future) instead of either or."
//
// Until now `work_items.assigned_user_id` held ONE person (NULL = Joe's). This
// adds `work_item_assignees`, one row per person on a to-do:
//
//   • no rows            → Joe's own, exactly as NULL meant before. Detectors,
//                          runbooks and agents keep filing to-dos with nobody
//                          on them, and those stay his.
//   • Abigail            → handed to her (still on Joe's Today with her name).
//   • Joe + Abigail      → both of them. Joe's own id is only ever stored
//                          alongside someone else; "just Joe" is no rows, so
//                          there is still one spelling of "Joe's".
//
// Additive on purpose, like apply-staff-separation.mjs: the running site keeps
// reading and writing `assigned_user_id` until the deploy, so the column stays
// and nothing here breaks it. The new code stops reading it and blanks it on
// every assignment it writes, so the backfill below can only ever copy an
// assignment the OLD code made. That makes this safe to run twice — before the
// build, and again after the restart to pick up anything assigned in between.
//
//   node db/apply-multi-assignees.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS work_item_assignees (
     work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
     user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     assigned_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (work_item_id, user_id)
   )`,
  // A staff Today is "every to-do I'm on" — keyed by person.
  `CREATE INDEX IF NOT EXISTS idx_work_item_assignees_user ON work_item_assignees (user_id)`,
  // Carry over whatever the single-person column holds. The owner's id never
  // lands there (the old writers stored him as NULL), so nothing here can
  // create a "just Joe" row.
  `INSERT INTO work_item_assignees (work_item_id, user_id)
     SELECT id, assigned_user_id FROM work_items
      WHERE assigned_user_id IS NOT NULL
   ON CONFLICT DO NOTHING`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) await client.query(sql);
  const { rows } = await client.query(
    `SELECT u.name, count(*)::int AS n
       FROM work_item_assignees a JOIN users u ON u.id = a.user_id
      GROUP BY u.name ORDER BY u.name`,
  );
  console.log(
    "to-dos per person:",
    rows.map((r) => `${r.name} ${r.n}`).join(", ") || "none assigned yet (everything is Joe's)",
  );
  console.log("apply-multi-assignees: done");
} finally {
  await client.end();
}
