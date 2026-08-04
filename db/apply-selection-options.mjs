// Migration runner for the Houzz-style selections rework: a selection is no
// longer one flat card but a *decision* (an item) that carries several options
// the client chooses between, and sections nest one level so a room can have
// sub-sections.
//
// Every statement is additive and idempotent — safe to re-run. Nothing is
// dropped and no data is deleted: existing project_selections rows keep their
// area/choice/price and simply arrive with zero options, which the board renders
// as "no options yet".
//
//   node db/apply-selection-options.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  // ── Sections nest one level: a room ("Kitchen") owns sub-sections
  //    ("Cabinetry", "Plumbing"). CASCADE so deleting a room takes its
  //    sub-sections with it; the selections underneath survive via their own
  //    ON DELETE SET NULL and fall back to Ungrouped.
  `ALTER TABLE project_sections ADD COLUMN IF NOT EXISTS parent_id bigint
     REFERENCES project_sections(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS idx_sections_parent ON project_sections(parent_id, sort_order)`,

  // ── A selection is now the DECISION, not the pick. `area` is the thing that
  //    needs deciding ("Kitchen faucet"); `choice` degrades to an optional spec
  //    note. Money: `allowance` is what's carried in the budget, and the chosen
  //    option's price is what it actually costs.
  `ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS allowance integer NOT NULL DEFAULT 0`,
  `ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT ''`,
  `ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS due_date date`,
  `ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS chosen_option_id bigint`,

  // ── The options a client picks between. Image is its own upload (including
  //    one pulled down from a product URL) or inherited from a catalog item.
  `CREATE TABLE IF NOT EXISTS project_selection_options (
     id            bigserial PRIMARY KEY,
     selection_id  bigint NOT NULL REFERENCES project_selections(id) ON DELETE CASCADE,
     name          text NOT NULL DEFAULT '',
     brand         text NOT NULL DEFAULT '',
     sku           text NOT NULL DEFAULT '',
     product_url   text NOT NULL DEFAULT '',
     price         integer NOT NULL DEFAULT 0,
     image_file_id text,
     catalog_id    bigint REFERENCES catalog_items(id) ON DELETE SET NULL,
     note          text NOT NULL DEFAULT '',
     sort_order    integer NOT NULL DEFAULT 0,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_selection_options_sel
     ON project_selection_options(selection_id, sort_order)`,

  // The chosen-option FK is added after the table exists. SET NULL so deleting
  // the picked option reopens the decision instead of deleting the item.
  `ALTER TABLE project_selections DROP CONSTRAINT IF EXISTS project_selections_chosen_option_fkey`,
  `ALTER TABLE project_selections ADD CONSTRAINT project_selections_chosen_option_fkey
     FOREIGN KEY (chosen_option_id) REFERENCES project_selection_options(id) ON DELETE SET NULL`,

  // Existing rows carried their pick inline (choice/price/image). Lift each one
  // into a first option so nothing that was already on a board loses its image
  // or price. Guarded by NOT EXISTS, so re-running is a no-op.
  `INSERT INTO project_selection_options (selection_id, name, price, image_file_id, catalog_id, sort_order)
     SELECT s.id, s.choice, s.price, s.image_file_id, s.catalog_id, 0
       FROM project_selections s
      WHERE s.choice <> ''
        AND NOT EXISTS (SELECT 1 FROM project_selection_options o WHERE o.selection_id = s.id)`,

  // Back-fill allowance from the old inline price so budget roll-ups survive.
  `UPDATE project_selections SET allowance = price WHERE allowance = 0 AND price > 0`,

  // Anything already decided points at the option we just lifted out of it.
  `UPDATE project_selections s
      SET chosen_option_id = o.id
     FROM project_selection_options o
    WHERE o.selection_id = s.id
      AND s.chosen_option_id IS NULL
      AND s.status = 'approved'`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  console.log("\nselections options migration complete.");
} finally {
  await client.end();
}
