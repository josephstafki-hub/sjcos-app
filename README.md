# SJC OS — Build Plan

**What:** Single-pane business operating system for SJ Carpentry LLC.
Replaces QuickBooks, Google Drive, email/SMS apps, and the `/admin` page on sjcarpentryllc.com.

**Stack:** Next.js 16 · TypeScript · Tailwind CSS v4 · PostgreSQL 16 · PM2 + Nginx
**Server:** 192.168.1.38 (local) / 73.94.192.119 (public) · Accessed via browser from Windows machine
**Design source:** `/home/joe/SJC-OS/design_handoff_sjc_os/` — build to `SJC OS - Website Theme.html` + `website-theme.css`

---

## Current Status

> **Phase 2 — Communications** · ✅ complete (2.1–2.3) · next: Phase 3.1 Schedule

---

## How to use this file

- Checkboxes track what's done. Check them off as each item is completed.
- "Status" line above always reflects the active phase.
- Per-phase detail (decisions made, deferred items, notes) lives in `docs/phases/`.
- Design tokens reference: `docs/design-tokens.md`
- Route + component map: `docs/routes.md`

---

## Phase 0 — Foundation
*Everything else builds on this. Nothing ships until this phase is solid.*

### 0.1 Global styles + design tokens
- [x] Replace default `globals.css` with SJC OS token layer (CSS variables from `website-theme.css`)
- [x] Load Google Fonts: Newsreader (serif headings), Mulish (UI/body), JetBrains Mono (labels/numbers)
- [x] Map Tailwind config to token variables (extend theme with `ink`, `paper`, `accent`, `ai`, `flag`, `money`, `info` color scales)
- [x] Verify fonts and colors render correctly *(verified on `:3017` — see port note in phase-0 doc)*

### 0.2 App shell — ShellA
- [x] `components/shell/Sidebar.tsx` — forest-green panel (#283021), nav groups (Work / Tools / External / Bottom row), active highlight, count badges
- [x] `components/shell/Topbar.tsx` — breadcrumb (mono small-caps), search box (280px), bell icon, Ask button
- [x] `components/shell/CmdKPill.tsx` — persistent bottom-center pill; hidden via `hideCmd`
- [x] `components/shell/Shell.tsx` — composes Sidebar + Topbar + main slot; accepts `breadcrumb`, `hideCmd` (active derived from `usePathname`)
- [x] Routing: Next.js App Router with path-based routes (replaces prototype's hash routing)
- [x] Shell renders correctly with active sidebar state (highlight derived from current path)

### 0.3 Base component library
- [x] `components/ui/Card.tsx` — Box/surface, 8px radius, card shadow
- [x] `components/ui/Chip.tsx` — kinds: `accent`, `ai`, `flag`, `money`, `info`, `ghost`, `solid`; pill shape; optional dot
- [x] `components/ui/Avatar.tsx` — initials + kinds; full circle
- [x] `components/ui/AiBubble.tsx` — sage background, sparkle icon, AI content + action buttons slot
- [x] `components/ui/Tabs.tsx` — tab bar with active underline
- [x] `components/ui/Field.tsx` — label + value readout (for detail pages)
- [x] `components/ui/Eyebrow.tsx` — small-caps mono section label
- [x] All components export from `components/ui/index.ts`

### 0.4 AI service abstraction
- [x] `lib/ai.ts` — provider-agnostic service with typed methods: `brief()`, `triage()`, `draft()`, `summarize()`, `suggest()`
- [x] All methods return mock data initially (no real AI calls)
- [x] Service is the only place any AI provider is ever imported — screen components never touch a provider directly

### 0.5 Data layer scaffold
- [x] `lib/db.ts` — PostgreSQL connection pool (pg)
- [x] `db/schema.sql` — initial schema for Lead, Project, Sub, Thread, Notification, ComplianceItem
- [x] Create DB and run initial migration *(role + db `sjcos` provisioned; 6 tables applied 2026-06-13)*
- [x] `lib/types.ts` — TypeScript interfaces matching the schema

---

## Phase 1 — Daily Workflow Screens
*The screens Joe touches every single day. Build these first so the app is immediately useful.*

### 1.1 Today (`/today`)
- [x] Header strip — date, "Good morning, Joe.", weekly-money chip, lead-state chip
- [x] AI brief card (AiBubble) — summary from `ai.brief()`, "Open agenda" + "Re-prioritize" actions
- [x] Priorities column — AI-ranked cards with type chip, title, reason
- [x] This-week mini calendar strip
- [x] Today's schedule — timeblock list
- [x] Waiting-on-me checklist preview
- [x] Wire to `/api/today` mock endpoint *(page server-renders via `getTodayData()`; route exposes same payload)*

### 1.2 Leads list (`/leads`)
- [x] Pipeline stage strip (6 stages: Intake → Signed + retainer)
- [x] Sortable lead table (name, scope, stage chip, AI-take flag, age)
- [x] Row click navigates to `/leads/[slug]`
- [x] Wire to `/api/leads` mock

### 1.3 Lead detail (`/leads/[slug]`)
- [x] Header — avatar, name, scope, pipeline chip, action row (Call / Email / Ask Claude / Move to Pre-Con)
- [x] Tabs — Overview, Conversation, Rough Estimate, Selections, Files, Activity (Overview built; others placeholder)
- [x] Overview: AI triage card (GO/HOLD/PASS via `ai.triage()`), 5-question intake, Phase 1 rough estimate
- [x] Sidebar: pipeline stage tracker, cadence/SLA, photos grid
- [x] Wire to `/api/leads/[slug]` mock

### 1.4 Projects list (`/projects`)
- [x] Grouped by status: Active · Closeout · Pre-construction
- [x] Project cards with progress bar, contract value, status chips
- [x] Card click navigates to `/projects/[slug]`
- [x] Wire to `/api/projects` mock

### 1.5 Project detail (`/projects/[slug]`)
- [x] Header — name, contract value, status chips, action row
- [x] 9 tabs — Overview, Schedule, Selections, Subs, Files, Money, Daily Log, Comms, Punch (Overview built; others placeholder)
- [x] Overview: AI pulse card, milestones (with money + status), this-week strip, latest daily log, AI weekly-status email draft (`ai.draft`)
- [x] Right rail: money summary, subs roster, files
- [x] Wire to `/api/projects/[slug]` mock

---

## Phase 2 — Communications
*Inbox and chat are the second-highest daily-use surfaces.*

### 2.1 Inbox (`/inbox`)
- [x] Left rail — smart views (Needs reply, Awaiting them, Snoozed, Done), channels (Email, SMS, Client/Sub portal, Site forms), by-project filter
- [x] Middle list — thread cards (avatar, channel icon, project tag, AI verdict chip, urgency badge)
- [x] Right reader — full thread, AI draft-reply card *(draft body via `ai.draft`)*
- [x] Wire to `/api/inbox` mock *(page server-renders via `getInboxData()`; client handles thread selection across the 3 panes)*

### 2.2 Team Chat (`/chat`)
- [x] Left rail — channels (field-daily, selections, bookkeeping, safety, marketing-queue), project rooms, DMs with online dots
- [x] Message thread — day separators, user/system messages, Claude as participant with `AI · system` chip
- [x] Bottom composer — message input, `@claude` + `/log` chips
- [x] Wire to mock data *(`lib/chat.ts` + `/api/chat`; server page renders #field-daily showcase, client handles channel selection; other channels get a generic "Claude is watching" view)*

### 2.3 Notifications (`/notifications`)
- [x] 720px centered column
- [x] Filter chips (decisions, mentions, jobs, money, compliance)
- [x] Notification cards — icon, tag chip, title, sub-line, timestamp, right arrow; red border for decisions
- [x] Wire to `/api/notifications` mock *(`lib/notifications.ts` + `/api/notifications`; server page → `NotificationsClient` handles filter state; counts computed from data)*

---

## Phase 3 — Operations
*Operational tools Joe uses weekly.*

### 3.1 Schedule (`/schedule`)
- [x] 5-day card strip with timeblock pills (color-coded by job/AI)
- [x] Daily-log lane below (one box per day — photos + free text)
- [x] AI "auto-log from photos" offer chip
- [x] Wire to `/api/schedule` mock *(`lib/schedule.ts` + `/api/schedule`; server page. AI conflict note via `ai.suggest({kind:"schedule-conflicts"})` — mock now kind-aware. Built from design Schedule_B.)*

### 3.2 Subs list (`/subs`)
- [x] Card grid — avatar, name, trade, star rating, jobs count, rate, open-jobs chip, COI status chip
- [x] Filter by trade
- [x] Card click navigates to `/subs/[slug]` *(route lands in 3.3)*
- [x] Wire to `/api/subs` mock *(`lib/subs.ts` + `/api/subs`; server page → `SubsClient` handles trade-filter state. Built from design SubsList.)*

### 3.3 Sub detail (`/subs/[slug]`)
- [x] Header + back link
- [x] Tabs — Overview, Jobs, Paperwork, Pricing, Notes *(Overview built; others placeholder)*
- [x] Overview: reliability stats, AI summary, recent-jobs timeline
- [x] Sidebar: paperwork checklist, rate card, AI 1099 reminder
- [x] Wire to `/api/subs/[slug]` mock *(`getSub()` in `lib/subs.ts` + `/api/subs/[slug]`; server page → `SubTabs`. Curated showcase (marco) + generic fallback so every card opens; AI summary via `ai.summarize({focus:"sub-reliability"})`. Built from design SubDetail.)*

### 3.4 Files (`/files`)
- [x] 3-pane layout — tree (Spaces + Projects/Year/Client), list (filterable, AI tags), preview (thumbnail, metadata, AI tags, actions)
- [x] Wire to mock file tree *(`lib/files.ts` + `/api/files`; server page → `FilesClient` handles file-selection + type-filter state. Curated previews (contract, demand) + generic fallback so any file opens. Built from design Files_A.)*

### 3.5 Compliance (`/compliance`)
- [x] AI summary card — what's coming, recommended actions
- [x] 3 timeline windows — Urgent (<14 days, flag color), 30-day, 60/90-day
- [x] Year-ahead timeline — chronological list
- [x] Wire to `/api/compliance` mock *(`lib/compliance.ts` + `/api/compliance`; server page. AI outlook via `ai.summarize({focus:"compliance"})`. Built from design Compliance.)*

### 3.6 Warranty (`/warranty`)
- [x] AI claim summary card
- [x] Active claims — card per open claim, deadline, AI-drafted reply chip
- [x] Under-warranty grid — closed projects with warranty end dates
- [x] Wire to `/api/warranty` mock *(`lib/warranty.ts` + `/api/warranty`; server page. AI claim summary via `ai.summarize({focus:"warranty"})`. Built from design Warranty.)*

---

## Phase 4 — Tools
*Less frequent but important business tools.*

### 4.1 Site / CMS (`/site`)
- [ ] Left rail — pages list (PUBLISHED / AUTO-SYNC / LIVE status), auto-publish queue
- [ ] Editor pane — WYSIWYG preview of sjcarpentryllc.com with editable headline + inline annotation
- [ ] Wire to mock

### 4.2 Newsletter (`/newsletter`)
- [ ] Left rail — issues list, audience counts, last-issue performance stats
- [ ] Center — email preview (580px width), masthead, serif headline, paragraphs, secondary items
- [ ] Wire to mock

### 4.3 Catalog (`/catalog`)
- [ ] Search + trade filter chips
- [ ] 4-column card grid — photo, name, supplier, SKU, usage count, price
- [ ] Wire to `/api/catalog` mock

### 4.4 Floor Plan (`/floor`)
- [ ] **Not in global sidebar — reached only from Floor-plan tab inside a Lead or Project**
- [ ] 3-pane: 72px tool palette (Select, Wall, Door, Win, Measure, Cabinet, Appl, Plumb, Elec, Note + hotkeys), canvas (grid + walls + cabinets + dimensions), right rail (inspector + catalog grid + "Push to selections")
- [ ] Structural shell only — full editor internals deferred

---

## Phase 5 — AI Surfaces + Search

### 5.1 AI Screen (`/ai`)
- [ ] Left rail (260px) — Context loaded (in-scope records), Skills list (sow, lead-triage, co-draft, weekly-status, demand-letter, estimate-research, social-post), Recent threads
- [ ] Center — thread with user/assistant messages, action chips, attached AI bubbles
- [ ] Bottom composer — rich input with `@mention` + `/skill` slash commands + sample-prompt chips
- [ ] Wire to `lib/ai.ts` mock; interface is streaming-ready

### 5.2 Command Bar (`/cmdk`)
- [ ] Modal overlay on dimmed background (Today page renders behind it)
- [ ] Search input with sparkle icon
- [ ] "Claude — context aware" highlighted row
- [ ] Actions group (Create new lead, Generate SOW, Draft client status email, Send demand letter)
- [ ] Jump-to group (Henderson kitchen, Maria Chen)
- [ ] Footer keyboard hints + mode chips
- [ ] Global Ctrl+K keyboard shortcut wired from Shell

### 5.3 Search (`/search`)
- [ ] 720px centered column
- [ ] AI direct-answer card at top
- [ ] Grouped results — Projects, Files, People
- [ ] Wire to mock

---

## Phase 6 — Portals + Settings

### 6.1 Client Portal (`/client-portal`)
- [ ] Standalone chrome — no SJC OS sidebar; slim header with client avatar
- [ ] Project journal entries with photos and dates
- [ ] Sidebar: decisions needed, money summary, message-Joe box, files
- [ ] Wire to mock

### 6.2 Sub Portal (`/sub-portal`)
- [ ] Standalone chrome — slim header with COI-current chip
- [ ] Today's job front and center — scope checklist, materials verification, watch-out flag
- [ ] "Log your day" — photo + voice note buttons (AI converts to daily log)
- [ ] Wire to mock

### 6.3 Settings (`/settings`)
- [ ] Left rail — categories (Profile, Workspace, Team & roles, Integrations, Claude & AI, Subscription, Data & backups, Notifications)
- [ ] Profile section — editable fields
- [ ] Integrations section — 3-col card grid (connected / not-connected chips)
- [ ] Claude defaults section — toggles
- [ ] Wire to mock

---

## Phase 7 — Real Data + Backend

### 7.1 Data import
- [ ] Import `leads.csv` from `~/sj-carpentry-os/06_operations/crm/data/` into PostgreSQL
- [ ] Import existing project data from same directory
- [ ] Validate data, resolve any schema mismatches

### 7.2 API routes (real)
- [ ] `/api/today` — real daily brief (pulls leads, projects, schedule)
- [ ] `/api/leads` + `/api/leads/[slug]` — CRUD on Lead table
- [ ] `/api/projects` + `/api/projects/[slug]` — CRUD on Project table
- [ ] `/api/inbox` — stub for email/SMS unification (Postmark + Twilio later)
- [ ] `/api/subs` + `/api/subs/[slug]` — CRUD on Sub table
- [ ] `/api/compliance` — reads compliance items, flags upcoming deadlines
- [ ] `/api/notifications` — reads notification table

### 7.3 Real AI (swap in when ready)
- [ ] Decide: local LLM via Ollama, or Anthropic API
- [ ] Implement chosen provider in `lib/ai.ts` — zero screen-code changes required
- [ ] Test each AI method (brief, triage, draft, summarize, suggest)

---

## Phase 8 — Production Deployment

- [ ] `npm run build` passes clean
- [ ] PM2 config (`ecosystem.config.js`) — app name `sjcos`, port 3001, auto-restart
- [ ] Nginx config — proxy `sjcos.local` (or subdomain) → port 3001
- [ ] Environment variables in `.env.local` — `DATABASE_URL`, `AI_PROVIDER`, etc.
- [ ] Smoke-test all routes in production build
- [ ] PM2 startup configured so app survives server reboot

---

## Deferred (out of scope this round)

- **Books / accounting deep-dive** — QuickBooks stays as source of truth; only A/R surface and compliance calendar in SJC OS
- **Mobile** — desktop-first for now
- **Real email/SMS integration** — Postmark + Twilio wired in a later phase
- **Google Drive mirror** — Files module uses local storage initially
- **Plaid / Stripe / QuickBooks sync**
- **Floor Plan editor internals** — structural shell only in Phase 4
