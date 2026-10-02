-- 0004 — Decision surfaces, dispatcher bookkeeping and routine-policy seeds
-- (WS-approvals: A05/A06 + A10). Additive only; every statement is idempotent.
--
--   • intent_authority        — which decision/grant an intent spent, when, and
--                               whether the use was given back (only when the
--                               provider was provably never called).
--   • communication_optouts   — channel-level opt-outs the dispatcher refuses
--                               at dispatch time (email/sms/phone), independent
--                               of newsletter_recipients.active / sms_threads.opted_out.
--   • telegram_updates        — Telegram update_id dedupe (a repeated/edited/
--                               forwarded callback never resolves twice).
--   • push_devices            — placeholder registry for future native push.
--   • decisions.held_until    — "Hold" (snooze) on a pending decision.
--   • push_outbox.payload     — inline keyboard + decision id for a parked
--                               Telegram card (quiet hours), so the buttons
--                               survive the drain.
--   • policies seeds          — DRAFT proposals for the DECISIONS.md routine
--                               categories. Nothing here is active; Joe
--                               activates a version on purpose.

-- ── Intent ↔ authority binding ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intent_authority (
  intent_id     uuid PRIMARY KEY REFERENCES action_intents(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('decision','grant','policy','owner')),
  ref           text NOT NULL,                       -- decision id / grant id / policy:<key>@<v> / owner
  consumed_at   timestamptz NOT NULL DEFAULT now(),
  transmitted   boolean NOT NULL DEFAULT false,      -- a provider call left the box at least once
  refunded_at   timestamptz,
  note          text
);

-- ── Channel opt-outs (dispatch-time refusal) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS communication_optouts (
  id          bigserial PRIMARY KEY,
  channel     text NOT NULL CHECK (channel IN ('email','sms','phone')),
  address     text NOT NULL,                         -- normalized: lower-cased email / +E.164
  reason      text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT '',              -- reply / unsubscribe link / owner / carrier
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  UNIQUE (channel, address)
);

-- ── Telegram update dedupe ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id     bigint PRIMARY KEY,
  chat_id       text,
  kind          text NOT NULL DEFAULT '',            -- callback_query / message / other
  decision_id   uuid REFERENCES decisions(id) ON DELETE SET NULL,
  outcome       text,                                -- what the handler answered
  received_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Native push placeholder ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('ios','android','web')),
  token       text NOT NULL,
  label       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  UNIQUE (platform, token)
);

-- ── Decision hold (snooze) ───────────────────────────────────────────────────
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS held_until timestamptz;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS hold_note  text;

-- ── Parked Telegram cards keep their buttons ─────────────────────────────────
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('grant','urgent_item','agent_failure','stale_approval','sms_inbound','approval_needed','voice_call','comms','decision'));

-- ── Routine policy proposals (DRAFT — Joe activates) ─────────────────────────
-- Config shapes are read by lib/decisions/routine.ts. Hours are wall-clock in
-- config.tz. "stop" lists the conditions that hold a send even when the policy
-- is active. Every seed is version 1 in state 'draft'; activation is
-- activatePolicy(key, 1) by the owner, never by an agent.
INSERT INTO policies (key, version, config, state, created_by, notes) VALUES
  ('routine.followup', 1,
   '{"lane":"routine_followup","tz":"America/Chicago","window":{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"},
     "cadence":{"minHoursBetween":48,"maxPerRecipientPerWeek":2},
     "stop":["reply","decline","opt_out","pending_owner_decision"],
     "scope":"Factual status chasing inside an already-approved request (missing info, a promised photo, an unanswered date). Never a new or revised scope/pricing request."}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal (DECISIONS.md "Request missing factual information / routine follow-up"). Weekday 09:00–17:00 Central window, at most one chase per recipient every 48h and two per week, stops on a reply, a decline, an opt-out, or while an owner decision is pending on the same job. Activate on /engine/decisions → policies (or activatePolicy) once the wording templates are approved.'),
  ('weekly.client_summary', 1,
   '{"lane":"weekly_summary","tz":"America/Chicago","day":5,"time":"15:00","perJobOverride":true,
     "sources":["sub_portal_progress","approved_photos","schedule_milestones"],
     "screen":["delay","unexpected_condition","added_cost","material_problem"],
     "stop":["opt_out","pending_owner_decision","no_verified_inputs"]}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal. Automatic weekly factual client summary, Friday 15:00 Central by default with a per-job override. Material issues (delays, unexpected conditions, added costs, material problems) are screened to Joe first and never sent automatically.'),
  ('invoice.initial_on_acceptance', 1,
   '{"lane":"sends","trigger":"client_accepts_owner_approved_formal_estimate","requires":["accepted_revision_id","payment_structure"],
     "stop":["missing_payment_structure","duplicate_milestone"]}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal. Initial invoice derived from the client''s acceptance of the owner-approved formal estimate goes out automatically with the construction agreement/SOW (no second owner release). Holds when the payment structure is missing or the milestone was already billed.'),
  ('invoice.progress_on_owner_confirmation', 1,
   '{"lane":"sends","trigger":"owner_confirms_milestone","requires":["milestone_id","evidence"],
     "stop":["duplicate_milestone","disputed","pending_change_order"]}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal. Progress invoice issues automatically once Joe confirms the milestone with evidence; the confirmation is the decision. Never duplicates a billed milestone.'),
  ('invoice.final_on_client_signoff', 1,
   '{"lane":"sends","trigger":"written_client_signoff","requires":["signoff_record","punch_resolved"],
     "stop":["open_punch_items","unapproved_change_order_balance"]}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal. Final invoice on written client sign-off after punch resolution, for the verified remaining balance including approved change orders and recorded payments/credits.'),
  ('postproject.followthrough', 1,
   '{"lane":"sends","tz":"America/Chicago","steps":[{"key":"warranty_care","daysAfter":1},{"key":"review_request","daysAfter":7},{"key":"checkin","daysAfter":90}],
     "stop":["opt_out","open_warranty_issue","pending_owner_decision"],"marketingEnrollment":false}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal. Warranty/care delivery, review request and check-in after closeout. No invented coverage, no marketing enrollment (newsletter arming stays owner-controlled).'),
  ('learning.cost_update', 1,
   '{"lane":"agents","minSamples":3,"outlierSigma":2.5,"keepHistory":true,"requires":["verified_actuals","normalized_units"]}'::jsonb,
   'draft', 'ws-approvals',
   'Proposal. Internal cost assumptions may update from verified, normalized closed-job results with sample support and outlier handling; history and explanations are kept. Markup/profit targets are excluded (one-tap decision).')
ON CONFLICT (key, version) DO NOTHING;
