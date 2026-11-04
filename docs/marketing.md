# Marketing (/marketing)

Joe posts by hand. /marketing drafts the text, he edits it, presses **Copy**, downloads the photos the
client OK'd, and puts it up himself on Facebook, Instagram or Google. Then **Mark posted**.

**The posting agent is gone** (Joe, 2026-11-03: "not worth it"). It was built 2026-10-30 (PR #98) and never
made a post: approving a card made Claude put the post up in a server browser Joe had signed in to.
Removed with it: the Posting accounts panel and sign-in window, **Ask to post** and its `publish_marketing`
approval card, the "In post" photo picker, the dispatcher's `publication` kind and `publisher` provider,
`lib/publisher/*`, `scripts/run-publication.mjs`, `scripts/publisher-browser.mjs`,
`mcp/publisher-browser.mjs`, `app/api/marketing/*` and the `playwright-core` dependency. The `publication`
lane stays: newsletter releases use it.

Left in the database on purpose (additive migrations only): `marketing_draft_media`, and the
`audience`, `publication_decision_id`, `publication_intent_id`, `post_error` columns from migration 0056.
Nothing reads or writes them. The `marketing.post.*` rows in `app_settings` are unused too. The browser profile
with the sites' sign-in cookies is at `~/.local/share/sjcos-publisher` (outside the repo and the backups).
Joe can delete it.

## Photos

Each draft shows its job's photos, the ones the client OK'd sharing first. Only those have **Download**.
Joe ticks **OK to share** (owner only: it records the client's permission, a `publication_rights` row).
Unticking takes it back. **Add your own photos** saves them on the job. Joe's own count as OK to share.
Staff photos wait for him to tick them.

## How a draft is written (no made-up work)

Joe, 2026-11-03: the Louiselle drafts said "kitchen upgrades, bathroom remodeling, and room additions" on a
kitchen refresh, and printed the client's name and street address. The model had only the project name
(the client's name) and the address to go on.

Now (`lib/actions/marketing.ts` › `writeDraft`, `lib/marketing-copy.ts`, `lib/closeout/marketing.ts` ›
`loadJobFacts`):

- **The model sees only the job's record:** the title and lines of the formal estimate the client agreed to
  (approved, else the newest sent one; a draft estimate isn't work done), approved pre-con changes, approved
  change orders, scope notes, and the **city**. No prices, no client name, no street. Paperwork-only notes
  ("Houzz estimate ES-…", an address in the scope field) are dropped.
- **Rules in the prompt:** describe only listed work; no added rooms, features, materials, results, timelines
  or quotes; never the client's name or a street address; no prices or dates. With no record it may not name a
  room or a kind of work at all.
- **The answer is checked** (`draftProblems`): a room or area the record doesn't mention (bathroom, addition,
  basement, deck…), the client's or project's name, the house number or street, or a `$` price. A failing
  draft goes back once with what was wrong. If it fails again, or the model is down (the mock echo), a plain
  template from the same facts is saved instead (`fallbackDraft`).
- **The headline** is the work and the city ("Kitchen Refresh in Minneapolis"), never the client's name.
  A blog title from the model is kept only if it passes the same check.

Tests: `tests/marketing-grounding.test.mjs` (replays the Louiselle drafts), `tests/marketing-storage.test.mjs`,
`tests/marketing-photos-db.test.mjs`.
