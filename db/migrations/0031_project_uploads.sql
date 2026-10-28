-- 0031 — Agent uploads of binary project files (mcp/upload-tools.mjs).
--
-- save_project_file only takes text. An agent with a PDF plan set, a photo or
-- an Office file now starts an upload (create_project_upload), sends the bytes
-- with one signed PUT to /api/uploads/<id> or in base64 parts over MCP
-- (append_project_upload), and commits it (commit_project_upload), which
-- checks size + sha256 and lands it in the project's Files. Bytes wait under
-- uploads/.staging/<id>/ until the commit.
--
-- delete_project_file moves a files row into file_trash for 30 days (the
-- project's Files tab shows it with Restore); the blob stays on disk until
-- the purge.

ALTER TABLE files ADD COLUMN IF NOT EXISTS sha256     text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE files SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE files ALTER COLUMN updated_at SET DEFAULT now();
-- Who made it: 'agent:<client name>', 'user', 'app'. NULL on older rows (the
-- readers derive a label from id / client_slug / ai_origin).
ALTER TABLE files ADD COLUMN IF NOT EXISTS created_by text;

CREATE TABLE IF NOT EXISTS project_uploads (
  id               text PRIMARY KEY,                 -- upl-<uuid>
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_slug     text NOT NULL,
  filename         text NOT NULL,                    -- sanitized display name
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  tag              text NOT NULL DEFAULT 'DOC · Agent',
  subtitle         text,
  replace_existing boolean NOT NULL DEFAULT true,
  created_by       text NOT NULL DEFAULT 'agent',
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','committing','committed','expired')),
  put_received_at  timestamptz,
  last_error       text,
  file_id          text REFERENCES files(id) ON DELETE SET NULL,
  replaced         boolean,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  committed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_project_uploads_open ON project_uploads(expires_at) WHERE status IN ('open','committing');

CREATE TABLE IF NOT EXISTS file_trash (
  file_id      text PRIMARY KEY,
  project_slug text NOT NULL,
  name         text NOT NULL,
  row          jsonb NOT NULL,                       -- the files row as it was
  reason       text NOT NULL,
  deleted_by   text NOT NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  purge_after  timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS idx_file_trash_project ON file_trash(project_slug, deleted_at DESC);
