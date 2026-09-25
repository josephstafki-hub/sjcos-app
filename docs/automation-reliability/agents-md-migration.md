# AGENTS.md migration — apply only with the enforcement deployed

The root `AGENTS.md` still states the pre-build rule: every client-, vendor-
or money-facing send needs an **owner grant**, and nothing is automatic. That
rule stays true on the live site until the automation build is deployed
(migrations 0001–0023 applied, `sjcos.service`, `sjcos-mcp.service`, the
dispatcher/worker units installed and the policies Joe activates). Do not
edit `AGENTS.md` before that — instructions alone are not access controls,
and agents reading a rule the software does not yet enforce would act on it.

## Text to replace, once deployed

Replace the paragraph beginning "Client-facing sends (emails, bid packages,
POs, invoices, documents for signature, newsletter release) are owner-approved."
with:

> **Sends and money movements consume an exact decision.** Every client-,
> vendor- or money-facing action (bid package / supplier pricing request /
> mood board / selection package release, proposal or change-order issuance,
> purchase, vendor or sub payment, refund, newsletter or social publication,
> schedule confirmation, company funding) is staged as a **decision**
> (`stage_decision` / the feature's own stage command) bound to the exact
> recipient, content revision and amount. Joe — or a team member holding
> that action type in Settings › Team › Authority, within project and dollar
> bounds — resolves it once, in the app or on Telegram; the app dispatches
> the action as a durable intent and reports the provider's real outcome.
> A transitional **owner grant** (`request_owner_permission` /
> `owner_grant_id`) still works for the legacy send tools and is bridged to
> a decision. Never route around either.
>
> **Routine factual communication is automatic only under an ACTIVE policy.**
> Missing-information follow-ups, sub document requests, weekly client
> summaries, the construction agreement + initial invoice after a client
> accepts the owner-approved formal estimate, the progress invoice after Joe
> confirms a milestone, the final invoice after written client sign-off and
> the post-project warranty/review/check-in messages run under the policy
> versions Joe activates (`policies` table, `/engine/decisions` kill
> switches). With no active policy the same work is **staged** for approval,
> never dropped and never sent.
>
> **Every event wakes the operating agent.** A verified signed pre-construction
> agreement starts scope breakdown, the site-visit plan, the design paths and
> the working formal estimate immediately — payment is not the gate. Use
> `get_project_workflow` before working any project event; record what you
> changed with `record_workflow_event`, `record_agent_run` and
> `record_receipt`; complete work with evidence
> (`complete_work_item_with_evidence`), never on your own narrative.

Also add to "Claude in the app": *a STAFF user's Ask window runs the
**business profile** only (sjcos tools scoped to their areas and approval
authority; no code, shell, web or repo access).*

## Order of operations on deploy day

1. `node db/migrate.mjs --status` then `node db/migrate.mjs` on the live
   database (additive; `lead_estimates.alternates` already present).
2. Staged build → restart `sjcos.service`, then `sjcos-mcp.service`.
3. Install the new timers (see `deploy/README.md` "Automation build") —
   dispatcher first, then worker, then the weekly/post-project ticks.
4. Activate policies one at a time on `/engine/decisions` after their
   fixtures pass; each activation is recorded with a version.
5. Only then apply the AGENTS.md text above and remove the "owner-grant only"
   wording; note the commit in STATUS.md.
