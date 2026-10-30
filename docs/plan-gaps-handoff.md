# Sept 23 build plan: finishing the gaps (hand-off, 2026-10-30)

You are picking up from the session that audited Joe's September 23 build plan.
The plan is in `docs/automation-reliability/` (TASKS.md, WORKFLOW.md, VALIDATION.md and others).
Six read-only reviewers checked every task (A00–A24), every workflow stage (W01–W12) and
every check (V01–V46) against the code and the live database.

**Result:** every task has code, but no task fully meets its Accept criteria.
- The repeated pattern is a lib function plus a passing test, with nothing in the app calling it.
- The second pattern is code reading policy config keys that the seeded policy doesn't use.
- Treat `STATUS.md`'s "Implemented" as unverified.

Each item below names the code it was found in. Items marked **(inferred)** were not traced end to end.
**Re-check the code before changing it.** Some items may be stale, and other sessions are changing
this repo every day.

## How to work (Joe's rules, also in CLAUDE.md)

- Several Claude sessions run on this box at once.
  - Check `git status` before editing. Never commit, revert or stash work you didn't write.
  - Stage explicit paths only (never `git add -A`). Run `git diff --cached --stat` before each commit.
- Small fixes Joe asked for: commit and push straight to `main`. Bigger features: a branch and a PR.
- Tests: `npm test` (disposable Postgres per file).
  - Use your own `SJC_TEST_CLUSTER_TAG=<something>`. The default cluster is shared with other sessions and goes stale.
  - Run `npx tsc --noEmit -p .` and eslint on the files you changed.
- Deploys need Joe's OK when other sessions are live. The live site is `~/sjcos-app`, systemd `sjcos.service`.
  - Order: apply migrations, then `SJC_DIST_DIR=.next-staged npm run build`, then `systemctl --user restart sjcos.service`.
  - Then restart `sjcos-mcp` and `sjcos-worker` if you changed lib/MCP code.
  - Never build into the live `.next`.
- Client-facing sends need Joe's approval (owner grants). Never send anything to a client while testing.
- Talk to Joe in plain words. Use his terms, not invented ones.
- Use the sjcos MCP tools first for any business question.

## Done on 2026-10-30, on main (not deployed yet)

| Commit | What |
|---|---|
| 0811894 | Weekly client update: empty weeks held (no "nothing happened" email); notes that mention a delay, cost or problem held for Joe; reads the seeded `{day, time}` config |
| d394966 | Automatic invoices (deposit, progress, final) are actually emailed (`lib/billing/invoice-email.ts`); the final invoice waits while punch items are open; approving that card issues it |
| 2f5d3ff | MCP can't create owners; login admin only for runs acting for Joe; staff need a `proposal` authority grant to send invoices or estimates |
| 09dd6bf | Estimate recompute keeps Joe's typed prices (markup 0 = no markup; only new evidence lines get the 25% default) |
| 0433ead | Schedule and purchase gates need the construction deposit (`lib/workflow/deposit.ts`), not the pre-con fee |
| e235861 | A sub's COI upload waits for Joe's Accept/Reject (sub page › Paperwork); a stale Approve sends nothing |

## Tier 0: before or at the next deploy

1. ~~**Duplicate migration number on main.**~~ Fixed 2026-10-30 (lead value renumbered to 0040).
   **All migrations through 0043 are APPLIED to live (2026-10-30)**, ahead of the code; the running
   build works on the new schema. The next deploy is just: pull the live checkout, build, restart.
   Run `node db/migrate.mjs --status` first anyway; apply anything newer before pulling.
2. **Deploy** everything above with Joe's OK, and restart sjcos, sjcos-mcp and sjcos-worker.
3. **Resume the weekly update lane** after the deploy. It was paused on 2026-10-30 because every Friday
   update would have been empty: `DELETE FROM lane_pauses WHERE lane = 'weekly_summary'`, or use the lane
   switch on /engine/decisions. Note: nothing writes `field_reports` yet (see Tier 2), so weekly updates
   will simply stay held until that's wired.
   **0044–0046 (Tier 1 below) are NOT applied yet.** All three only add (a draft policy, two columns,
   a trigger) and are safe ahead of the code; apply them with `node db/migrate.mjs` at deploy.
4. ~~**Two paid deposits have no billing key.**~~ Done 2026-10-30 with Joe's OK: Alcantara INV-001 →
   `draw:0:construction-deposit`, Tierney INV-001 → `draw:0:deposit-on-signing` (each estimate's
   draw-0 label, so stage advance finds them). Job totals unchanged.
5. **Ask Joe to keep the backup passphrase and Backblaze keys somewhere off this server**, such as a
   password manager. Without them, the backups can't be decrypted if the server is lost.
6. Ask Joe to raise the Backblaze daily download cap above $0, if he hasn't already.

## Tier 1: wrong results that can still happen (small fixes, straight to main)

**Worked 2026-10-30 (all on main, not deployed).** What's left in Tier 1 is marked at the end.

| Commit | What |
|---|---|
| 5e1223e | Money panel: issued-but-unsent invoices say "not sent" and get Send / Resend (fresh intent after a dead send); no demand letter on an unsent invoice |
| 5570a45 | Staff invoice sends filed as `staff:<user>/authority:<grant>` with the person as principal; dispatcher re-checks the account and grant (migration 0042, applied) |
| c47d0ed | Lead rough-estimate send needs Joe or `proposal` authority (`send_rough_estimate`) |
| a704e5b | COI nags pause while a renewal is under review; W-9 detector counts only live W-9s |
| 7c5951c | /subs, sub page, sub portal: COI status from the expiry date on every read; W-9 from a live document (73 of 93 subs now honestly read "W-9 missing"); portal docs show review state |
| e642e6a | Files route: a sub's restricted paperwork needs the Subs area |
| 3bbe053 | Overdue nags read `routineReminderCandidates` (days past due, balance > 0, no pending ACH); `sent` status counts as gone out |
| bca2902 | Deposit bills once whichever key comes first (`estimate:<id>:initial` vs `draw:0:*`) |
| 529ba5c | Stage advance drafts progress invoices (Joe's Send is the confirmation); honest sent / not emailed / drafted cards |
| 7f84f18 | Kill switch: billing's lane hold uses the dispatcher's wording, so held invoice sends wake |
| 0ebfd06 | `schedule.internal_adjust`: harmless moves auto-apply only with the policy active, else a card; migration 0044 seeds it as draft |
| e39dd3d | Decisions/runbooks routes read the MCP's `principal_user_id`; manual evidence records the real caller |
| 7e5edc8 | Call follow-ups retried by the reminders cron (`calls.followups_filed_at`, migration 0045); vague due dates ask Joe instead of becoming 2001 |
| 024f841 | Accepted-revision check notices edited/deleted lines (`estimates.lines_changed_at` trigger, migration 0046) |
| e5f21b8 | `getProjectEstimates` skips superseded lines |
| 4cf090b | A stale Decline can't mark a sent draft cancelled |
| 7c63b79 | Only Joe arms a drip; MCP financial tools need the money area |
| 12148ce | Job time page: header hours, Adjust timezone shift, sidebar link |
| 2fe6b17 | Houzz exit page: Square from env, real columns; /engine links its sub-pages |

Stale or no change:
- **Credits counted as collected:** `lib/billing/project-totals.ts` is gone; the 0037 ledger counts only
  settled `payment` rows minus refunds/returns. Nothing left.
- **Keep on /time hits a unique index:** not so (fresh event id each tap, update in place).
- **`invoice.progress_on_owner_confirmation`:** the progress path already issues only on Joe's confirmation
  card or his own click; the policy adds nothing. Left as is.
- **`routine.followup` ACTIVE:** still the live switch for sub paperwork requests (Joe turned all 8 on
  2026-10-29). Keep in mind before wiring the lead lib (Tier 3 A11).

Still open, needs Joe:
- ~~**Sent estimates stay editable / prices never frozen on the real send.**~~ Joe: lock it. Done in
  migration 0047 (Postgres refuses client-visible line changes while out or signed; voiding the request
  returns it to draft; the send freezes prices; recompute on a locked estimate freezes and adds no lines).
- The two `milestone_confirmation` card shapes (billing `stageMilestoneConfirmation` vs field
  `confirmMilestone`) are incompatible: approving the billing one would fail. Belongs with Tier 2/3 wiring.

- **Unsent invoices look sent.** The Money panel treats `issued` as "sent" even when delivery failed, and
  the Send button exists only on drafts (`lib/money.ts`, `components/projects/MoneyPanel.tsx`). Add a
  resend for issued-but-unsent invoices. `sendInvoiceOp` already accepts them.
- **Staff sends are filed as Joe's.** `lib/send-ops.ts` `stageAndSend` records them under an `owner:` kind,
  and the dispatcher doesn't re-check the staff grant (`lib/dispatch/authority.ts`). Add a principal to
  `SendAuth` and handle non-owner references.
- **Lead rough estimate send:** `lib/actions/leads.ts` `sendEstimate` needs the same `clientSendVerdict`
  check (`lib/authority/client-sends.ts`).
- **COI reminders:**
  - They nag Joe while a renewal waits for his review. Add
    `NOT EXISTS (… sub_documents … status = 'under_review')` in `lib/reminders.ts` and the COI detector in
    `lib/detectors.ts`. Check `under_review` only.
  - The sub portal and the /subs list show COIs as current or green when they aren't (`lib/sub-portal.ts`,
    `components/sub-portal/SubDocs.tsx`, `lib/subs.ts`).
- **W-9 detector** resolves on any `sub_documents` row in any status (`lib/detectors.ts:~415`).
  The `restricted` flag on files is never checked (`app/api/files/[id]/route.ts`).
- **Billing:**
  - **Reminders:** the overdue cron counts days since sending, not the open balance (`lib/reminders.ts:~207`),
    and the balance-aware `reminderCandidates` has no caller. A pending ACH can still get the
    "demand letter" prompt.
  - **Credits counted as collected:** money totals add up `status='paid'` rows, so credits look like
    collected cash (`lib/billing/project-totals.ts:~44`).
  - **A deposit can be billed twice:** it has two identities (`lib/billing/commands.ts` initial key vs
    `lib/actions/projects.ts:~126` `draw:0`).
  - **Stage advance:**
    - it posts "N milestone invoices sent" whether or not they went out (`lib/actions/projects.ts:~153`);
    - it auto-sends progress invoices without Joe's milestone confirmation (`:~108`).
- **Kill switch:** billing's hold text `sends lane paused:` never matches the dispatcher's wake pattern
  (`lib/dispatch/core.ts:~305`), so held invoice sends never resume.
- **Policy keys:**
  - `schedule.internal_adjust` is read (`app/api/internal/field/route.ts:~81`) but never seeded.
  - `invoice.progress_on_owner_confirmation` is active but nothing reads it.
  - `routine.followup` is ACTIVE, and `lib/leads/routine.ts` expects it for "shadow mode". Wiring the
    lead lib as-is would send real emails.
- **Agent identity:**
  - MCP sends `principal_user_id`, but the runbooks and decisions routes read `on_behalf_of_user_id`
    (`app/api/internal/runbooks/route.ts:~78`, decisions route `:~67` vs `mcp/sjcos-mcp.mjs:~190`).
  - The manual-evidence `actor` is free text, so an agent can type "Joe" (`lib/completion/complete.ts:~133`).
- **Call follow-ups:**
  - A failed follow-up insert is lost: `lib/call-notes.ts:~222-234` marks the notes done first and never
    retries.
  - Due dates are parsed with `new Date(text)` (`lib/call-followups.ts:~47`): "Nov 3" becomes 2001.
    Unclear dates should become a question to Joe.
- **Estimates:**
  - Sent estimates stay editable.
  - The "client accepted this exact revision" check only notices ADDED lines (`lib/billing/commands.ts:~80`).
  - Prices are never frozen on the real send.
  - `getProjectEstimates` doesn't filter superseded lines (`lib/estimates.ts:~91`), so the portal may show
    replaced options **(inferred)**.
- **Stale Decline:** Decline on an already-sent draft still marks it cancelled
  (`lib/approve-work-item.ts` `rejectWorkItemById`, `lib/actions/record-ops.ts`). Minor.
- **Newsletter drips:** arming one needs only the newsletter area (`lib/actions/newsletter.ts:~614`).
  AGENTS.md says owner only.
- **Finance data:** the MCP financial tools don't check areas (`mcp/financials-tools.mjs:~197`).
- **Hours page (/time):**
  - Header totals divide by 3600 twice (`app/(os)/time/page.tsx:~25`).
  - Adjust shifts times by the UTC offset.
  - Keep can hit a unique-index error **(inferred)**.
  - The page isn't in the sidebar.
- **Houzz exit page:**
  - It reads Square settings from app settings, while Square uses env vars (`lib/houzz-exit.ts:~85`).
  - It queries a column that doesn't exist (`:~81`).
  - It isn't linked anywhere.

## Tier 2: switched on but doing nothing (wire them)

**Worked 2026-10-30 on branch `t3/plan-gaps-tier2` (one PR, not merged/deployed).** Migration 0048.
- Friday updates: sub day logs write the field progress report; no `portal_publish` intent (published_at is
  the portal publication); the client portal home shows published updates and their photos.
- After-job care: a signed completion sign-off calls `recordWrittenSignoffCmd`; the gate counts both punch
  lists and closing the last item releases it; seeded `steps` read; `projects.commercial` (Closeout tab)
  drops the MN warranty text.
- Learning: seeded `minSamples` / `outlierSigma` read (MAD sigma rule); the learning step waits for
  per-scope actuals and keeps a `heldOutEvaluation` report instead of claiming done. Budget lines can't
  give per-unit samples, so a job with no per-scope actuals still teaches nothing (said plainly).
- Policies screen on /engine/decisions (owner): on/off, versions, settings, held sends; turning one on wakes
  its held sends.
Not done: owner-side page for weekly summaries (they show on the portal and as cards); project daily logs
by Joe/staff don't feed the weekly update (only sub logs do).

- **Friday client updates:**
  - The sub portal writes `sub_logs`, not `field_reports` (`lib/actions/sub-portal.ts:~68`), so updates
    have no input. Write a client-visible field report from a sub log, or read sub logs.
  - `portal_publish` is not a dispatcher kind (`lib/dispatch/kinds.ts`), so the portal half fails for good,
    and no page shows `weekly_summaries`.
- **After-job care** (`postproject.followthrough`):
  - `recordWrittenSignoff` has no caller, so `post_project_actions` is never created. Hook it to the
    signed completion sign-off.
  - The config doesn't match: the seed has `steps` (warranty on day 1, review on day 7, check-in on day 90),
    but the code reads `checkin_days` and `review_delay_days` (`lib/closeout/postproject.ts:~48`).
  - The Minnesota home-warranty text is always attached, even for commercial jobs (`lib/closeout/server.ts:~93`).
- **Learn from finished jobs** (`learning.cost_update`):
  - The config doesn't match: the seed has `minSamples` and `outlierSigma`, the code reads `min_samples`,
    `max_delta_pct` and `outlier_pct` (`lib/estimating/learning.ts:~111`).
  - The closeout hook drops jobs without per-scope lines (`lib/closeout/server.ts:~25`).
  - `heldOutEvaluation` is unused.
- **Owner policy screen:** nothing in the app shows, activates or disables policies. `activatePolicy`,
  `proposePolicyVersion` and `disablePolicy` (`lib/commands/policies.ts`) are called only from tests, and
  activating a policy doesn't release sends held for it. Add a Policies section to /engine/decisions, owner
  only. The seed notes already point there.

## Tier 3: built but not connected (branch + PR each)

- ~~**Bid-package and supplier-pricing release cards:** approving one sends nothing.~~ **Done (branch
  `t3/tier3-release-cards`):** approving a card emails that one sub (or supplier) through
  `lib/procurement/release-send.ts`, with the card as the approval (no second grant). The content is rebuilt
  at approval and must hash to the card's; an edited package, note or address sends nothing.
- ~~**Construction agreement on acceptance (W08):**~~ **Done (branch `t3/tier3-w08`):** a signed formal
  estimate drafts and prints the construction agreement from that estimate (`lib/workflow/agreement.ts`).
  It sends for signature on its own only while the `contract.send_on_acceptance` policy is active
  (migration 0050, seeded OFF), and the contract approval gate still applies. Otherwise Joe is told it's
  ready on Documents.
- ~~**Agent wake-ups:**~~ **Done (branch `t3/tier3-wakeups`), behind a switch that ships OFF:**
  - These now wake the operating agent:
    - texts from a known contact
    - client portal messages
    - a lead's email reply (not while the first response is still being drafted)
    - portal selections and mood-board approvals
    - Square payments
    - bids Joe records
    - sub day logs
  - They only fire while the `agent.event_wakeups` policy is active and lists the kind (migration 0049 seeds
    it as a draft). Joe turns it on from /engine/decisions › Policies.
  - Each wake-up is one agent run, about 16¢.
  - Not wired: sub portal messages (no job to tie them to), and project client emails (part of A01 email
    intake below).
- **W02 hook failure:**
  - ~~A failure is only logged.~~ **Done (same branch):** the post-signature steps (billing, workflow,
    closeout, W08) run through `lib/esign-hooks.ts`. A failed step leaves a failed `esign` source event
    that the worker retries; the steps are idempotent.
  - Still open:
    - The workflow runbooks (`db/seed-workflow-runbooks.mjs`) aren't seeded live. They seed as inactive or
      proposed for Joe to approve in /engine, so run that at deploy.
    - Live jobs show stage W01 (5 projects) or W09 (2), with no backfill.
- **W03 and W11:**
  - W03: no allocation-review card is ever staged.
  - W11: the over-allowance `prepare_change_order` card has no handler. Joe's rule is that no tool creates
    change orders, so ask him how this card should end.
- **Email intake (A01):**
  - Hermes files email to-dos directly, with no message identity or obligation.
  - `catchUpMailbox` and `handleReply` (`lib/obligations/*`) have no callers.
  - Lead-thread sync and the detectors read one page of 150 threads, and the watermark moves anyway
    (`lib/lead-thread-sync.ts:~142,~227`, `lib/detectors.ts:~139`).
  - Title matching is left in `lib/actions/compliance.ts:~34` and `lib/actions/schedule.ts:~144`.
- ~~**Completion (A04):**~~ **Done (branch `t3/tier3-completion`):**
  - Joe's Mark done (Today card, /engine, lead and project pages) now goes through `completeWorkItem` via
    `completeByPerson` (`lib/runbook-engine.ts`): a manual receipt by the signed-in person, with the
    obligation closed and the runbook advanced in the same transaction.
  - Evidence from another job or lead is refused (`evidenceJobMismatch` in `lib/completion/complete.ts`).
- **Runbooks (A02):**
  - ~~The owner path marks a step done, then advances separately and swallows errors.~~ Done paths are
    fixed by the A04 change above. Other status changes (cancelled, blocked) still use the best-effort
    `maybeAdvanceRunbook`.
  - `needs_review` isn't shown anywhere, and there's no owner Repair button.
- **Leads (A11):** `lib/leads/{match,facts,routine,package}.ts` has no callers. Mind the `routine.followup`
  key issue above.
- **Sub paperwork (A12):** the review functions are now used for COIs. Extend them to W-9s and other documents.
- **Procurement (A13):**
  - The real PO send (`lib/send-ops.ts:~137`) skips commitments, cash and the construction gate.
  - Funding ignores hand-kept `collected_to_date` (`lib/funding/index.ts:~73-86`).
  - There's no app UI.
- **QuickBooks (A14), which must be done before the bookkeeper's Part B turns exports on:**
  - ~~Export never matches existing QBO records.~~ **Done (branch `t3/tier3-qbo`):** a customer with the
    same display name is reused (imported or asked of QuickBooks). An invoice or payment that looks like
    an unmatched QuickBooks record is held back as `possible_duplicate` until the match is confirmed or
    rejected on Settings › Accounting.
  - `reconcilePayout` has no caller; Square fees and net deposits are never reconciled.
  - Refunds and returns aren't mirrored.
  - ~~The `resolve_accounting_conflict` decision has no handler.~~ **Done:** Approve = QuickBooks is right
    (accepted, no longer flagged). Reject = SJC OS is right (stays flagged until fixed in QuickBooks).
  - ~~Deletions never surface.~~ **Done:** read through Change Data Capture (`listDeleted`). A posted record
    becomes a conflict card; an unmatched one leaves the review list.
- ~~**Square (A20):**~~ **Done (branch `t3/tier3-square`):**
  - Settings › Payments lists recent online payments with **Refund…**. It files a refund card, and approving
    the card refunds in Square (`executeRefundDecision` from `performApprovalEffects`).
  - Dispute events: open → disputed, plus a Telegram alert with the reason and answer-by date. Won → stands.
    Lost or accepted → a `return` on the invoice, once.
  - The reconcile sweep re-reads completed payments from the last 90 days for late refunds (made in the
    Dashboard, or with a webhook that never arrived) and bank returns. A refund made outside SJC OS alerts Joe.
  - The worker retries failed Square events (`lib/worker/square-processor.ts`).
  - ACH availability is now card processing on a US/USD location, not AUTOMATIC_TRANSFERS (payouts).
- **Closeout and marketing (A17):** the `lib/closeout/marketing.ts` and `revisions.ts` functions have no
  callers.
- ~~**Designer (A21):**~~ **Done (branch `t3/tier3-designer`):**
  - "Estimate from plan" now reads a pinned design version. It reuses the newest version when that version
    is the live drawing; otherwise it snapshots a new one first.
  - The lines' sections cite it (`· Kitchen v3 · New`), and the panel says which version was used.
  - A sent or signed estimate is refused up front (sent-estimate lock).
- ~~**Measurement (A18):**~~ **Done (branch `t3/tier3-measure`):**
  - Every outbound send is now a measurement case. A trigger on `action_intents` (migration 0051) opens the
    case with the mode taken from what authorised the send, and closes it as success, failure or corrected.
    `openCase`/`closeCase` stay available for non-send work.
  - The Cost book markup now goes through the markup decision. Staff → a card Joe approves; Joe → applied
    at once.
  - Fixed: `applyMarkupDecision` never worked, because it didn't present the card's content hash.
    Approving now writes a new pricing setup version plus the setting.
- **Owner hours (A19):**
  - `verifiedHoursForCloseout` and `setOwnerLaborRate` are unused.
  - The phone side was never built; `sjcos-mobile` hasn't changed since 08-29.

## Tier 4: agent safety and operations

- **Joe's Ask-window Claude** (the operator profile, used for every one of his runs) gets neither the A08a
  limits nor the A24 operating instructions. It has the full environment, the live repo and no timeout
  (`scripts/run-claude-agent.mjs` `buildPrompt` `~175-200`, `DEV_CLAUDE_TIMEOUT_MS` unset). Discuss with
  Joe before limiting his own tool.
- **Hermes picked by a staff member runs as Joe**, with no person attached and no revocation check
  (`lib/actions/ai-chat.ts:~152-183`).
- **No database role isolation or dollar cap:**
  - `deploy/db-roles.sql` was never applied, and `DATABASE_URL_AGENT` is unused.
  - The worker identity lib (`lib/authority/worker-identity.ts`) has no callers.
  - There's no dollar cap on worker runs (`scripts/run-business-agent.mjs:~66`).
- **Owner grants aren't tied to the content** of the send (`lib/owner-grant-types.ts:~84-113`).
- **Direct sends skip lanes, opt-outs and unknown-outcome handling:**
  - `lib/bid-follow-ups.ts:~199`
  - `lib/newsletter-drip.ts:~243`
  - `lib/doc-drafts.ts:~871`
  - `lib/portal-publish.ts:~98`
  - `lib/lead-first-response.ts:~757`
- **Monitoring:**
  - There's no off-server uptime check, so a dead server alerts no one.
  - The monitor's only fallback when Telegram fails is a local log.
  - `docs/automation-reliability/monitoring.md` is referenced but missing.
- **MCP:** the server has no `instructions`, and panel runs don't record which instruction versions they loaded.
- **Evals** ran once on `claude-opus-5`. Re-run them on the live models (Opus 5.5, Haiku 5.5) and add
  V28 (message style) and V46 (loading parity).

## When you finish a slice

- Update `docs/automation-reliability/STATUS.md` honestly. A task is "Implemented" only when its Accept
  criteria are met and wired.
- Tell Joe in plain words what changed and what's still open.
- Keep the memory note `plan-audit-2026-10-30` current.
