// Migration runner for the floor-plan designer (docs/floor-plan-designer-plan.md
// §15): live designs, immutable versions, per-design files (captures/sheets),
// pinned comments, the link from published floor-plan versions back to the
// design they were cut from, placeable-catalog columns, and measure → cost-book
// rules.
//
// Every statement is additive and idempotent — safe to re-run against the live
// DB while the old build is still serving (nothing existing reads the new
// columns). The only backfill parses catalog_items.price into price_cents where
// the display string is an unambiguous "$1,234.56" and leaves the rest null.
//
//   node db/apply-floor-designer.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS plan_designs (
     id          bigserial PRIMARY KEY,
     project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
     lead_slug   text,
     name        text NOT NULL DEFAULT 'Kitchen',
     is_template boolean NOT NULL DEFAULT false,
     doc         jsonb NOT NULL DEFAULT '{}',
     rev         integer NOT NULL DEFAULT 0,
     updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_designs_project ON plan_designs(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_designs_lead    ON plan_designs(lead_slug)`,
  `CREATE TABLE IF NOT EXISTS plan_design_versions (
     id          bigserial PRIMARY KEY,
     design_id   bigint NOT NULL REFERENCES plan_designs(id) ON DELETE CASCADE,
     number      integer NOT NULL,
     label       text NOT NULL DEFAULT '',
     doc         jsonb NOT NULL,
     created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (design_id, number)
   )`,
  `CREATE TABLE IF NOT EXISTS plan_design_files (
     id          bigserial PRIMARY KEY,
     design_id   bigint NOT NULL REFERENCES plan_designs(id) ON DELETE CASCADE,
     version_id  bigint REFERENCES plan_design_versions(id) ON DELETE SET NULL,
     file_id     text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
     kind        text NOT NULL CHECK (kind IN ('capture','sheet_pdf','underlay','photo')),
     label       text NOT NULL DEFAULT '',
     camera      jsonb,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_design_files_design ON plan_design_files(design_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS plan_design_comments (
     id          bigserial PRIMARY KEY,
     design_id   bigint NOT NULL REFERENCES plan_designs(id) ON DELETE CASCADE,
     version_id  bigint REFERENCES plan_design_versions(id) ON DELETE SET NULL,
     anchor      jsonb NOT NULL,
     author_role text NOT NULL CHECK (author_role IN ('owner','staff','client','agent')),
     author_name text NOT NULL DEFAULT '',
     body        text NOT NULL,
     resolved_at timestamptz,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_design_comments_design ON plan_design_comments(design_id, created_at)`,
  `ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS design_id         bigint REFERENCES plan_designs(id) ON DELETE SET NULL`,
  `ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS design_version_id bigint REFERENCES plan_design_versions(id) ON DELETE SET NULL`,
  `ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS preview_file_id   text REFERENCES files(id) ON DELETE SET NULL`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS width_in     numeric(7,2)`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS depth_in     numeric(7,2)`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS height_in    numeric(7,2)`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS place_kind   text NOT NULL DEFAULT ''`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS price_cents  integer`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS cost_item_id bigint REFERENCES cost_items(id) ON DELETE SET NULL`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS model_key    text NOT NULL DEFAULT ''`,
  `ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS material     jsonb`,
  // One-time price parse: only unambiguous "$1,234.56" / "1234" strings.
  `UPDATE catalog_items
      SET price_cents = round((regexp_replace(price, '[^0-9.]', '', 'g'))::numeric * 100)::integer
    WHERE price_cents IS NULL
      AND price ~ '^\\s*\\$?\\s*[0-9]{1,3}(,[0-9]{3})*(\\.[0-9]{1,2})?\\s*$'`,
  `CREATE TABLE IF NOT EXISTS plan_cost_rules (
     id           bigserial PRIMARY KEY,
     measure      text NOT NULL,
     material_tag text NOT NULL DEFAULT '',
     cost_item_id bigint NOT NULL REFERENCES cost_items(id) ON DELETE CASCADE,
     enabled      boolean NOT NULL DEFAULT true,
     UNIQUE (measure, material_tag)
   )`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.trim().split("\n")[0].slice(0, 90));
  }
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM plan_designs`);
  console.log(`done — plan_designs rows: ${rows[0].n}`);
} finally {
  await client.end();
}
