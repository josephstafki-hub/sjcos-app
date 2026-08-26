# SJC OS — Wire up dead clickables + multi-user auth

## ✅ COMPLETE — historical record

> **Phase 8 is done and the app went live on 2026-06-26.** The resume point
> below is kept as the build log. Current status lives in `README.md`; the
> deploy runbook is `deploy/README.md`. **Two carryover boxes at the bottom of
> this file were never ticked** — see the Deploy carryover checklist.

### Original progress / resume point (2026-06-16)

- **Phase A — DONE** (commit `0cda829`): users table + 4 seeded demo accounts
  (pw `sjcos`), `lib/{password,session,dal}.ts`, `lib/actions/auth.ts`, `/login`,
  `proxy.ts`, sidebar logout + real user, Books link disabled. Verified e2e.
- **Phase B — DONE** (commits `e7308a1`, `bbd4cab`): portals requireRole +
  identity-scoped to logged-in user (content still curated); Settings Team&roles
  live from `users`; profile.phone persisted. `bbd4cab` finished the two open
  items: editable Profile form (`updateProfile` in `lib/actions/settings.ts` —
  name/email → users row, company/phone → app_settings) + owner add/disable user
  (`lib/actions/users.ts` `createUser`/`setUserActive`; Settings → Team "Add user"
  modal + per-row Enable/Disable). Verified e2e (tsc/build/SQL/200). *Deeper
  per-row portal data still curated — deferred, not blocking.*
- **Phase C — DONE:** leads-list filters (`components/leads/LeadsClient.tsx` —
  client component mirroring SubsClient; temperature derived server-side in
  `lib/leads.ts` `temperatureOf` so chips All/Hot/Cooling/Declined filter without
  pulling the server-coupled lib into the client bundle; empty-state fallback);
  photos box → lightbox (`components/ui/PhotoGrid.tsx` — clickable thumbnails open
  an esc/←/→ overlay; used in lead-detail sidebar); cmdk dead slugs fixed
  (`reyes-bath`→`reyes`, `henderson-kitchen`→`henderson`). tsc/build clean (42 pages).
  (Books link already done in A.)
- **Phase D — DONE** (commits `37062af`, `944b5d0`): action-button backends.
  Create modals: `NewProjectButton`+`createProject` (pre-construction project),
  `BlockButton`+`createScheduleBlock` (date defaults to today → lands in the
  visible week; inline async action closes modal only after the write).
  AI Apply/Ignore: `ConflictBubble` client wrapper (Apply acknowledges /
  Ignore dismisses — no longer inert). Contact: lead/sub detail Call→`tel:`
  (digits stripped) + Email→`mailto:` (email/phone surfaced on LeadDetail/
  SubDetail + seeded; disabled span when unknown); Chat was already a `/chat`
  link. Doc: files preview Open→enlarge overlay, Summarize→`summarizeFile`
  action via `lib/ai` (focus "file") shown in an AiBubble. Also fixed stale
  project hrefs that 404'd (notifications seed + `lib/search.ts`:
  reyes-bath→reyes, henderson-kitchen→henderson, olson-porch→olson). Seed
  re-applied. tsc/build clean (42 pages); authed routes verified 200 +
  tel:/mailto: confirmed in rendered HTML.

**✅ Phase 8 (A–D) COMPLETE.** Every named dead clickable now navigates or
performs a real action; app has multi-user auth + role-gated portals. Remaining
project work is AI swap → email (both now done) then the Phase 8 *deploy*
(DNS+sudo, port). The old leads.csv import was dropped — leads imported fresh
post-launch.

> **Stale as of 2026-08-25:** the cloudflared quick tunnel is long dead and
> `:3017` is now **production** (`sjcos.service`), not a dev server — do **not**
> run `next dev` or `npm run build` against it while the service is up. For a
> side build set `SJC_DIST_DIR`. The demo sub/client logins
> (marco@trade.demo, henderson@client.demo, pw `sjcos`) were seed accounts;
> treat them as historical, not as live credentials.

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

## Deploy carryover checklist (the actual go-live) — ✅ SHIPPED 2026-06-26

> **Closed out 2026-08-25:** Gmail is fully working, `modify` included — the
> redirect-URI registration and the re-consent both happened. The only box left
> open is the last one (the automation CLI's auth mode), which is a nice-to-have,
> not a blocker.

Target: **https://os.sjcarpentryllc.com**. Full deploy runbook + config artifacts live
in `deploy/` (`README.md`, `nginx-sjcos.conf`, `sjcos.service`).

Decisions made (2026-06-24): subdomain `os.sjcarpentryllc.com`; permanent port `:3017`;
go-live path = **nginx + A record + certbot** (Cloudflare *named tunnel* was the first
choice but the zone lives in Joe's web developer's Cloudflare account — registrar is
Squarespace, NS delegated to Cloudflare — so a one-time A record was the smaller ask and
keeps us independent afterward).

- [x] Pick a permanent free port — `:3017` (loopback-only; was free, confirmed).
- [x] Next prod server as a systemd **user** service `sjcos.service` (mirrors `ollama.service`,
      reboot-persistent via existing linger; binds `127.0.0.1:3017`). Chose systemd over PM2
      to avoid the sudo `pm2 startup` step. `deploy/sjcos.service`.
- [x] Set stable `GMAIL_REDIRECT_URI=https://os.sjcarpentryllc.com/api/inbox/oauth/callback`
      in `.env.local`.
- [x] nginx vhost authored (`deploy/nginx-sjcos.conf`; proxy → 127.0.0.1:3017, 30M body cap,
      120s AI timeouts). Pre-TLS port-80 form; `certbot --nginx` will inject the 443 block.
- [x] **DNS (developer, one-time):** A record `os` → `73.94.192.119`, DNS-only. Verified
      `dig +short A os.sjcarpentryllc.com @1.1.1.1` == `73.94.192.119` (2026-06-26).
- [x] **GO-LIVE (2026-06-26):** installed vhost (`/etc/nginx/sites-enabled/sjcos`),
      `certbot --nginx -d os.sjcarpentryllc.com --redirect` issued the LE cert (expires
      2026-09-24, auto-renew on). **https://os.sjcarpentryllc.com is LIVE** — public HTTPS
      /login 200, HTTP→HTTPS 301, root→/login 307, TLS verify ok. sjcos.service +
      ollama.service running (reboot-persistent via linger).
- [x] Register the prod redirect URI in Google Cloud Console → Credentials → the OAuth client.
- [x] **Gmail `modify` re-consent (deferred from Phase 7.x E/F, 2026-06-18)** — **done; confirmed
      working by Joe 2026-08-25.** Scopes are `gmail.modify`+`gmail.send` and the live refresh
      token carries them, so inbox star/archive/mark-read/important/trash all work. (If that
      ever regresses, the fix is: visit `https://os.sjcarpentryllc.com/api/inbox/oauth/start`,
      approve, paste the new `GMAIL_REFRESH_TOKEN` into `.env.local`, restart the service.)
- [ ] Production Gmail auth: consider `ANTHROPIC_API_KEY`/`--bare` for the automation CLI path
      (currently runs under Joe's interactive login).
