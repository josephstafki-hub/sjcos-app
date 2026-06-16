# SJC OS — Wire up dead clickables + multi-user auth

## ⏳ PROGRESS / RESUME POINT (2026-06-16)

- **Phase A — DONE** (commit `0cda829`): users table + 4 seeded demo accounts
  (pw `sjcos`), `lib/{password,session,dal}.ts`, `lib/actions/auth.ts`, `/login`,
  `proxy.ts`, sidebar logout + real user, Books link disabled. Verified e2e.
- **Phase B — PARTIAL** (commit `e7308a1`): portals requireRole + identity-scoped
  to logged-in user (content still curated); Settings Team&roles live from `users`;
  profile.phone persisted. **STILL TODO in B:** editable Profile form
  (`updateProfile` action + SettingsClient form — `lib/actions/settings.ts` already
  has the `upsertToggle` helper to mirror), owner add/disable user
  (`createUser`/`setUserActive`, mirror `createSub`), deeper per-row portal data.
- **Phase C — NOT STARTED:** leads-list filters (LeadsClient mirroring SubsClient),
  photos box → lightbox (`components/ui/PhotoGrid`), fix cmdk dead slugs
  (`reyes-bath`→`reyes`, `henderson-kitchen`→`henderson` in CommandBar.tsx).
  (Books link already done in A.)
- **Phase D — NOT STARTED:** action-button backends (New project/Block modals,
  AI Apply/Ignore, Call→tel/Email→mailto/Chat→/chat, doc Open/Summarize).

**Dev server:** `next dev --port 3017` (log `/tmp/sjcos-dev.log`). **Tunnel:**
https://welcome-cold-offerings-streaming.trycloudflare.com (cloudflared log
`/tmp/cf-tunnel.log`; quick-tunnel URLs die on restart — relaunch `~/bin/cloudflared
tunnel --no-autoupdate --url http://localhost:3017` and grab the new URL). **Demo
logins:** owner josephstafki@sjcarpentryllc.com / sub marco@trade.demo / client
henderson@client.demo — all pw `sjcos`.

## Context

Joe tested the app on the remote tunnel and found "the functionality doesn't really
seem to be there." Two root causes:

1. **The tunnel was serving a 3-day-old build** (`next start` frozen at Jun 13, pre-Phase 7-C).
   Already fixed this session: killed it, restarted as `next dev` on `:3017` so it hot-reloads.
   The lead/project/settings tabs and chat channel-switching all work now on fresh code —
   they only looked broken because of staleness.

2. **Genuinely inert interactivity** that needs building. Joe named: leads-list sorting,
   the photos box, chat tabs (already work), lead-page tabs (already work), and
   **"user account functionalities"** — which he clarified to **full multi-user auth**
   (login, roles, real portal logins, per-user sessions). Plus: "build the backend for
   any similar buttons."

**Out of scope (Joe's call):** `/site`, `/newsletter`, **and `/books`** stay placeholders — do not build these pages.

Goal: every clickable either navigates to a real page or performs a real action, and the
app gains a real auth system with role-gated access.

---

## Stack facts that shape this (Next 16 — verified against bundled docs)

- Middleware is **`proxy.ts`** at project root (NOT `middleware.ts`), Node runtime.
- Sessions: stateless JWT in an **httpOnly cookie** via **`jose`** (recommended in
  `node_modules/next/dist/docs/01-app/02-guides/authentication.md`).
- Auth check via a **DAL** (`lib/dal.ts`) with `verifySession()` wrapped in React `cache`.
- Server Actions for login/logout (existing project pattern in `lib/actions/*`).
- `zod` is already available; **add `jose`**. Password hashing via Node's built-in
  `crypto.scrypt` (no new dep).
- Reuse existing `lib/db` `query()`/`queryOne()`. Existing client-filter pattern to mirror:
  `components/subs/SubsClient.tsx`, `components/catalog/CatalogClient.tsx`. Existing
  create-modal pattern: `components/leads/NewLeadButton.tsx`, `components/subs/OnboardSubButton.tsx`.

---

## Phase A — Auth foundation

**DB (`db/schema.sql` + `db/seed.sql`):**
- `users` (id, email UNIQUE, password_hash, name, role `owner|sub|client`, initials,
  link_slug [maps a sub→subs.slug or client→projects.slug], active bool, created_at).
- Seed: owner **Joe** (josephstafki@sjcarpentryllc.com), 2 sub users (marco, tomas →
  link to their sub slug), 1 client user (→ a project slug). Dev passwords documented in
  README, hashes generated via a one-off node script (same apply pattern as existing seed).
- No sessions table needed (stateless JWT).

**New files:**
- `lib/password.ts` — `hashPassword`/`verifyPassword` via `crypto.scrypt` (+ random salt).
- `lib/session.ts` — `encrypt`/`decrypt` (jose, `SESSION_SECRET` from `.env.local`),
  `createSession(userId, role)`, `deleteSession()` using `next/headers` `cookies()`.
- `lib/dal.ts` — `verifySession()` (cache; redirect `/login` if absent),
  `getCurrentUser()` (DB lookup, cached), `requireRole(...roles)`.
- `lib/actions/auth.ts` — `"use server"` `login(state, formData)` (zod-validate, verify
  password, createSession, redirect by role), `logout()`.
- `app/login/page.tsx` + `components/auth/LoginForm.tsx` (client, `useActionState`) —
  styled to the forest-green/cream theme; shows seeded demo logins for testing.
- `proxy.ts` — optimistic redirect: no session + protected route → `/login`; logged-in
  hitting `/login` → role home. Matcher excludes `api`, `_next`, static assets.
- Add `SESSION_SECRET` to `.env.local` (gitignored; generated via `openssl rand -base64 32`).

**Shell:** `components/shell/Sidebar.tsx` footer shows current user (name/initials/role) +
a **Logout** button (form → `logout()`). `getCurrentUser()` read in the Shell/layout.

## Phase B — Roles & real portals

- `proxy.ts` + per-page `requireRole` so: **owner** → full app; **sub** → locked to
  `/sub-portal` (their jobs/paperwork); **client** → locked to `/client-portal` (their project).
- `/client-portal` + `/sub-portal` become **real, data-scoped** to the logged-in user
  (`getCurrentUser().link_slug` → that project/sub), replacing the standalone demo.
- Settings → **Team & roles** becomes live: reads `users`; owner can add/disable a user
  (`lib/actions/users.ts` `createUser`/`setUserActive`, mirrors `createSub`). Settings →
  Profile fields become editable (`updateProfile` server action, persists to `users` row).

## Phase C — In-page interactivity (the buttons Joe named)

- **Leads list filters:** new `components/leads/LeadsClient.tsx` mirroring `SubsClient` —
  All/Hot/Cooling/Declined + stage chips become real filter state over the lead rows.
  `app/leads/page.tsx` passes rows into it.
- **Photos box → lightbox:** new `components/ui/PhotoGrid.tsx` (client) — clickable
  thumbnails open a modal overlay (next/prev, esc-to-close). Use in lead detail sidebar
  (`app/leads/[slug]/page.tsx`) and project Files/photos.
- **Command bar dead slugs:** fix `components/cmdk/CommandBar.tsx`
  `/projects/reyes-bath`→`/projects/reyes`, `/projects/henderson-kitchen`→`/projects/henderson`.
- **`/books` dead link (no new page):** in `components/shell/Sidebar.tsx`, render the
  "Books · soon" item as a **non-clickable** disabled row (no `href`) so it stops 404-ing.
  The real Books page is deferred (out of scope, like site/newsletter).

## Phase D — Action-button backends ("similar buttons")

Wire the inert page-level buttons, by category:
- **Create modals** (mirror `NewLeadButton`): "New project" (`app/projects/page.tsx`),
  "Block" time (`app/schedule/page.tsx`) → `createProject` / `createScheduleBlock`
  server actions writing real rows.
- **AI actions:** Apply / Ignore suggestion, "Run triage again", "Auto-collect docs",
  "Auto-log from photos" → server actions calling `lib/ai.ts` (still mock) + persisting
  the result/dismissal. Apply writes; Ignore dismisses.
- **Contact actions:** Call → `tel:`, Email → `mailto:`, Chat → `/chat` (real links).
- **Doc actions:** files Open/Share/Summarize → Open (file href), Summarize via `ai`.
- Any remaining inert filter chips made into real client filter state.

---

## Verification

- `npx tsc --noEmit` clean + `npm run build` compiles (watch for the known
  `pg`-into-client-bundle leak — never import a value from a server-coupled lib into a
  `"use client"` file; use `import type` or inline constants).
- Apply DB changes via the existing node/pg seed-apply path (psql superuser needs sudo).
- Manual on the dev tunnel (`https://welcome-cold-offerings-streaming.trycloudflare.com`,
  hot-reloads): log in as owner → full app + logout works; log in as sub → bounced to
  sub portal; log in as client → client portal; leads filters narrow the list; photo
  thumbnails open the lightbox; `/books` renders; New project / Block modals write rows;
  command-bar project rows resolve (no 404).
- Each phase = its own git commit; verify mutations in rolled-back txns to keep the
  showcase seed pristine.

## Rollout note

This is large (4 phases). Recommend landing **A → B → C → D** as separate commits so
each is testable on the tunnel before the next. Auth (A/B) is the architectural core and
should land + be verified first.
