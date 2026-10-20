-- 0029 — Messages: block a number.
-- Joe can block a phone number from its conversation on /messages (spam,
-- robotexts, wrong numbers). blocked_at set = blocked. A blocked number's
-- texts are still recorded (so nothing silently vanishes and STOP/START are
-- still honoured) but they never mark the thread unread, push Joe, or raise
-- the 4-hour "unanswered" to-do; the thread drops out of the main list into
-- "Blocked". Nothing goes OUT to a blocked number either — sendSms and the
-- dispatcher both refuse. Unblock clears it. Owner UI state: no MCP tool
-- writes it (agents see it on list_sms_threads / get_sms_thread).

ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
