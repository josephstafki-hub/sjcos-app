-- 0028 — Today: "Back to list" on an Up next card.
-- Joe's Today is one list now: the top five (promoted_at set) show as cards
-- under Up next, the rest continue below as rows. "↓ Back to list" clears
-- promoted_at so the card drops into the rows — and stamps sent_back_at so the
-- automatic top-up (lib/today.ts buildQueue) doesn't pull the same item
-- straight back into the slot it just left. It stays out of the top-up until
-- Joe moves it up himself ("↑ Up next" clears it). Like promoted_at, this is
-- app-owned UI state: no MCP tool writes it.

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sent_back_at timestamptz;
