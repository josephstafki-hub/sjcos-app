-- 0034 — Joe replies to SJC OS cards from Telegram (2026-10-29).
--
-- He swipes-to-reply on a permission card (or the bot's "what should change?"
-- prompt, or an agent's answer) and types what he wants. lib/decisions/
-- owner-replies.ts records it, pulls the request as "changes requested" and
-- routes the note; lib/owner-reply-delivery.ts sends it to the chat that filed
-- the request (live run or a new turn) or to the operating agent, acknowledges
-- on Telegram, and relays the agent's answer.
--
--   owner_replies            one row per message about a card: where it went
--                            (route session|agent) and how it was answered
--                            (revised request, reply_to_owner, or the safety
--                            net relaying the turn's last message).
--   telegram_reply_targets   bot messages Joe can reply to besides the cards
--                            (the prompt, an ack, an agent's answer), mapped to
--                            their decision.

CREATE TABLE IF NOT EXISTS owner_replies (
   id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   decision_id     uuid REFERENCES decisions(id) ON DELETE SET NULL,
   grant_id        uuid REFERENCES owner_grants(id) ON DELETE SET NULL,
   body            text NOT NULL,
   channel         text NOT NULL DEFAULT 'telegram',
   chat_id         text,
   message_id      bigint,
   route           text CHECK (route IN ('session','agent')),
   conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,
   run_id          uuid REFERENCES dev_agent_runs(id) ON DELETE SET NULL,
   trigger_id      uuid,
   state           text NOT NULL DEFAULT 'received' CHECK (state IN ('received','delivered','answered','failed')),
   answer_kind     text CHECK (answer_kind IN ('revised','no_change','question','done','run_reply')),
   answer          text,
   error           text,
   created_at      timestamptz NOT NULL DEFAULT now(),
   delivered_at    timestamptz,
   answered_at     timestamptz
 );

CREATE INDEX IF NOT EXISTS owner_replies_open_idx ON owner_replies (created_at) WHERE state = 'delivered';

CREATE INDEX IF NOT EXISTS owner_replies_grant_idx ON owner_replies (grant_id);

CREATE INDEX IF NOT EXISTS owner_replies_decision_idx ON owner_replies (decision_id);

CREATE TABLE IF NOT EXISTS telegram_reply_targets (
   chat_id         text NOT NULL,
   message_id      bigint NOT NULL,
   decision_id     uuid REFERENCES decisions(id) ON DELETE CASCADE,
   owner_reply_id  uuid REFERENCES owner_replies(id) ON DELETE SET NULL,
   kind            text NOT NULL,
   created_at      timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY (chat_id, message_id)
 );
