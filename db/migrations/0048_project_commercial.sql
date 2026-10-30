-- 0048 — A job can be marked commercial (2026-10-30).
--
-- After-job care attached the Minnesota statutory home-improvement warranty
-- (Minn. Stat. §327A.02) to every job's warranty email, commercial ones too.
-- projects.commercial (Closeout tab switch) leaves it off; default is a
-- residential job, as before.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS commercial boolean NOT NULL DEFAULT false;
