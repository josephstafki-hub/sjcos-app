-- Website-owned drafts. No provider send, worker or MCP write path.
CREATE TABLE IF NOT EXISTS inbox_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND mailbox <> ''),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  thread_key text NOT NULL CHECK (thread_key <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','client_portal','sub_portal','site_form')),
  source text NOT NULL CHECK (source IN ('human','ai')),
  source_message_id text,
  to_email text NOT NULL DEFAULT '',
  cc text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  model text CHECK (model IN ('claude','hermes')),
  based_on text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','drafting','failed','discarded','sent')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'human' AND user_id IS NOT NULL AND source_message_id IS NULL)
      OR (source = 'ai' AND user_id IS NULL AND source_message_id IS NOT NULL AND channel = 'email'))
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_drafts_ai_message
  ON inbox_drafts (mailbox, thread_key, source_message_id) WHERE source = 'ai';
-- Keep terminal human rows as versioned tombstones too: an offline device
-- cannot resurrect a sent/discarded draft using an old baseVersion.
CREATE UNIQUE INDEX IF NOT EXISTS inbox_drafts_human_thread
  ON inbox_drafts (mailbox, user_id, thread_key, channel) WHERE source = 'human';
CREATE INDEX IF NOT EXISTS inbox_drafts_load ON inbox_drafts (mailbox, thread_key);

-- node scripts/db-roles-sql.mjs inbox_drafts
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'inbox_drafts');
