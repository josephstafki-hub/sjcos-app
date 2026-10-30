-- 0041 — Telegram replies reach staged drafts too (2026-10-30).
--
-- 0034 let Joe reply to a permission card. The cards he gets most — a staged
-- client email ("Approve & send ✓ / Decline", submit_draft_for_approval) — are
-- work items, not decisions, so a reply to one matched nothing ("no card
-- matched", Whitcomb estimate 10-30). Now:
--
--   telegram_reply_targets.work_item_id   the draft card (or its 4h nudge) a
--                                         Telegram message is about.
--   owner_replies.work_item_id            the draft Joe's reply pulled.
--
-- Where the note goes: the chat that submitted the draft (recorded on its
-- 'draft' agent_receipts row, metadata.conversation_id) or the operating agent.

ALTER TABLE telegram_reply_targets ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE;
ALTER TABLE owner_replies ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS owner_replies_work_item_idx ON owner_replies (work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS telegram_reply_targets_work_item_idx ON telegram_reply_targets (work_item_id) WHERE work_item_id IS NOT NULL;
