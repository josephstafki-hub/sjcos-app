-- Retire directory/library entries without destroying assignments, POs or products.
ALTER TABLE subs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Assignment correction can be reversed without losing original scope or dates.
CREATE TABLE IF NOT EXISTS sub_assignment_trash (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sub_slug text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  row jsonb NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sub_slug)
);
