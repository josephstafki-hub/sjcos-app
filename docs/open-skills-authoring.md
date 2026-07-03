# Open Skills — authoring, approval & versioning

Skills are compact operating procedures agents load on demand — *when* to use a
method, which tools it calls, what standards matter, and what proof it owes before
it says done. Runbooks chain skills for larger workflows. This is the reusable
"how we do the work" layer of SJC OS (distinct from `knowledge_items` = *what we
know* and `work_items` = *what must happen*).

Storage: `skills` + `skill_versions` (versioned, auditable) and `runbooks` +
`runbook_steps`. The live procedure text is in `skill_versions`;
`skills.current_version_id` points at the version the library renders.

## The approval rule

- **Joe-authored / seeded skills** (from the plan) are `approved` + `active` — the
  usable library.
- **Agent-proposed skills** (via the MCP `create_skill_proposal` tool) always land
  `review_status = 'proposed'`. They are **invisible to the active library** and to
  `list_skills` (unless `include_proposed`) until Joe approves them.
- Approve/reject happens in the app at **`/engine` → Skills & runbooks** (owner
  only). Approve flips the skill + its current version to `approved`; reject marks
  both `rejected` and deactivates the skill.

**Why:** a mistaken agent suggestion must never silently become a standing
procedure. Skill changes are reviewable, not automatic.

## Authoring a new skill

Give agents a stable kebab-case `slug`, a plain-English `title`/`description`, a
`when_to_use` sentence, and a markdown body that states the steps, the standards
(Joe's voice: short, plain-spoken), the approval gates, and the proof required.

Via MCP (agent):
```
create_skill_proposal(slug, title, body_markdown, description?, category?,
                      when_to_use?, change_summary?, proposed_by?)
```

By hand (SQL / seed) — see the idempotent seed block at the end of
`db/schema.sql` for the canonical pattern (upsert `skills` → create v1
`skill_versions` → point `current_version_id`). Seeded skills are `approved`.

## Versioning (improving a skill)

Never edit a `skill_versions` row in place — history stays auditable. To improve a
skill, insert the next `version` (n+1) for that `skill_id` with a
`change_summary`, then point `skills.current_version_id` at it. New versions from
an agent should be `status = 'proposed'` and reviewed before becoming current;
Joe-made edits can go straight to `approved`. (A version-review UI is a later
addition; today re-propose or edit via SQL/seed.)

## Runbooks

A runbook is an ordered chain of skills for a full workflow, with per-step
`requires_human_approval` gates. Steps carry both a `skill_id` (FK) and a
`skill_slug` (soft ref that survives skill deletion). Seed/patch them the same
idempotent way (see `db/schema.sql`). Agents run a runbook step-by-step, loading
each step's skill and pausing at approval gates.

## Seeded starting set

8 skills (`one-project-review`, `client-followup-draft`, `lead-triage-under-20k`,
`precon-deposit-site-visit-gate`, `file-invoice-receipt-rebate`,
`project-meeting-brief`, `temp-crm-import-review`, `daily-operations-review`) and
5 runbooks (`daily-sjc-operations-review`, `lead-intake-to-qualified-or-declined`,
`rough-estimate-to-site-visit`, `active-project-followup-loop`,
`completed-project-closeout`). All idempotent in `db/schema.sql`.
