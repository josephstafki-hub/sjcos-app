-- 0044 — Seed the schedule.internal_adjust policy, OFF (2026-10-30).
--
-- adjust_schedule (app/api/internal/field, MCP adjust_internal_schedule) reads
-- this policy, but it was never seeded, and an internal move that kept every
-- client/sub/supplier date and cost was applied anyway under a made-up
-- "policy:schedule.internal_adjust@0". Now such a move is applied on its own
-- only while this policy is active; otherwise it is staged as Joe's card.
-- Seeded as a draft like every other policy: Joe turns it on, never an agent.

INSERT INTO policies (key, version, config, state, created_by, notes) VALUES
  ('schedule.internal_adjust', 1,
   '{"lane":"agents","requires":["no_commitment_change","no_cost_increase","no_funding_gap"]}'::jsonb,
   'draft', 'plan-gaps',
   'Proposal. An agent may move internal schedule dates on its own when no client, sub or supplier commitment moves, nothing costs more and no funding gap opens. Any other move stays a schedule-impact card for Joe.')
ON CONFLICT (key, version) DO NOTHING;
