# Users & access (staff role)

**Built 2026-09-15**; made per-account **2026-09-27** (see "What is per-account,
what is shared"). Owner adds logins from **Settings → Team & roles**.

## Roles

| role | what it is | where it can go |
| --- | --- | --- |
| `owner` | Joe. Implicitly every area. | everything |
| `staff` | Internal team member. Holds a list of **areas** (`users.permissions`). | only the areas ticked |
| `sub` / `client` | Portal logins (unchanged). | their portal |

## Areas

Catalog: `lib/permissions.ts` (`PERMISSIONS`). Each area = a key, a label, and the
route prefixes it opens. Two are marked sensitive:

- **Money, split four ways + catch-all** (Joe, 2026-09-16 — he wants to be able to
  trust someone with invoices/estimates/POs/cost book individually):
  - `estimates` — project estimates, lead rough estimates (Money tab › Estimate)
  - `invoices` — invoices, draws, collections, contract value, paid-to-date, the
    Money rail card and Send invoice button
  - `purchase_orders` — vendor POs (Money tab › Purchase orders)
  - `change_orders` — change orders (Money tab › Change orders)
  - `bidding` — bid packages, sub bid amounts, bid files (project Bidding tab)
  - `cost_book` — `/cost-book`
  - **`money`** — everything else financial: **job costing and profit** (the `/money` page, a project's Money › Overview, and the Overview rail's profit line), billing rates, Books. **Every future money feature gates on this key** unless
    it clearly belongs to one of the four above.
- **`ai`** — the Ask window. For a staff account this is the **business
  profile only** (A08a, 2026-09-23): the agent gets the sjcos tools scoped to
  that person's areas and approval authority, read-only operating docs, and
  no code / shell / web / repo access. The owner's full operator profile
  (repo edit access) never applies to a staff member — `profileFor()` in
  `lib/authority/run-profile.mjs` decides from the session, and the runner
  enforces it with CLI flags, a scratch cwd and a minimal env.

## Areas vs authority (A22, 2026-09-23)

Areas say what a team member can **see**. What they may **approve** is a
separate thing — `authority_grants`, one row per action type (catalog:
`lib/authority/catalog.ts`: package_release, proposal, purchase, payment,
refund, publication, schedule, funding, markup, change_order, design_package;
`grant` = authority administration, never delegable), optionally scoped to a
project and capped at a dollar amount. New accounts hold **none**.

- Edit it at **Settings → Team & roles → Access → "their authority page"**
  (`/settings/team/<userId>`): Areas and May-approve are two sections.
- Only a signed-in **owner** can grant/revoke (`lib/authority/grants.ts`
  `assertAuthorityAdmin`). An agent — even acting for Joe — cannot; text in
  an email cannot. Every change is a keyed command + `permission_audit` row.
- A revoke also inserts a `session_revocations` row: every JWT the person
  holds (browser, mobile bearer) is refused on its next request without
  re-login (`lib/dal.ts`, `lib/api-auth.ts` `sessionRevoked`). A running
  business-profile agent for that person is killed within ~5 s.
- Checked on **every caller**: decisions (`lib/commands/decisions.ts`
  `authorityFor` — app, Telegram, push, MCP), non-decision callers
  (`effectiveAuthority`), and agent sends (`lib/authority/mcp-gate.ts`
  `principalMaySpendGrant`: the person behind the agent must hold the kind
  the gated action maps to, within project/amount).
- `/engine/permissions` (owner grants for agents) stays owner-only;
  `/engine/decisions` (WS-approvals) uses `authorityFor`, so a staff member
  with a fitting grant sees and resolves only what they may.

## How it's enforced (three layers)

1. **proxy.ts** — keeps staff out of the owner-only paths (`OWNER_ONLY_PATHS`) and
   stamps `x-sjcos-path`. The JWT's `perms` copy is only used to pick their home
   on a redirect; it is not the gate (it'd be stale until next login).
2. **Shell** (`components/shell/Shell.tsx`) — every internal page renders it;
   re-checks the path against the **DB row** so a revoked area bites on the very
   next render (layouts don't re-run on soft nav, Shell does).
3. **`requireAccess(key)`** (`lib/dal.ts`) — in server actions and pages. Owner
   passes; staff must hold the key. Replaced ~300 `requireRole("owner")` calls,
   mapped per action file (money.ts + collections.ts → `invoices`, estimates.ts →
   `estimates`, purchase-orders.ts → `purchase_orders`, change-orders.ts →
   `change_orders`, bidding.ts → `bidding`, cost-book.ts → `cost_book`, etc.).
   API routes use `hasAccess(user, key)` from `lib/api-auth.ts`.

Visibility helpers: `can(user, key)` (dal) / `hasAccess(user, key)` (routes).
Sidebar hides areas the staff member doesn't hold; Settings, `/engine/permissions`
and the portal demos are owner-only regardless (`OWNER_ONLY_PATHS`).

## Adding a money feature

- Pick the area (`invoices`/`estimates`/`purchase_orders`/`change_orders`/`bidding`/
  `cost_book`, else `money`).
  Gate its actions with `requireAccess(area)`, routes with `hasAccess(user, area)`.
- Put its pages under a prefix listed in that area's `paths`, or hide the block
  with `can(viewer, area)` inside a shared page (see the project page: Money-tab
  sections per area, Money rail card + contract value + Send invoice on `invoices`,
  Bidding tab on `bidding`).

## What is per-account, what is shared (2026-09-27)

An area says what a person may **open**. It does not say **whose data** they see
there. Settled with Joe, 2026-09-27 — these three buckets are deliberate:

| | |
| --- | --- |
| **Per account** | Today (assigned to-dos), the Inbox mailbox, notifications, chat read markers |
| **Shared** | Open Brain knowledge + Skills — one company library, every account reads and writes it |
| **Joe's alone** | The `ai` operator panel. `ai_conversations` is not user-scoped, so the panel is his session whoever opens it. |

### To-do assignment

`work_item_assignees` — one row per person on a to-do, any number of them (Joe,
2026-09-30: *"assignable to both me and abigail (and any other employee in the
future) instead of either or"*). **No rows means Joe's** — the default for every
row that predates staff logins and for everything detectors, runbooks and MCP
file. Joe's own id is stored only alongside someone else; "just Joe" is no rows,
so there is one spelling of his own. Orthogonal to `assignee_kind` /
`assignee_key`, which say whether a human or a named bot runtime runs it. The
SQL and these rules live in `lib/work-item-assignees.mjs`, shared by the app
and the MCP server. (`work_items.assigned_user_id` is the single-person column
this replaced on 2026-09-30 — no longer read, blanked on every write.)

- **Joe's Today shows every human to-do, handed off or not**, with a line naming
  whoever else is on it: "Assigned to Abigail Stafki", or "Assigned to you &
  Abigail Stafki" when he's on it too. His rule: *"it'll always remain on mine,
  but will list prominently who it's assigned to."*
- A staff member's Today shows only the to-dos they are on — alone or shared —
  and none of the business signals (flagged leads, drifting jobs, A/R, the AI
  brief), which are Joe's to triage. A shared one says who with ("Assigned to
  you & Joe Stafki").
- **Only the owner may assign.** The card's Assign checklist, the `/engine`
  checklist and new-item checkboxes, and the MCP `assign_work_item`
  (`to` / `add` / `remove`) / `create_work_item{assigned_to}` all gate on
  `requireRole("owner")` (not `requireAccess`) — holding Today lets you work
  your queue, never re-deal someone else's.
- The checklist shows exactly who's on it; a to-do nobody is on shows Joe
  ticked, and the last ticked person can't be unticked. Ticking Abigail on one
  of Joe's makes it Joe + Abigail; unticking Joe then leaves it hers alone.
- Everyone newly put on a to-do (other than Joe) gets a notification addressed
  to them, naming who they share it with, so a hand-off is never silent.
- `promoted_at` (the 5-slot Priorities rail) stays the **owner's** state. A staff
  queue is simply the top 5 of their own ranked backlog, so nothing they do
  writes to Joe's rail.
- Work-item ids arrive from the client, so `completeTodayItem` / `snoozeTodayItem`
  / `checkPriorityCompletion` re-check server-side that a staff member is on the
  to-do (`mayWorkItem`).

Scoping rule: `lib/queue-scope.ts` (dependency-free, unit-tested).

### The mailbox

Joe, 2026-09-27: *"link able to their email otherwise blank."* Before this there
was one Gmail account — `GMAIL_REFRESH_TOKEN` — and every login read Joe's mail.

- A Gmail call now runs inside a **mailbox scope** (`lib/mailbox.ts`), which
  `lib/gmail.ts` reads when it builds its OAuth client. That is why ~20 exported
  functions did not each grow a parameter.
- **In a scope with a token** → that person's mailbox. **In a scope with none** →
  nothing: a blank Email rail with a Connect button, never the demo mock and
  never someone else's mail. **Outside any scope** → the env token, which is
  every background path (detectors, the lead thread sync, cron sweeps, MCP
  `send_email`). Those are the company acting, not a person.
- Staff connect their own at `/api/inbox/oauth/start`; the callback stores it in
  `user_email_accounts` under their id. **The owner's mailbox stays in the
  environment on purpose** — the same token is what the background jobs use, and
  a second copy in the DB would leave the UI on one token and automation on
  another.
- Texts, portal messages and website forms still show for anyone with the area:
  those are the company's, not one person's.

### Notifications

`notifications.audience_user_id` — NULL is the **owner's company feed** (what
every `emit()` writes: leads, money, compliance). A staff id addresses one
person. Staff feeds are targeted-only, so a team login never reads Joe's feed.
Read state moved from the global `notifications.read` flag to
`notification_reads` (per user); the old column is left in place and unused.

### Team chat

- Channels are company-wide (everyone sees every open bare channel). **Rooms**
  need membership (`chat_team_members`). **DMs** you must be a party to.
- Sub DMs (`dm:<slug>` — that sub's live portal thread) and client DMs stay the
  owner's: they are outward-facing, not internal chat.
- Managing the place — creating/archiving channels, adding subs or clients,
  moving AI membership, releasing a parked portal delivery — is `requireRole("owner")`.
- Every owner/staff login gets a `team_members` row (`user_id`) so it has a DM
  address; new staff accounts get one automatically from both the Settings form
  and MCP `create_user`.
- Key shapes (`lib/dm-keys.ts`, unit-tested): owner↔person keeps the original
  `dm:team:<slug>` so existing transcripts stay addressable; staff↔staff is
  `dm:team:<a>+<b>` with slugs sorted.
- Read markers are per user in **`chat_reads_by_user`**. The old single-owner
  `chat_reads` table is left behind, unused — changing its primary key in a
  migration would have broken the running site's `markRead()` until the next
  deploy.

## Known gaps

- Fenced 2026-09-23 (A22): lead rough estimate (card + tab → `estimates`),
  project Documents › lead paperwork (→ `estimates`), sub rates on the
  directory and detail pages (→ `money`).
- Still visible to staff without the area: selection budgets on the project
  Selections tab (`components/projects/SelectionsBoard.tsx` renders
  `view.overallBudget` / section budgets — needs a `showBudget` prop from the
  project page, listed in `status/A22.md`), vendor pricing on vendor pages,
  doc drafts that contain pricing. Fence them with `can(viewer, "money")` as
  they come up.
- No self-serve password change/reset; the owner resets from the Team screen.
- Sessions: staff cookie carries a copy of their areas for the proxy prefilter;
  the DB row is the truth for everything else.
- Staff can't reassign at all — not even back to Joe. If that turns out to be
  wanted, it's a second action, not a loosening of the owner check.

Migrations: `node db/apply-staff-users.mjs` (applied 2026-09-15),
`node db/apply-staff-separation.mjs` (2026-09-27 — every statement is additive,
so it can be applied before the deploy without breaking the running site);
authority / revocations / audit / agent profile + usage: `db/migrations/0009_access.sql`
(`node db/migrate.mjs`).
