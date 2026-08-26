# SJC OS + Open Brain / Open Engine / Open Skills Implementation Plan

> **✅ BUILT — this plan was executed (verified 2026-08-25).** All three layers
> live inside SJC OS Postgres as recommended: **Open Brain** = `knowledge_items`
> (+ `search_knowledge` / `capture_knowledge`), **Open Engine** = `work_items`,
> `status_ledgers`, `agent_runs` / `agent_receipts` and the `/engine` +
> `/today` surfaces, **Open Skills** = `skills` / `skill_versions` /
> `runbooks` / `runbook_steps` with the owner approval flow. The recommendation
> in §1 — *don't* build a separate generic Open Brain — is what happened.
>
> Since built, it has grown: `agent_memories` (the learning layer),
> `lib/runbook-engine.ts` (a real stepper), owner grants, and the
> Claude↔Hermes orchestration ladder. **`db/schema.sql`, `mcp/README.md`, and
> `docs/open-skills-authoring.md` are current; this file is the design record.**
> The `/home/joe/SJC OS Temp` paths referenced below are **legacy/import-only**
> now (see `AGENTS.md`).

Prepared for Joseph / SJ Carpentry  
Date: 2026-07-01  
Primary server paths reviewed:

- Temporary SJC OS workspace: `/home/joe/SJC OS Temp`
- Temporary CRM tracker: `/home/joe/SJC OS Temp/data/leads.csv`
- Temporary stage-gate rules: `/home/joe/SJC OS Temp/stage_gates.md`
- Official SJC OS app: `/home/joe/sjcos-app`
- Official SJC OS master plan: `/home/joe/sjcos-app/docs/sjc-os-plan.md`
- Official SJC OS database schema: `/home/joe/sjcos-app/db/schema.sql`
- Existing official SJC OS MCP server: `/home/joe/sjcos-app/mcp/sjcos-mcp.mjs`

---

## 1. Plain-English Recommendation

**Do not build a separate generic Open Brain beside SJC OS as the main business brain.**

Instead, make the official SJC OS database the business brain, then add Open Brain / Open Engine / Open Skills patterns inside it:

1. **Open Brain layer:** a searchable memory / knowledge layer inside the SJC OS Postgres database.
2. **Open Engine layer:** a task/agent coordination loop inside SJC OS, using SJC OS tasks/statuses rather than Linear.
3. **Open Skills layer:** reusable operating procedures/runbooks for repeated SJ Carpentry workflows, so agents know *how* to do the work to Joe's standards.
4. **MCP/API layer:** one shared access point so Hermes, Claude Code, Claude Desktop, Codex, and future AI tools can read the same business facts, load the right skills, and write approved updates.

The temporary CSV system should become a **migration/import source**, not the long-term source of truth.

The end state should be:

> **SJC OS is the be-all/end-all operating system. Open Brain becomes the memory/search layer inside SJC OS. Open Engine becomes the agent/work queue layer inside SJC OS. Open Skills becomes the reusable procedure/runbook layer inside SJC OS.**

---

## 2. What Nate B. Jones’ Open Brain / Open Engine / Open Skills Means Here

### Open Brain

Nate B. Jones’ Open Brain concept is basically:

- one durable database
- vector search / semantic recall
- structured metadata
- capture tools
- MCP access so multiple AI tools share the same memory
- no scattered SaaS/Zapier chain

The public OB1 repo describes it as:

> “The infrastructure layer for your thinking. One database, one AI gateway, one chat channel. Any AI you use can plug in.”

The default OB1 implementation uses:

- `thoughts` table
- embeddings / vector search
- metadata JSON
- MCP tools like `search_thoughts`, `list_thoughts`, `capture_thought`, `fetch`
- optional agent-memory sidecar tables for provenance, review status, visibility, source references, artifacts, and recall traces

### Open Engine

Open Engine is a work/agent coordination pattern. Its public guide describes it as:

- a shared queue
- private setup context
- status ledger
- standing updates
- repeatable runner
- resumable blockers
- human-thread holds
- delegated follow-up
- receipts / proof of work
- recurring agent automation

The guide uses Linear as the v1 queue, but SJ Carpentry does **not** need Linear if SJC OS already has projects, tasks, notifications, schedules, inbox, and activity logs.

For SJ Carpentry, SJC OS should replace Linear as the work queue.

### Open Skills

Nate B. Jones' Open Skills concept is the reusable procedure layer for agents. The public Open Skills overview describes a skill as:

> “a compact operating procedure your agent loads on demand: when to use a method, which tools it calls, what standards matter, and what proof it owes you before it says done.”

The important idea is that useful agent work should not disappear after one chat. If an agent learns the right way to handle a repeated workflow, that procedure should become reusable.

For SJ Carpentry, Open Skills should capture things like:

- how to review open jobs one at a time with Joe
- how to draft short/plain-spoken client follow-ups
- how to triage leads under/over the $20k floor
- how to handle pre-construction deposit/site-visit stage gates
- how to file invoices vs receipts vs rebates
- how to prepare a project meeting brief
- how to import/review temp CRM rows safely
- how to run a recurring daily operations review

Open Skills is different from Open Brain and Open Engine:

- **Open Brain** stores what the business knows.
- **Open Engine** tracks what needs to happen, who owns it, and what happened.
- **Open Skills** stores the repeatable way to do the work correctly.

Open Skills also includes **runbooks**: chains of smaller skills. A runbook is the production line for a full workflow, with handoffs and human approval points.

---

## 3. Current State Observed

### Temporary SJC OS system

The temporary system is file-based:

- `/home/joe/SJC OS Temp/data/leads.csv`
- 56 rows
- columns include:
  - `record_id`
  - `created_at`
  - `updated_at`
  - `name`
  - `company`
  - `phone`
  - `email`
  - `source`
  - `project_type`
  - `project_address`
  - `city`
  - `state`
  - `budget_range`
  - `timeline`
  - `stage`
  - `triage`
  - `priority`
  - `red_flags`
  - `qualification_notes`
  - `scope_summary`
  - `last_contact_at`
  - `next_action`
  - `next_action_due`
  - `draft_response`
  - `owner`
  - `precon_deposit_status`
  - `precon_deposit_amount`
  - `contract_status`
  - `retainer_status`
  - `current_milestone`
  - `houzz_project_id`
  - `houzz_project_url`
  - `quickbooks_customer_id`
  - `status_notes`

Temporary stages include:

- `active_construction`
- `precon_active`
- `waiting_on_sub`
- `construction_scheduled`
- `final_invoice_sent`
- `rough_estimate_sent`
- `follow_up_needed`
- `closed_out`
- `lost`
- `pass`
- `archived`

The temporary stage-gate file is useful and should be migrated into official SJC OS as machine-readable rules or at least a reference table.

### Official SJC OS app

Official app path:

```text
/home/joe/sjcos-app
```

Stack observed:

- Next.js 16
- TypeScript
- PostgreSQL via `pg`
- MCP SDK already installed
- Existing MCP server at `mcp/sjcos-mcp.mjs`
- Existing DB helper at `lib/db.ts`
- Current schema at `db/schema.sql`

The official SJC OS plan already says:

- SJC OS should be the single platform replacing CRM, Houzz Pro, QuickBooks, separate email tools, etc.
- “Single database — all leads, projects, financials, documents, communications in one place”
- REST API with MCP server so Claude has direct structured access
- Claude is the AI layer
- AI should identify next steps, complete what it can, present for approval, and wait on human steps

That is already very close to Open Brain / Open Engine philosophy.

### Official DB currently exists but appears empty

I queried counts from the official SJC OS database through its `.env.local` connection without exposing secrets. Current counts observed:

- `leads`: 0
- `projects`: 0
- `subs`: 0
- `threads`: 0
- `files`: 0
- `schedule_blocks`: 0
- `notifications`: 0
- `invoices`: 0
- `daily_logs`: 0

So the official database is ready to become the source of truth, but the temporary CSV still holds the live operational data right now.

---

## 4. Architecture Decision

### Best architecture

Use the official SJC OS Postgres database as the root database.

Add these new layers:

1. `knowledge_items` or `thoughts`
   - generalized Open Brain memory/capture/search table
   - stores durable context, project notes, decisions, vendor knowledge, client preferences, SOPs, lessons learned

2. vector embeddings
   - enable `pgvector` if available
   - create embedding column for semantic search
   - keep fallback full-text search if embeddings are temporarily unavailable

3. `agent_memories`
   - sidecar table for memories proposed/written by AI agents
   - stores provenance, confidence, review state, source references, stale dates, and whether it can be used as instruction

4. `work_items`
   - SJC OS version of the Open Engine queue
   - can be linked to lead, project, thread, file, invoice, compliance item, or schedule block

5. `agent_runs`
   - records each automated or assisted AI run
   - who/what ran it, input, output, status, receipts, linked work item

6. `status_ledgers`
   - one current status record per agent/runtime or per work item
   - equivalent to Open Engine’s status comment, but stored in SJC OS

7. `agent_receipts`
   - proof that something happened
   - email sent ID, calendar event ID, file path, git commit, API response, DB row ID, etc.

8. `skills`
   - reusable operating procedures for repeated agent work
   - stores trigger conditions, required context, allowed tools, standards, approval rules, and verification requirements

9. `skill_versions`
   - version history for each skill so procedures can improve without losing auditability

10. `runbooks`
   - ordered chains of skills for bigger workflows like daily operations review, project meeting prep, or lead intake/import

11. expanded MCP tools
   - read tools for all AI clients
   - gated write tools for approved updates
   - skill-loading tools so agents can discover the correct procedure before acting
   - strict business rules for destructive/client-facing actions

### Why not separate Supabase OB1?

A separate Supabase Open Brain would work technically, but it would create a second database that competes with SJC OS. That is against the desired business direction.

Use the OB1 repo as a reference pattern, not as a separate production system.

---

## 5. Proposed Data Model Additions

These are conceptual table names. Claude can adapt names to existing conventions.

### 5.1 Knowledge / Open Brain tables

```sql
CREATE TABLE knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  source text NOT NULL DEFAULT 'manual',
  source_uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
  file_id text REFERENCES files(id) ON DELETE SET NULL,
  content_fingerprint text,
  created_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Recommended `kind` values:

- `client_note`
- `vendor_note`
- `project_decision`
- `business_rule`
- `sop`
- `lesson`
- `estimate_assumption`
- `selection_preference`
- `followup_context`
- `file_summary`
- `meeting_summary`
- `daily_log_summary`
- `admin_note`

Add later if pgvector is available:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS embedding vector(1536);
```

Fallback indexes:

```sql
CREATE INDEX idx_knowledge_items_metadata ON knowledge_items USING gin(metadata);
CREATE INDEX idx_knowledge_items_project ON knowledge_items(project_id, created_at DESC);
CREATE INDEX idx_knowledge_items_lead ON knowledge_items(lead_id, created_at DESC);
CREATE INDEX idx_knowledge_items_search ON knowledge_items USING gin(to_tsvector('english', content));
```

### 5.2 Agent memory sidecar

Use Nate’s OB1 `agent_memories` idea, adapted to SJC OS.

Core fields:

- `summary`
- `content`
- `memory_type`
- `provenance_status`
- `confidence`
- `review_status`
- `can_use_as_instruction`
- `can_use_as_evidence`
- `requires_user_confirmation`
- `stale_after`
- `source refs`
- `artifact refs`
- `runtime_name`
- `provider`
- `model`

Important rule:

> AI-created memories should default to evidence-only/pending unless Joe confirms them or they come from trusted imported business records.

This prevents a mistaken AI note from becoming a standing instruction.

### 5.3 Open Engine queue tables

```sql
CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued',
  priority text NOT NULL DEFAULT 'normal',
  assignee_kind text NOT NULL DEFAULT 'human',
  assignee_key text,
  due_at timestamptz,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
  source_kind text NOT NULL DEFAULT 'manual',
  source_id text,
  expected_skill_slug text,
  expected_runbook_slug text,
  requires_approval boolean NOT NULL DEFAULT true,
  approval_status text NOT NULL DEFAULT 'not_requested',
  blocked_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Recommended statuses:

- `queued`
- `in_progress`
- `waiting_on_human`
- `waiting_on_client`
- `waiting_on_sub`
- `blocked`
- `approval_needed`
- `done`
- `cancelled`

Recommended agent/runtime keys:

- `hermes-telegram`
- `claude-code-server`
- `claude-desktop-local`
- `codex-server`
- `human-joe`

### 5.4 Agent run and receipt tables

```sql
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  runtime_name text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'started',
  input_summary text NOT NULL DEFAULT '',
  output_summary text NOT NULL DEFAULT '',
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE agent_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  receipt_kind text NOT NULL,
  uri text,
  label text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Receipt examples:

- Gmail sent message ID
- Google Calendar event ID
- local file path
- SJC OS row ID
- git commit SHA
- generated draft ID
- client approval record
- invoice number

### 5.5 Open Skills tables

Open Skills should be stored in SJC OS so all agents can discover and use the same procedures.

```sql
CREATE TABLE skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'operations',
  trigger_phrases text[] NOT NULL DEFAULT '{}',
  when_to_use text NOT NULL DEFAULT '',
  required_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  approval_rules text NOT NULL DEFAULT '',
  verification_requirements text NOT NULL DEFAULT '',
  current_version_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version integer NOT NULL,
  body_markdown text NOT NULL,
  change_summary text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(skill_id, version)
);

CREATE TABLE runbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  body_markdown text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runbook_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id uuid NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  skill_id uuid REFERENCES skills(id) ON DELETE SET NULL,
  title text NOT NULL,
  expected_output text NOT NULL DEFAULT '',
  requires_human_approval boolean NOT NULL DEFAULT false,
  UNIQUE(runbook_id, step_order)
);
```

Recommended initial SJ Carpentry skills:

- `one-project-review`
- `client-followup-draft`
- `lead-triage-under-20k`
- `precon-deposit-site-visit-gate`
- `file-invoice-receipt-rebate`
- `project-meeting-brief`
- `temp-crm-import-review`
- `daily-operations-review`

Recommended initial runbooks:

- `daily-sjc-operations-review`
- `lead-intake-to-qualified-or-declined`
- `rough-estimate-to-site-visit`
- `active-project-followup-loop`
- `completed-project-closeout`

Important rules:

- Skills are procedures, not project status.
- Project facts belong in `knowledge_items`, `leads`, `projects`, `threads`, and files.
- Tasks belong in `work_items`.
- Skill changes should be versioned and reviewable.
- A work item should be able to reference the skill/runbook it expects the agent to use.

---

## 6. Migration Plan From Temporary SJC OS

### Phase A — Freeze the shape, not the work

Do not immediately stop using `/home/joe/SJC OS Temp/data/leads.csv` until import is tested.

Create a one-way importer first:

```text
Temp CSV → official SJC OS staging tables → reviewed import → official leads/projects/work_items/knowledge_items
```

### Phase B — Create staging table

Add a staging table to preserve every CSV column exactly:

```sql
CREATE TABLE sjc_temp_lead_imports (
  record_id text PRIMARY KEY,
  raw jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  import_status text NOT NULL DEFAULT 'staged',
  review_notes text NOT NULL DEFAULT ''
);
```

Why: this gives reversibility. Nothing from the temp tracker is lost.

### Phase C — Map temp rows to official records

Mapping rules:

- active sales/precon rows → `leads`
- signed/active construction/closeout rows → `projects`
- current `next_action` + `next_action_due` → `work_items`
- `status_notes`, `qualification_notes`, `scope_summary`, `draft_response` → `knowledge_items`
- `stage_gates.md` → either `stage_rules` table or `docs/stage-gates.md` inside official repo

### Phase D — Keep existing business stages intact

The official app currently has narrower lead/project stage checks than the temp tracker. Claude should either:

1. expand official SJC OS statuses to match the actual business lifecycle; or
2. map temp statuses into official statuses plus a detailed `stage_label` / `work_items.status`.

Recommendation: **expand official statuses**. The temp tracker’s stage gates are more operationally accurate.

### Phase E — Import only after test comparison

The importer should produce a dry-run report first:

- rows staged
- rows mapped to leads
- rows mapped to projects
- rows closed/archived
- rows needing human review
- duplicate names/emails
- missing emails/phones
- unrecognized stages

Only after approval should it write official records.

---

## 7. MCP / AI Tool Access Plan

The official SJC OS already has a read-only MCP server:

```text
/home/joe/sjcos-app/mcp/sjcos-mcp.mjs
```

Existing MCP tools include things like:

- business snapshot
- list leads
- get lead
- list projects
- get project
- list subs
- list compliance
- list signature requests

This should be expanded into an SJC Open Brain / Engine MCP server.

### Add Open Brain-style tools

- `search_knowledge(query, project_slug?, lead_slug?, limit?)`
- `capture_knowledge(content, kind, project_slug?, lead_slug?, source_uri?, metadata?)`
- `list_recent_knowledge(days?, kind?, project_slug?, lead_slug?)`
- `fetch_knowledge(id)`
- `suggest_related_context(project_slug|lead_slug|thread_id)`

### Add Open Engine-style tools

- `list_work_items(status?, assignee_key?, due_before?)`
- `get_work_item(id)`
- `create_work_item(...)`
- `update_work_item_status(id, status, note?)`
- `append_status_ledger(...)`
- `record_agent_run(...)`
- `record_receipt(...)`

### Add Open Skills-style tools

- `list_skills(category?, active?)`
- `get_skill(slug)`
- `search_skills(query, category?)`
- `suggest_skill_for_work_item(work_item_id)`
- `list_runbooks(active?)`
- `get_runbook(slug)`
- `create_skill_proposal(...)` for suggested new procedures, pending Joe review
- `record_skill_used(work_item_id, skill_slug, agent_run_id?)`

Rule: before an agent works a non-trivial `work_item`, it should load the expected skill/runbook if one is attached. If none is attached, it should search/suggest a likely skill before acting.

### Add safe business-write tools later

These should be gated and logged:

- `update_lead_stage`
- `update_project_status`
- `set_next_action`
- `log_client_contact`
- `draft_email`
- `mark_invoice_paid`
- `attach_file_to_project`

Client-facing sends should stay approval-gated:

- email send
- SMS send
- invoice send
- contract send
- change order send
- payment demand/lien package

---

## 8. How SJC OS Becomes the Open Engine

### Replace Linear with SJC OS

Nate’s Open Engine uses Linear as queue. SJC should use its own `work_items` table and Today page.

SJC OS should have an “Agent Engine” or “Operations Engine” page with:

1. **Queue**
   - work waiting for Hermes, Claude Code, Codex, Joe, subs, clients

2. **Today / due now**
   - what Joe needs to do today
   - what AI can do now
   - what is blocked

3. **Status ledger**
   - latest state from each AI runtime
   - last run
   - current work item
   - blocked reason
   - next run time

4. **Receipts**
   - what changed
   - links to email/calendar/files/DB rows/commits

5. **Human approvals**
   - drafts waiting for Joe
   - staged updates waiting for approval
   - risky actions explicitly blocked

6. **Skills / runbooks**
   - procedure attached to each task
   - skills agents can load before acting
   - runbook chains for larger workflows
   - proposed skill updates waiting for Joe/admin review

### Recurring runner

The runner should be conservative:

1. read pending work items
2. load the attached skill/runbook or suggest the right one
3. check due dates and blocked state
4. gather project/lead context
5. do safe read/draft/organize tasks according to the skill
6. request approval for client-facing or financial actions
7. record a receipt
8. update status ledger

This can run from Hermes cron, Claude Code loop, or a server-side cron route. For now, Hermes cron is probably easiest because it already works through Telegram.

---

## 9. Who Should Build It?

### Recommendation

**Claude Code on the server should build the SJC OS app/database changes.**

Reasons:

- The official SJC OS is already being built by Claude.
- It is a Next.js/TypeScript/Postgres app, which Claude Code can work on directly in `/home/joe/sjcos-app`.
- Claude Code can keep continuity with the existing SJC OS architecture, UI patterns, and phase docs.
- It can run tests/builds in the repo.
- It can update schema, TypeScript types, server actions, pages, and MCP server together.

### My role / Hermes role

Hermes should be used for:

- business workflow from Telegram
- confirming field updates one at a time
- checking Gmail/calendar/files
- creating approved drafts
- light migration review
- acceptance testing the new SJC OS behavior against real SJ Carpentry workflow
- creating cron/recurring follow-up loops once the SJC OS MCP tools exist

### Codex role

Codex should be used for:

- code review
- isolated refactors
- SQL migration review
- writing tests
- checking security/performance issues
- validating imports

### Local Claude / cowork desktop app role

Local Claude Desktop should be used as a daily business assistant once it has MCP access to SJC OS:

- ask “what’s due today?”
- prep for client/vendor meetings
- search project history
- retrieve design preferences and selection notes
- draft internal planning docs

---

## 10. Claude Code Build Prompt

Paste this into Claude Code on the server from `/home/joe/sjcos-app`.

```text
You are working in /home/joe/sjcos-app, the official SJ Carpentry operating system. Read these files first:

- docs/sjc-os-plan.md
- README.md
- db/schema.sql
- mcp/sjcos-mcp.mjs
- lib/db.ts
- lib/types.ts
- /home/joe/SJC OS Temp/stage_gates.md
- /home/joe/SJC OS Temp/data/leads.csv
- /home/joe/SJC OS Temp/sjcos_open_brain_engine_implementation_plan.md

Goal: adapt Nate B. Jones Open Brain / Open Engine patterns into SJC OS without creating a separate long-term database. SJC OS Postgres must remain the source of truth.

Build this in careful phases with tests/build checks after each phase:

Phase 1 — Schema foundation
1. Add idempotent Postgres schema for:
   - knowledge_items
   - agent_memories or SJC-adapted sidecar equivalent
   - agent_memory_source_refs
   - work_items
   - agent_runs
   - agent_receipts
   - status_ledgers if needed
   - skills
   - skill_versions
   - runbooks
   - runbook_steps
   - sjc_temp_lead_imports staging table
2. Add indexes for metadata, lead/project links, created_at, status/due dates, and full-text search.
3. If pgvector is available, add optional embedding column and vector indexes. If not available, keep full-text search fallback.
4. Update lib/types.ts with matching TypeScript types.

Phase 2 — Temp CSV staging importer
1. Create a dry-run import script that reads /home/joe/SJC OS Temp/data/leads.csv.
2. Stage every row into sjc_temp_lead_imports as raw JSON.
3. Produce a dry-run report showing:
   - total rows
   - active vs closed rows
   - proposed lead/project mapping
   - proposed work_items from next_action and next_action_due
   - unrecognized stages
   - rows needing human review
4. Do not write to official leads/projects/work_items until an approval flag is passed.

Phase 3 — Business-stage alignment
1. Compare /home/joe/SJC OS Temp/stage_gates.md with current official leads/projects status constraints.
2. Propose either expanded official statuses or a mapping table.
3. Prefer preserving the real business stages from the temp tracker where practical.
4. Do not break existing UI pages.

Phase 4 — MCP expansion
Extend mcp/sjcos-mcp.mjs with curated tools, no raw SQL:

Read tools:
- search_knowledge
- fetch_knowledge
- list_recent_knowledge
- list_work_items
- get_work_item
- list_skills
- get_skill
- search_skills
- list_runbooks
- get_runbook
- suggest_skill_for_work_item
- business_snapshot should include work item counts

Write tools, approval-safe and logged:
- capture_knowledge
- create_work_item
- update_work_item_status
- record_agent_run
- record_receipt
- create_skill_proposal
- record_skill_used

All writes must use parameterized SQL and insert receipts/status where appropriate. Destructive actions and client-facing sends are not in scope.

Phase 5 — SJC OS UI
Add or extend an app page for the Open Engine queue, probably under /automate or /today:
- queued work
- blocked work
- waiting on human approval
- status ledger
- recent agent receipts
- knowledge capture/search panel
- skills/runbooks library
- proposed skill updates needing review
- visible expected skill/runbook on each work item

Phase 6 — Tests and docs
1. Add docs explaining how Claude Code, Claude Desktop, Codex, and Hermes connect to the SJC OS MCP server.
2. Add a sample MCP config with placeholders, not secrets.
3. Add migration dry-run instructions.
4. Add Open Skills authoring instructions: how to create/update skills, when Joe approval is needed, and how to version changes.
5. Seed initial SJ Carpentry skills/runbooks from this plan.
6. Run npm lint/build if available.
7. Provide a summary of changed files, tests, and any manual steps needed.

Safety rules:
- Do not expose secrets from .env.local.
- Do not import temp CSV into official records without dry-run report and explicit approval.
- Do not send email/SMS/invoices/contracts.
- Do not delete temp files.
- Keep all changes in SJC OS as the source of truth, not a separate Supabase Open Brain.
```

---

## 11. How To Implement In Each AI Tool

### 11.1 Hermes / Telegram assistant

Hermes should eventually connect to the SJC OS MCP server or call SJC OS API endpoints.

Near-term:

- keep using `/home/joe/SJC OS Temp/data/leads.csv` until official import is approved
- continue one-project-at-a-time review
- save durable cross-session pointers only, not stale project status

After SJC OS MCP expansion:

- replace direct CSV edits with MCP write tools:
  - `list_work_items`
  - `update_work_item_status`
  - `capture_knowledge`
  - `record_receipt`
- create a daily/weekly Hermes cron that says:
  - “Read SJC OS work_items due today, group by waiting-on-Joe / waiting-on-client / waiting-on-sub, send Joe a concise Telegram review one item at a time.”

### 11.2 Claude Code on server

Use Claude Code as the primary builder.

Recommended workflow:

```bash
cd /home/joe/sjcos-app
claude
```

Then paste the build prompt from section 10.

Expected Claude Code responsibilities:

- schema changes
- import scripts
- MCP tools
- SJC OS UI pages
- TypeScript types
- tests/build
- docs

### 11.3 Claude Desktop / local cowork desktop app

Once the MCP server is ready, add SJC OS as an MCP server.

Example config shape, with placeholders only:

```json
{
  "mcpServers": {
    "sjcos": {
      "command": "node",
      "args": ["/home/joe/sjcos-app/mcp/sjcos-mcp.mjs"]
    }
  }
}
```

If local Claude Desktop runs on a different machine and cannot see `/home/joe/sjcos-app`, create a small remote MCP/HTTP bridge later. Do not expose Postgres directly to the LAN/public internet.

Use Claude Desktop for:

- “Prep me for Elaine meeting”
- “What do we know about Dan’s bath selections?”
- “Search all notes about Select Surfaces”
- “What open decisions are waiting on me?”

### 11.4 Codex

Codex should not be the primary long-running business operator. Use it as an engineering tool.

Good Codex prompts:

```text
Review the SJC OS Open Brain schema migration for data integrity, SQL safety, and reversible import design. Do not modify files; return concerns and suggested patches.
```

```text
Add tests for the CSV dry-run importer. Cover active project rows, closed rows, unrecognized stage, missing email/phone, and next_action_due mapping.
```

```text
Review mcp/sjcos-mcp.mjs for raw SQL injection risks and overbroad write tools.
```

### 11.5 Future ChatGPT / other AI tools

If used later, expose only safe read/search/fetch tools first:

- `search_knowledge`
- `fetch_knowledge`
- `business_snapshot`
- `list_work_items`

Do not expose write tools until auth, audit, and approval gates are proven.

---

## 12. Practical Build Order

### Week 1 / First build pass

1. Add schema tables, including `skills`, `skill_versions`, `runbooks`, and `runbook_steps`.
2. Add dry-run CSV importer.
3. Add full-text `knowledge_items` search.
4. Seed initial Open Skills/runbooks for SJ Carpentry's repeated workflows.
5. Extend MCP with read-only `search_knowledge`, `list_work_items`, `list_skills`, `get_skill`, `list_runbooks`, and `business_snapshot`.
6. Create docs and sample MCP config.

### Week 2 / Second build pass

1. Add gated MCP writes for `capture_knowledge` and `create_work_item`.
2. Add agent receipts.
3. Add status ledger.
4. Add `record_skill_used` and `create_skill_proposal` so agents can report which procedures they used and suggest improvements.
5. Add minimal UI panel under `/automate` or `/today`.
6. Run import dry-run and review with Joe.

### Week 3 / Migration pass

1. Import approved active temp CSV rows into official DB.
2. Preserve closed rows as archive/knowledge or staged raw records.
3. Switch Hermes one-project review from CSV to SJC OS MCP.
4. Start daily Telegram queue from official `work_items`.

### Later

1. Add vector embeddings.
2. Add email/thread ingestion into knowledge/search.
3. Add file summaries and OCR summaries.
4. Add project “meeting prep” views.
5. Add proactive agent runner.
6. Add cross-tool memory review UI.

---

## 13. Business Rules To Preserve

These are important in the design:

- Site visits happen after rough estimate acceptance and pre-construction deposit payment.
- Do not create/upload business files or folders in Google Drive unless explicitly asked; file documents on the server/local filesystem, media separately.
- Project invoices go under `Invoices`; receipts/payment confirmations/rebate receipts go under `Receipts`/`Rebates`; overhead/admin receipts go under `Overhead Receipts/<year>`.
- Houzz notification emails are not client emails.
- Samantha Rogers / Great Clips threads belong under the Great Clips commercial client account.
- Low-certainty imported records should be staged/reviewed, not treated as real projects automatically.
- Basic cellar stairs are usually under the $20k floor and should likely be declined.
- Client-facing drafts should be short, plain-spoken, practical, and casual.
- Client drafts should not mention subcontractor business names unless explicitly asked.
- Joseph wants open-job reviews one at a time, with CRM updated after each confirmed status.

These can live in:

- `knowledge_items` as confirmed business rules
- `agent_memories` as user-confirmed instruction memories
- `skills` as reusable operating procedures when the rule affects how work is performed
- `runbooks` when several procedures need to be chained together
- SJC OS docs
- Hermes memory, only as compact durable pointers

---

## 14. Acceptance Criteria

The implementation is successful when:

1. Official SJC OS, not the temp CSV, can answer:
   - “What projects need follow-up today?”
   - “What is waiting on subs?”
   - “What is waiting on Joe?”
   - “What do we know about this client/project/vendor?”

2. Hermes, Claude Code, Claude Desktop, and Codex can all access the same SJC OS facts through MCP or documented APIs.

3. AI writes are visible, logged, and reversible.

4. Client-facing actions still require Joe approval.

5. Temporary CSV data is staged and imported without losing raw source rows.

6. Every agent action can show a receipt.

7. The system can run the same one-project-at-a-time workflow Joseph likes, but from SJC OS instead of CSV.
8. Each recurring workflow has an attached skill or runbook so agents know the expected procedure, standards, approvals, and proof required.
9. Agents can suggest improvements to skills, but skill changes are versioned and reviewable instead of silently changing behavior.

---

## 15. Final Call

**Build with Claude Code on the server.**  
Use this plan as the handoff.  
Use Hermes for business workflow and acceptance testing.  
Use Codex for review/tests/security.  
Use local Claude Desktop as a read/search/business assistant after MCP is expanded.

Do not create a competing standalone Open Brain as the permanent source of truth. The official SJC OS database should absorb the useful Open Brain/Open Engine/Open Skills ideas and become the durable business brain.
