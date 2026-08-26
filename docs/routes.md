# SJC OS — Route + Component Map

*Verified against the tree 2026-08-25. All routes use the Next.js App Router
(path-based, not hash-based like the prototype).*

## Layout groups (read first)

```
app/
  layout.tsx            — root layout (fonts, body)
  (os)/                 — ROUTE GROUP: every internal owner-facing page.
    layout.tsx          —   owns the h-dvh viewport; for the owner, mounts the
                            persistent operator panel beside the page content.
                            Also hosts RouteTracker + LiveUpdates (one instance
                            per session, not per page).
    page.tsx            —   `/` → redirect to /today
  login/                — standalone
  panel/                — standalone: the panel in its own detached window
  client-portal/        — standalone client surface (own chrome, no Shell)
  sub-portal/           — standalone sub surface (own chrome, no Shell)
  api/                  — route handlers
```

The `(os)` group is a **layout** boundary, not a URL segment: `/today` is served
by `app/(os)/today/page.tsx`. A layout does not re-render on soft navigation,
which is what lets the operator dock's chat state, poll loops, and splitter
width survive page changes.

**Universal operator panel (2026-08).** The panel (`components/panel/`) is the
app's one Ask surface — queue + chat dock on the left, the real app on the
right, resizable, detachable to `/panel`. The old ⌘K CommandBar/pill,
`AssistantChat`, and the Today-feed/newsletter chats are gone; `/cmdk` and
`/today-preview` are now redirects. `/workbench` is the old operator-console
workbench column promoted to a full page.

---

## Shell

Internal pages wrap in `Shell` (`components/shell/Shell.tsx`): sidebar + topbar
+ main slot. Standalone pages (login, panel, Client Portal, Sub Portal) use
their own chrome and do **not** wrap in Shell.

```
Shell props (that's all of them):
  breadcrumb?  — small-caps mono string in the topbar, e.g. "PROJECTS › HENDERSON KITCHEN"
  aiContext?   — text brief of this page's records, published to the operator
                 panel so its turns answer from what's in view (lib/page-context.ts)
```

There is no `active` prop any more — the sidebar derives its highlight from
`usePathname()`. `hideCmd` / `cmdkOpen` / `embeddedAsk` were removed with the
⌘K surface.

---

## Route table — internal (`app/(os)/…`)

Grouped as the sidebar groups them (`components/shell/Sidebar.tsx`).

| URL path            | File under `app/(os)/`     | Notes |
|---------------------|----------------------------|-------|
| `/today`            | `today/page.tsx`           | The day's queue |
| `/inbox`            | `inbox/page.tsx`           | Gmail |
| `/messages`         | `messages/page.tsx`        | SMS — built, inert until a provider (`docs/sms-seam.md`) |
| `/chat`             | `chat/page.tsx`            | Team chat (`@` mentions) |
| `/leads`            | `leads/page.tsx`           | |
| `/leads/[slug]`     | `leads/[slug]/page.tsx`    | |
| `/projects`         | `projects/page.tsx`        | |
| `/projects/[slug]`  | `projects/[slug]/page.tsx` | Tool tabs — see `lib/project-tabs.ts` |
| `/schedule`         | `schedule/page.tsx`        | |
| `/subs`             | `subs/page.tsx`            | |
| `/subs/[slug]`      | `subs/[slug]/page.tsx`     | |
| `/vendors`          | `vendors/page.tsx`         | Materials suppliers (distinct from subs) |
| `/vendors/[slug]`   | `vendors/[slug]/page.tsx`  | |
| `/files`            | `files/page.tsx`           | |
| `/site`             | `site/page.tsx`            | Website CMS push |
| `/newsletter`       | `newsletter/page.tsx`      | Issues, recipients, drips |
| `/catalog`          | `catalog/page.tsx`         | Retail products (clipper target) |
| `/cost-book`        | `cost-book/page.tsx`       | Reusable unit costs estimates pull from |
| `/compliance`       | `compliance/page.tsx`      | |
| `/warranty`         | `warranty/page.tsx`        | |
| `/marketing`        | `marketing/page.tsx`       | |
| `/automate`         | `automate/page.tsx`        | Claude-CLI builder |
| `/engine`           | `engine/page.tsx`          | Work items, skills, runbooks |
| `/engine/permissions` | `engine/permissions/page.tsx` | Owner grants / decisions |
| `/workbench`        | `workbench/page.tsx`       | `?s=<subject>` — live entity workbench |
| `/floor`            | `floor/page.tsx`           | Floor-plan viewer |
| `/ai`               | `ai/page.tsx`              | `?c=` passthrough to a conversation |
| `/notifications`    | `notifications/page.tsx`   | |
| `/settings`         | `settings/page.tsx`        | |
| `/cmdk`             | `cmdk/page.tsx`            | **redirect → `/today`** |
| `/today-preview`    | `today-preview/page.tsx`   | **redirect → `/today`** |
| `/` (root)          | `page.tsx`                 | **redirect → `/today`** |

**`/books`** is in the sidebar as a **disabled `soon` item — there is no page.**
The accounting epic is unbuilt (`docs/phase-5-accounting-plan.md`).

## Route table — standalone

| URL path | File | Notes |
|---|---|---|
| `/login` | `app/login/page.tsx` | |
| `/panel` | `app/panel/page.tsx` | Panel-only window, no Shell |
| `/client-portal` | `app/client-portal/page.tsx` | + `documents`, `messages`, `money`, `mood`, `plans`, `schedule`, `selections` |
| `/sub-portal` | `app/sub-portal/page.tsx` | |

---

## API routes

Route handlers live under `app/api/`. Rather than list every one (it drifts),
the shape:

| Family | Path | Auth |
|---|---|---|
| Record reads | `/api/{today,leads,projects,subs,inbox,schedule,compliance,warranty,catalog,files,notifications,site,newsletter}` | session cookie (owner) |
| AI / voice | `/api/{ai,chat,transcribe,tts}` | session cookie |
| Auth | `/api/auth/{login,me}` | — |
| Cron sweeps | `/api/cron/{reminders,detect,agent-retries,bid-follow-ups,lead-thread-sync,newsletter-drip,push-drain}` | cron secret; driven by systemd timers |
| Agent surface | `/api/internal/{bidding,doc-drafts,leads,newsletter,notify-owner,owner-grants,purchase-orders,runbooks}` | internal token — what the MCP server calls |
| Mobile app | `/api/mobile/…` | token; consumed by `/home/joe/sjcos-mobile` |
| Sessionless inbound | `/api/leads/intake`, `/api/catalog/clip`, `/api/sms/webhook`, `/api/inbox/oauth/*` | per-purpose bearer token / shared secret, **not** the session cookie |
| Client-scoped serves | `/api/portal/{bid-file,floorplan,mood-image,project-file,selection-image,sign-doc}/[id]` | portal claim/bearer (`lib/client-portal.ts`) |
| Newsletter tracking | `/api/newsletter/{img,open,unsubscribe}/[token]` | opaque per-recipient token |

`proxy.ts` gates **page navigation** by role; it deliberately excludes `/api`,
so every route handler does its own auth. Mutating server actions guard with
`requireRole("owner")` from `lib/dal.ts`.

---

## Component structure

```
components/
  shell/
    Shell.tsx           — Sidebar + Topbar + main slot
    Sidebar.tsx         — forest-green nav rail (groups: Work / Tools / External)
    MobileNav.tsx       — the rail as a drawer below `lg`
    Topbar.tsx          — breadcrumb, bell, mobile hamburger
    RouteTracker.tsx    — current-route publisher for the panel
    LiveUpdates.tsx     — server-push refresh
  panel/                — the universal operator panel
    PanelProvider/PanelHost/PanelDock/PanelWindow — mounting + docking
    PanelChat + useAgentChat — the chat surface (question boxes, approvals,
                              context meter, stop)
    QueueRail + PanelQueueProvider — the Today queue column
    WorkbenchPanel/WorkbenchLive  — live entity view
  ui/                   — Card, Chip, Avatar, AiBubble, Tabs, Field, Eyebrow,
                          SubmitButton, AiStream, PhotoGrid, … (barrel: index.ts)
  <feature>/            — one folder per surface (leads, projects, engine,
                          newsletter, cost-book, messages, portal, …)

lib/
  db.ts                 — PostgreSQL pool          types.ts   — shared interfaces
  ai.ts                 — provider-agnostic AI      dal.ts     — session/role guards
  dev-agents.ts         — Claude / Hermes runs
  orchestrator/         — router + Claude↔Hermes review ladder
  actions/              — server actions (owner-gated writes)
  doc-templates/        — the legal-document templates

db/schema.sql           — the whole schema (single file, additive)
mcp/sjcos-mcp.mjs       — the MCP server (see mcp/README.md)
```
