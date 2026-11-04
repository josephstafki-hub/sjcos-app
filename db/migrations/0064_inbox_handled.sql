-- App-owned channel handling. Reuse threads; a later message reopens the item.
-- No new table, trigger, or agent/worker write path. Existing role grants stand.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS inbox_key text;
CREATE UNIQUE INDEX IF NOT EXISTS threads_inbox_key_uq ON threads (inbox_key);
