-- 0052 — Seed the lead.missing_facts policy, OFF (2026-10-30).
--
-- A11: a lead missing facts Joe needs for a rough estimate (photos, budget,
-- address, timeline, goals) can be asked for them by email, in plain words,
-- at most twice, stopping on a reply, a decline or an opt-out
-- (lib/leads/facts.ts collectMissingFacts). It used to share the
-- routine.followup policy, which is ACTIVE for sub paperwork requests, so
-- wiring it would have started emailing leads at once. It gets its own key,
-- seeded as a draft: the daily reminders pass asks nothing until Joe turns it
-- on from /engine/decisions › Policies. Same window and cadence as
-- routine.followup.

INSERT INTO policies (key, version, config, state, created_by, notes) VALUES
  ('lead.missing_facts', 1,
   '{"lane":"routine_followup","tz":"America/Chicago","window":{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"},
     "cadence":{"minHoursBetween":48,"maxPerRecipientPerWeek":2},
     "stop":["reply","decline","opt_out","pending_owner_decision"],
     "scope":"Ask a lead only for facts still missing for the rough estimate. No price, no canned visit or call."}'::jsonb,
   'draft', 'plan-gaps',
   'Proposal. Email a lead (intake or qualified, with an email) for the facts still missing for the rough estimate, at most twice, weekdays 9–5 Central, never within 48h of the last ask; stops on a reply, a decline or an opt-out. Off: nothing is asked.')
ON CONFLICT (key, version) DO NOTHING;
