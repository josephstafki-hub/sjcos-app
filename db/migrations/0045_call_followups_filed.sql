-- 0045 — A call's follow-ups that failed to file are retried (2026-10-30).
--
-- lib/call-notes.ts marked a call's notes done, then filed Joe's to-dos from
-- them; when that filing failed the to-dos were lost (nothing retried it).
-- calls.followups_filed_at stamps a successful filing; the reminders cron
-- re-runs ensureCallFollowUps (idempotent) for recent calls without it.
-- Calls already done are stamped now, so nothing old is re-filed.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS followups_filed_at timestamptz;
UPDATE calls SET followups_filed_at = COALESCE(updated_at, now())
 WHERE notes_status = 'done' AND followups_filed_at IS NULL;
