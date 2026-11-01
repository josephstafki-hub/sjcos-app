-- Block is a per-mailbox filing decision, not a Gmail filter or send.
ALTER TABLE inbox_preferences DROP CONSTRAINT inbox_preferences_check;
ALTER TABLE inbox_preferences ADD CONSTRAINT inbox_preferences_check
  CHECK ((subject_key LIKE 'sender:%' AND decision IN ('linked','lead','sub','vendor','other','pending','blocked'))
      OR (subject_key LIKE 'thread:%' AND decision IN ('attention','other')));
-- Existing table and privileges; no new login writes or grant changes.
