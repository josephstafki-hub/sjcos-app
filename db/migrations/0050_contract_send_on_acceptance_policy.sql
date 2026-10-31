-- 0050 — Seed the contract.send_on_acceptance policy, OFF (2026-10-30).
--
-- WORKFLOW W08: when the client accepts the formal estimate (signs it), the
-- construction agreement is drafted from that estimate and printed right away
-- (lib/workflow/agreement.ts). Sending it for signature is a client-facing
-- send, so it only goes out on its own while this policy is active; otherwise
-- it waits on Documents and Joe is told it's ready. The contract approval gate
-- (design, selections, estimate sign-offs) applies either way. Seeded as a
-- draft: Joe turns it on from /engine/decisions › Policies, never an agent.

INSERT INTO policies (key, version, config, state, created_by, notes) VALUES
  ('contract.send_on_acceptance', 1,
   '{"lane":"sends","template":"contract"}'::jsonb,
   'draft', 'plan-gaps',
   'Proposal. When a client signs the formal estimate, send the construction agreement drafted from that exact estimate for signature without another approval (WORKFLOW W08). Off: it is drafted and printed, and waits on Documents for Joe to send.')
ON CONFLICT (key, version) DO NOTHING;
