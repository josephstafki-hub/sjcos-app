# Shared context for the field-conversation plans (2026-11-02)

Read this whole file before drafting or judging any plan in `docs/plans/`.

## What Joe asked for

Joe (owner, SJ Carpentry LLC — residential remodeling, Twin Cities MN) said:

> There are a few to-dos in the SJC OS app that are development tasks, like
> subcontractor agreements, discovery call checklists that live in the calls tab
> and show up live during a call with AI prompts, in-home consultation scripts to
> guide the person who does them to get all needed measurements and details. AI
> transcriptions would be helpful there. This would be a page that can be pulled
> up on a tablet or phone. Create detailed plans for all.

The bar: a panel of judges scores each plan on **design** and **completeness**;
plans are revised until every judge gives 10/10.

## The four SJC OS to-dos behind this (verbatim from the work queue)

### A. `7a003430` — Create and start using subcontractor agreements (high)
> Create a clear subcontractor agreement template and start using it on every
> subcontracted job. It must clearly define the scope of work, require any scope
> changes to be discussed with Joe before proceeding, and require every upsell to
> be clearly identified and communicated to the client as an upsell.

### B. `1c52fa69` — SPEC: Discovery-call question checklist + live AI nudges
Written from a voice interview with Joe, 2026-08-14.
- Part 1 checklist. Joe's core list: budget (if they have one); description of the
  work; timeline; location; contact info. Joe-approved additions: decision makers
  (spouse/partner involved?); how they found us (which marketing works); are they
  getting other bids; how long in the house / plan to stay. **Coverage checklist,
  not a rigid script; no fixed order.**
- Part 2 live nudges: AI follows the live call against the checklist; if Joe moves
  past / is wrapping up without covering an item, it **texts Joe's phone** a quick
  reminder ("remember to ask X") while he can still act. **Nudge only on a genuine
  skip — no running commentary.** After the call: short summary of covered vs
  missed so Joe can follow up by email.
- Out of scope (Joe decided): no report-card scoring as the main mechanism; no
  scoring of how well Joe handled the call — strictly checklist coverage.
- Gating: the live half depends on real-time transcription (to-do C). Build the
  checklist half independently.
- **New in Joe's request today:** the checklist lives in the **Calls tab** and
  shows **live during the call** with AI prompts (on screen, in addition to / as
  an alternative to the text nudge).

### C. `e0897841` — Hook SJC OS into phone calls and text messages for full AI visibility
> Figure out a way for SJC OS to connect to any phone call and any text message so
> AI can hear or see all of Joe's client communications at any time, and interact
> with them. Goal: AI has constant visibility into every client conversation,
> which also feeds the discovery call scoring and keeps client records current
> without manual entry. Note: will need to check consent/recording requirements.

### D. `6d63abb1` — In-home consultation system: questions + measurement forms by project type
> The in-home visit happens AFTER pre-con and after the client agrees to and signs
> the rough estimate. That visit is for detailed measurements. Needs: the
> questions Joe should ask during the visit; measurement forms so nothing gets
> missed; cover as many project types as possible (bath, kitchen, addition,
> basement, deck, whole home); some way to track/confirm the consultation was
> completed properly.
- **New in Joe's request today:** "scripts to guide the person who does them" (so
  it may be Joe *or* a staff member), AI transcription during the visit, a page
  pulled up on a **tablet or phone**.

## What already exists (verify by reading the code — don't trust this blindly)

- **Phones/texts on Telnyx only** (Twilio banned the account; never propose
  Twilio). Read `docs/comms.md` in full. Inbound calls to the business number are
  answered by the OS, recorded dual-channel, forwarded to Joe's cell; click-to-call
  rings Joe's cell first then bridges. Recording → Telnyx post-call transcription
  → AI call notes (`lib/call-notes.ts`) → Open Brain + work items + Telegram push.
  Code: `lib/voice.ts`, `lib/comms/voice-flow.ts` (planner keyed on
  `client_state`; "an answering layer could be inserted later by changing plans"),
  `app/api/voice/webhook/route.ts`, `lib/sms.ts`, `lib/telnyx.ts`,
  `lib/comms/*`, `components/calls/CallsClient.tsx`, `app/(os)/calls/page.tsx`.
  **Nothing is real-time today**: transcripts arrive after the call ends.
- Calls made/received directly on Joe's personal cell (not the business number)
  are invisible to the OS. Joe texts clients from his personal phone
  (memory: "SMS from own phone"). 10DLC campaign approval has been a struggle
  (to-do `2a6035f9` "Fix Telnyx 10DLC opt-in wording and resubmit") — outbound
  SMS from the business number may not be reliable yet. Owner push to Joe goes
  through **Telegram** (`lib/notify-owner.ts`, quiet hours, hourly cap).
- Local speech-to-text: `lib/transcribe.ts` (whisper.cpp base.en on CPU, used for
  voice daily logs), `lib/use-dictation.ts`, `lib/voice.ts`, `lib/tts.ts`.
- Lead intake: `lib/lead-intake-questions.ts` (5 canonical questions: Scope,
  Timeline, Budget, Address, Other bids?), `lib/leads/qualification.ts`
  (`FACT_KEYS`, `recordFact`, `qualificationChecklist`), `lib/leads/*`.
  Stage rules: `docs/stage-gates.md`, `stage_rules` table. Lead first response:
  `docs/lead-first-response.md`.
- Subs: `app/(os)/subs`, `components/subs/*`, `lib/subs.ts`, `lib/sub-docs/`,
  `lib/sub-doc-types.ts` (doc types w9 / coi / agreement / other — an "agreement"
  upload slot exists, no template), `lib/sub-portal.ts` + `app/sub-portal`,
  `lib/sub-invites.ts`, bidding (`lib/bidding.ts`, `award_bid`), purchase orders,
  `lib/compliance.ts`, `lib/insurance.ts`.
- Documents: AI-fillable doc templates `lib/doc-templates/*` (registry, blocks,
  contract.ts, change-order.ts, lien-release.ts …), `docs/doc-templates-plan.md`;
  e-signature `lib/esign*.ts`, `components/esign/*`, in-person iPad signing
  `app/sign/[id]`.
- Field/estimating: MCP `record_site_findings`, `measurement_summary`,
  `get_field_evidence`, `prepare_estimate_inputs`, `estimate_readiness`
  (`mcp/estimating-tools.mjs`, `mcp/measure-tools.mjs`, `mcp/field-tools.mjs`);
  floor designer `lib/plan-*.ts`, `lib/plan-measures.ts`, `docs/floor-plan-designer-plan.md`.
  Note `lib/measure/*` may be about something else — check before reusing.
- Rules in `AGENTS.md`/`CLAUDE.md` (read them): owner grants for every
  client-facing send; db-roles manifest for any new table or new agent write;
  "Joe's words, not invented terms"; estimates/change-order placement rules;
  scheduling/`due_at` rule. Design tokens: `docs/design-tokens.md`.
- Mobile: Expo app at `/home/joe/sjcos-mobile` (TestFlight pending) — consider
  whether the tablet/phone page is a responsive web page, a PWA, or that app.
- **This is not the Next.js you know.** If you specify routes, server actions,
  `after()`, etc., check `/home/joe/sjcos-app/node_modules/next/dist/docs/`
  (this worktree has no node_modules).

## What every plan must contain (judges score against this)

1. **Problem & outcome** in Joe's words; who uses it, where (truck, client's
   kitchen, on a call), on what device.
2. **Current state** — what exists with file paths, and the exact gap.
3. **User flows** step by step, including failure / offline / no-signal paths.
4. **Screens** — layout for each screen at phone, tablet and desktop widths
   (ASCII wireframes welcome), states (empty, loading, live, error, done), tap
   targets, one-handed use, glare/dirty-hands field realism, accessibility.
5. **Content** — the actual checklists / scripts / form fields / clauses, written
   out in full, not "TBD" or "e.g.".
6. **Data model** — tables/columns/migrations, db-roles manifest impact, how it
   links to leads/projects/subs/files/knowledge/work items.
7. **AI behaviour** — prompts, models (which runtime: Claude / Hermes / local
   Qwen / whisper), latency budgets, false-positive control, what AI may and may
   not do, owner-grant points.
8. **Integrations** — Telnyx, MCP tools to add/change (names + inputs), Telegram,
   esign, doc templates, Open Brain.
9. **Legal / consent / privacy** where relevant (Minnesota law; recording consent;
   subcontractor law: lien waivers, insurance, independent-contractor status,
   MN Stat. 514 notices) — flag what needs Joe's attorney.
10. **Phased build** — small shippable phases, each with acceptance criteria and
    tests (`npm test`, node test runner); what ships first with zero dependencies.
11. **Risks, open questions for Joe** (few, sharp), and explicit **out of scope**.
12. Cross-plan consistency: the discovery-call plan and the in-home consult plan
    share one "checklist coverage" idea (transcript segments + checklist items →
    covered / missing, with evidence quotes). The **discovery-call plan owns the
    detailed spec of that shared engine**; the consult plan reuses it by name and
    only adds what is consult-specific. The sub-agreement plan should connect to
    the consult plan where scope from the visit feeds sub scopes.
