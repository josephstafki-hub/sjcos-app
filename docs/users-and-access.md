# Users & access (staff role)

**Built 2026-09-15.** Owner adds logins from **Settings → Team & roles**.

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
- Team chat read markers are global, not per user.
- Sessions: staff cookie carries a copy of their areas for the proxy prefilter;
  the DB row is the truth for everything else.

Migration: `node db/apply-staff-users.mjs` (applied to the live DB 2026-09-15);
authority / revocations / audit / agent profile + usage: `db/migrations/0009_access.sql`
(`node db/migrate.mjs`).
