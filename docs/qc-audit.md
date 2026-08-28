# SJC OS — Quality-Control Audit

*Run 2026-07-01 against the full app (55 routes, Phases 1–4 + 6 complete). Two passes. Live at os.sjcarpentryllc.com.*

> **📌 Historical snapshot (2026-07-01).** The one finding was fixed and
> deployed at the time (commit `e2596b4`). The app has grown a lot of new
> surface since — owner grants, the MCP/agent tool surface, the operator panel,
> newsletter/bidding sends, the portal claim model — **none of which this audit
> covered**. Treat it as a record of that pass, not as current assurance. The
> patterns it establishes are still the rules: every mutating server action
> guards with `requireRole("owner")`, and `proxy.ts` gates page navigation only,
> so route handlers must authenticate themselves.

## Summary

One real finding (missing owner-guards on early server actions) — **fixed, deployed, pushed** (commit `e2596b4`). Everything else audited came back clean. No injection, XSS, path traversal, ambiguous SQL, SSR-blocking AI, or unguarded serve routes.

---

## Finding (fixed) — missing owner role-guards on early Phase 7-A actions

Several CRUD server actions predate the Phase 8 auth layer and were never retrofitted with a role guard — inconsistent with every other mutating action. Because `proxy.ts` only gates *page navigation*, an authenticated non-owner (sub/client) could invoke them via a crafted server-action POST.

**Fix:** added `await requireRole("owner")` (from `lib/dal`, which redirects non-owners) to:

| File | Actions |
|---|---|
| `lib/actions/leads.ts` | `createLead`, `advanceLeadStage`, `setLeadStage` |
| `lib/actions/projects.ts` | `createProject`, `setProjectProgress` |
| `lib/actions/compliance.ts` | `resolveComplianceItem` |
| `lib/actions/notifications.ts` | `markAllNotificationsRead`, `markNotificationRead` |
| `lib/actions/settings.ts` | `setAiToggle`, `setNotifyToggle` (via shared `upsertToggle`) |

Owner flows are unaffected (owner passes the guard). `inbox.ts` looked suspect in an early scan but is fully guarded via its `withGmail()` wrapper.

---

## Pass 1 — baseline health & auth

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| pg-in-client-bundle gotcha | None — all client `lib/*` imports are `import type` |
| Non-async exports in `"use server"` files | None (`lib/uploads.ts` + `lib/documents.ts` use `import "server-only"`, not the directive — const exports are fine there) |
| All 20 authed routes | 200 (empty DB; `/` → 307 as expected) |
| Secrets | `.env.local` gitignored; no `.env*` tracked |
| Mobile API routes (`/api/mobile/*`) | All enforce `role==='owner'` |
| `/api/transcribe` | Gates owner/sub (401/403) |
| `/api/catalog/clip` | Token-gated (constant-time compare, fail-closed) |
| Dollars↔cents boundary | **Handled** — milestone billing divides `estimates.total` (cents) by 100 before writing `invoices.amount` (dollars) at `lib/actions/projects.ts:100` |

---

## Pass 2 — injection, XSS, traversal, correctness

| Class | Result |
|---|---|
| **SQL injection** | Clean — all queries parameterized. The only `${}`-in-SQL are column-list constants (`SIG_SELECT`/`SUB_SELECT`/`LEAD_SELECT`/`PROJECT_SELECT`/`SELECT`) or `schedule.ts weekBounds()`, which `Math.trunc`-coerces the `?w=` offset to an integer before interpolation (the page passes `Math.trunc(Number(w))||0`). |
| **Ambiguous-column in JOINs** (the old esign 500 class) | Clean — static analysis over every backtick SQL containing a JOIN found zero bare/unqualified shared columns; all `id`/`status`/`created_at`/`name`/`slug`/`project_id` etc. are table-qualified. |
| **XSS** | Clean — the single `dangerouslySetInnerHTML` (`InboxClient.tsx:921`) renders server-side `sanitize-html`-cleaned Gmail HTML. |
| **File-serve routes** — `/api/files/[id]`, `/api/portal/{selection-image,sign-doc,project-file}/[id]` | Clean — all auth-scoped (owner, or client via `linkSlug === file's slug`; 401/403), all use `path.join(UPLOAD_DIR, path.basename(storage_path))` (traversal-neutralized), paths sourced from the DB not the user. |
| **Detail pages** — `/{leads,projects,subs}/[slug]` | Clean — `notFound()` on missing record → graceful 404, not 500. |
| **AI SSR-blocking (perf)** | Clean — every AI call is behind a server action or a lazy `<AiStream load={}>` resolver (`getProjectWeeklyStatus`, `getSubSummary`, `getScheduleConflict`, warranty/compliance summaries); inbox drafts are on-demand via `draftReplyForThread` and `buildFromGmail` does **not** eager-draft. |
| **cron `/api/cron/reminders`** | Clean — fails closed (no `CRON_SECRET` → 401). |
| **AckButton icon-as-component gotcha** | Clean — the `icon={Star}` hits are `MenuItem` used *within* a client file (no server→client boundary). |

### Minor observation (not fixed, not prod-reachable)
The **mock** inbox fallback `getInboxData` → `buildReader` awaits `ai.draft` per showcase thread, which would block SSR under the real Ollama provider. Not reachable in production because Gmail is configured (uses `buildFromGmail`). Worth a lazy-draft refactor if the mock path is ever exercised with a live AI provider.

### Coverage gap
Detail routes could not be smoke-tested with live data — the DB is intentionally empty ("start fresh with real data"), and inserting test rows into the production DB was (correctly) blocked. Static JOIN analysis substitutes here, since the ambiguous-column class surfaces at query-parse time regardless of whether rows exist. For live detail-route coverage, run against a throwaway DB or with temporary, explicitly-approved test rows.
