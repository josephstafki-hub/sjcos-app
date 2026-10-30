-- 0049 — Seed the agent.event_wakeups policy, OFF (2026-10-30).
--
-- What people outside the company do can wake the operating agent: a client
-- or sub message (text, portal, a lead's email reply), a portal selection or
-- mood-board approval, a Square payment, a bid Joe records, a sub's day log.
-- Each wake-up is one background agent run (about 16¢ each in October), so
-- they only fire while this policy is active, and only for the kinds listed.
-- Seeded as a draft like every other policy: Joe turns it on from
-- /engine/decisions › Policies, never an agent.

INSERT INTO policies (key, version, config, state, created_by, notes) VALUES
  ('agent.event_wakeups', 1,
   '{"lane":"agents","kinds":["message","selection","payment","quote","field_report"]}'::jsonb,
   'draft', 'plan-gaps',
   'Proposal. Wake the operating agent when a client, sub or supplier does something: a message (text, portal, lead email reply), a portal selection or mood-board approval, a Square payment, a recorded bid, a sub day log. It reads the event, updates records and drafts any reply for Joe; it never sends. Remove a kind from "kinds" to stop those wake-ups.')
ON CONFLICT (key, version) DO NOTHING;
