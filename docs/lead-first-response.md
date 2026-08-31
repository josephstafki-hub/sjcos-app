# Lead first response (same-day reply to new inbound leads)

Built 2026-08-31. Code: `lib/lead-first-response.ts` (core), `lib/actions/lead-first-response.ts`
(owner buttons), `components/leads/LeadFirstResponse.tsx` (lead-page card),
`app/api/cron/lead-first-response` (10-min sweep), table `lead_first_responses`.

## What happens when a lead comes in

`createInboundLead` (website form → `/api/leads/intake`, Hermes `import_lead`) finishes
exactly as before (score, room, nurture enrollment, runbook), then schedules the first
response with Next `after()` so the form submitter isn't held for the model.

1. **Signals** (deterministic, `readSignals`): description length, photos (an intake row
   labelled photo/picture/attachment, an image URL, "attached … photos", or files on the
   lead), measurements (unit-anchored regex: `12'`, `8 ft`, `10x12`, `200 sq ft`…), budget,
   timeline, address, and the triage verdict.
2. **Model read** (Qwen via `askOllamaJson`): `clarity` (clear / partial / unclear),
   `fit` (fit / unsure / not_fit), a 2–6 word `project_label`, and a one-line personalised
   `opening`. That opening is the only model-written text in the email.
3. **Branch** (`decideBranch`):
   | Condition | Branch |
   |---|---|
   | scorer said PASS, model says not_fit / unsure, or model unavailable | `human_review` — nothing sent; work item + owner push |
   | clarity unclear | `discovery_call` — push for a short call, ask for times |
   | clear + photos + measurements | `rough_estimate` — explain the estimate + process |
   | anything else | `missing_info` — ask for exactly what's missing, offer a call |
4. **Copy** (`composeFirstResponse`): fixed templates in Joe's voice.
5. **Send policy**: staged as `pending` on the lead page unless Settings → AI →
   *Auto-send the first response to new inbound leads* is on (`ai.leadFirstResponseAutoSend`,
   default off). `human_review` never auto-sends.
6. **On send** of a `rough_estimate` reply: lead stage → `rough_estimate`, lead nurture
   drip cancelled for that email, lead task "Send rough estimate" due in 3 business days.

Guards: no email / not at intake / scam-flagged / already emailed → `skipped`. A model
hiccup on a lead under 4 hours old releases the claim so the sweep retries; older than
that it goes to human review. Manually-entered leads are never swept (only rows whose
`created` activity is "Lead received · …").

## Owner controls (lead page card)

Send (with edits) · Dismiss · Redo (re-runs the model) · Draft as *rough estimate /
ask for details / discovery call* (compose a different branch from the stored read).

## Agents

`get_lead` (MCP) now returns `first_response {branch, status, …}`. `status = 'sent'`
means the lead has already heard from us — don't draft a second intro reply.
