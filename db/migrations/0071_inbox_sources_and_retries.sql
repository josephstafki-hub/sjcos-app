-- Website-owned source references travel with the draft, including accepted copies.
ALTER TABLE inbox_drafts ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(sources) = 'array');

-- The replacement owns its lineage before dispatch. A unique parent prevents
-- duplicate sends on double-click/reload; another failure can itself be retried.
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS retry_of_id bigint REFERENCES sms_messages(id);
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_retry_parent ON sms_messages(retry_of_id) WHERE retry_of_id IS NOT NULL;
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS retry_of_id bigint REFERENCES chat_messages(id),
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS delivery_error text;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_retry_parent ON chat_messages(retry_of_id) WHERE retry_of_id IS NOT NULL;
-- No tables, new login write paths or grants. Existing table SELECT grants
-- cover the added columns. Only the website supplies retry lineage/sources.

-- node scripts/db-roles-sql.mjs inbox_drafts sms_messages chat_messages
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'inbox_drafts');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'sms_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'sms_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sms_messages');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'chat_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_messages');
