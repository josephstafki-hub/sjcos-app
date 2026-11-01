-- Shared across browsers, scoped to the connected mailbox. No Gmail or money writes.
CREATE TABLE IF NOT EXISTS inbox_preferences (
  mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND mailbox <> ''),
  subject_key text NOT NULL,
  decision text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox, subject_key),
  CHECK ((subject_key LIKE 'sender:%' AND decision IN ('linked','lead','sub','vendor','other','pending'))
      OR (subject_key LIKE 'thread:%' AND decision IN ('attention','other')))
);
-- Generated with: node scripts/db-roles-sql.mjs inbox_preferences
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'inbox_preferences');
