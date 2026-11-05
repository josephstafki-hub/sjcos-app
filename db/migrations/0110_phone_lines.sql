-- 0110 — Phone lines: the business numbers, which one is the company's main
-- line, and which (if any) belongs to one team member.
--
-- Joe (2026-11-05): show the number the app uses where it is easy to see; he
-- will port his Google Voice line into Telnyx later and wants to switch the
-- main line between the two. Also: let a number be assigned to an employee's
-- login, while the client / lead / sub / supplier picture stays shared across
-- every account ("summaries would be fine").
--
--   phone_lines        one row per number we own on Telnyx. Exactly one active
--                      row is the company default (texts, agent calls, the
--                      website's opt-in confirmation go out from it). A row with
--                      assigned_user_id is that person's own line: their texts
--                      and calls go out from it, its inbound calls ring their
--                      cell, its texts notify them.
--   sms_threads        now one conversation per (counterparty, our number), so a
--                      client who texts both Joe's line and Abigail's line has two
--                      threads; business_number says which line it is on.
--                      summary / summary_at / summary_message_id hold the short
--                      shared summary every account sees on the record.
--   phone_line_route() SECURITY DEFINER lookup for the narrow logins (the worker
--                      handles inbound calls when the webhook's fast path never
--                      ran) — returns the cell to ring without granting them
--                      users.phone.
--
-- Owner-only writes: only the website (Settings › Phone lines) changes lines.

CREATE TABLE IF NOT EXISTS phone_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text NOT NULL UNIQUE CHECK (number ~ '^\+1[2-9][0-9]{9}$'),
  label              text NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  assigned_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  is_company_default boolean NOT NULL DEFAULT false,
  sms_enabled        boolean NOT NULL DEFAULT true,
  voice_enabled      boolean NOT NULL DEFAULT true,
  active             boolean NOT NULL DEFAULT true,
  voicemail_greeting text CHECK (voicemail_greeting IS NULL OR length(voicemail_greeting) <= 600),
  notes              text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- The company line is nobody's personal line, and it must be usable.
  CONSTRAINT phone_lines_default_shape CHECK (NOT is_company_default OR (assigned_user_id IS NULL AND active))
);
CREATE UNIQUE INDEX IF NOT EXISTS phone_lines_one_default ON phone_lines ((true)) WHERE is_company_default;
CREATE UNIQUE INDEX IF NOT EXISTS phone_lines_one_per_user ON phone_lines (assigned_user_id) WHERE assigned_user_id IS NOT NULL AND active;

COMMENT ON TABLE phone_lines IS 'Business phone numbers on Telnyx: one company default, others optionally assigned to a team member (0110).';

-- Seed the number already in use, read from the call / text records (the env
-- number is also added by the app on first read when this finds nothing).
INSERT INTO phone_lines (number, label, is_company_default)
SELECT n, 'SJC main line', true
  FROM (
    SELECT business_number AS n, count(*) AS c FROM (
      SELECT business_number FROM calls
      UNION ALL SELECT business_number FROM sms_threads
      UNION ALL SELECT to_number FROM sms_messages WHERE direction = 'in'
    ) x
     WHERE business_number ~ '^\+1[2-9][0-9]{9}$'
     GROUP BY business_number
     ORDER BY count(*) DESC
     LIMIT 1
  ) top
 WHERE NOT EXISTS (SELECT 1 FROM phone_lines)
ON CONFLICT (number) DO NOTHING;

-- One thread per (counterparty, our number). Old threads with no number belong
-- to the main line.
UPDATE sms_threads t
   SET business_number = l.number
  FROM phone_lines l
 WHERE l.is_company_default AND t.business_number IS NULL;

ALTER TABLE sms_threads DROP CONSTRAINT IF EXISTS sms_threads_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS sms_threads_phone_line_key ON sms_threads (phone, (COALESCE(business_number, '')));
CREATE INDEX IF NOT EXISTS idx_sms_threads_phone ON sms_threads (phone);
CREATE INDEX IF NOT EXISTS idx_sms_threads_link ON sms_threads (link_type, link_slug) WHERE link_type IS NOT NULL;

ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS summary_at timestamptz;
ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS summary_message_id bigint;
COMMENT ON COLUMN sms_threads.summary IS 'Short AI summary of the conversation, shared with every account on the linked record (0110).';

CREATE INDEX IF NOT EXISTS idx_calls_link ON calls (link_type, link_slug) WHERE link_type IS NOT NULL;

-- Inbound routing for any login: which line a number is, and whose cell rings.
CREATE OR REPLACE FUNCTION phone_line_route(p_number text)
RETURNS TABLE (line_id uuid, label text, assigned_user_id uuid, user_name text, forward_to text, voicemail_greeting text, is_company_default boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.label, l.assigned_user_id, u.name, CASE WHEN u.active THEN u.phone END, l.voicemail_greeting, l.is_company_default
    FROM phone_lines l
    LEFT JOIN users u ON u.id = l.assigned_user_id
   WHERE l.number = p_number AND l.active
$$;
REVOKE ALL ON FUNCTION phone_line_route(text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['sjcos_agent', 'sjcos_worker'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION phone_line_route(text) TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT sjcos_grant('sjcos_agent', 'SELECT', 'phone_lines');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'phone_lines');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'phone_lines');

-- A voicemail on a team member's own line files the callback to-do to them
-- (lib/voice.ts onCallEnded, which runs in the worker's deferred pass).
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'work_item_assignees');
