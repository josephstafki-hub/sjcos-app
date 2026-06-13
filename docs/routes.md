# SJC OS — Route + Component Map

All routes use Next.js App Router (path-based, not hash-based like the prototype).

---

## Shell

Every internal page wraps in `Shell` (`components/shell/Shell.tsx`).
Standalone pages (Client Portal, Sub Portal) use their own minimal chrome — no Shell.

```
Shell props:
  active       — sidebar nav key (see values below)
  breadcrumb   — string shown in topbar, e.g. "PROJECTS › HENDERSON KITCHEN"
  hideCmd      — boolean; hides ⌘K pill (use on Schedule, Files, Floor plan, CMS preview)
```

Sidebar `active` values:
`home` · `inbox` · `chat` · `leads` · `projects` · `sched` · `subs` · `files` ·
`site` · `newsletter` · `catalog` · `compliance` · `warranty` · `books` ·
`client` · `sub` · `ai` · `settings`

---

## Route table

| URL path              | Next.js file                                | Shell `active` | Phase |
|-----------------------|---------------------------------------------|----------------|-------|
| `/today`              | `app/today/page.tsx`                        | `home`         | 1.1   |
| `/inbox`              | `app/inbox/page.tsx`                        | `inbox`        | 2.1   |
| `/chat`               | `app/chat/page.tsx`                         | `chat`         | 2.2   |
| `/leads`              | `app/leads/page.tsx`                        | `leads`        | 1.2   |
| `/leads/[slug]`       | `app/leads/[slug]/page.tsx`                 | `leads`        | 1.3   |
| `/projects`           | `app/projects/page.tsx`                     | `projects`     | 1.4   |
| `/projects/[slug]`    | `app/projects/[slug]/page.tsx`              | `projects`     | 1.5   |
| `/schedule`           | `app/schedule/page.tsx`                     | `sched`        | 3.1   |
| `/subs`               | `app/subs/page.tsx`                         | `subs`         | 3.2   |
| `/subs/[slug]`        | `app/subs/[slug]/page.tsx`                  | `subs`         | 3.3   |
| `/files`              | `app/files/page.tsx`                        | `files`        | 3.4   |
| `/site`               | `app/site/page.tsx`                         | `site`         | 4.1   |
| `/newsletter`         | `app/newsletter/page.tsx`                   | `newsletter`   | 4.2   |
| `/floor`              | `app/floor/page.tsx`                        | —              | 4.4   |
| `/catalog`            | `app/catalog/page.tsx`                      | `catalog`      | 4.3   |
| `/compliance`         | `app/compliance/page.tsx`                   | `compliance`   | 3.5   |
| `/warranty`           | `app/warranty/page.tsx`                     | `warranty`     | 3.6   |
| `/books`              | `app/books/page.tsx`                        | `books`        | —     |
| `/client-portal`      | `app/client-portal/page.tsx`                | —              | 6.1   |
| `/sub-portal`         | `app/sub-portal/page.tsx`                   | —              | 6.2   |
| `/ai`                 | `app/ai/page.tsx`                           | `ai`           | 5.1   |
| `/cmdk`               | `app/cmdk/page.tsx`                         | —              | 5.2   |
| `/notifications`      | `app/notifications/page.tsx`                | —              | 2.3   |
| `/search`             | `app/search/page.tsx`                       | —              | 5.3   |
| `/settings`           | `app/settings/page.tsx`                     | `settings`     | 6.3   |
| `/` (root)            | `app/page.tsx` → redirect to `/today`       | —              | 0.2   |

---

## API routes

| Endpoint                    | Handler file                                    | Phase |
|-----------------------------|-------------------------------------------------|-------|
| `GET /api/today`            | `app/api/today/route.ts`                        | 1.1   |
| `GET /api/leads`            | `app/api/leads/route.ts`                        | 1.2   |
| `GET /api/leads/[slug]`     | `app/api/leads/[slug]/route.ts`                 | 1.3   |
| `GET /api/projects`         | `app/api/projects/route.ts`                     | 1.4   |
| `GET /api/projects/[slug]`  | `app/api/projects/[slug]/route.ts`              | 1.5   |
| `GET /api/inbox`            | `app/api/inbox/route.ts`                        | 2.1   |
| `GET /api/notifications`    | `app/api/notifications/route.ts`                | 2.3   |
| `GET /api/schedule`         | `app/api/schedule/route.ts`                     | 3.1   |
| `GET /api/subs`             | `app/api/subs/route.ts`                         | 3.2   |
| `GET /api/subs/[slug]`      | `app/api/subs/[slug]/route.ts`                  | 3.3   |
| `GET /api/compliance`       | `app/api/compliance/route.ts`                   | 3.5   |
| `GET /api/warranty`         | `app/api/warranty/route.ts`                     | 3.6   |
| `GET /api/catalog`          | `app/api/catalog/route.ts`                      | 4.3   |

---

## Component structure

```
app/
  layout.tsx              — root layout (fonts, body)
  page.tsx                — redirects to /today
  today/page.tsx
  leads/
    page.tsx
    [slug]/page.tsx
  projects/
    page.tsx
    [slug]/page.tsx
  ... (one folder per route)

components/
  shell/
    Shell.tsx             — composes Sidebar + Topbar + main slot
    Sidebar.tsx           — forest-green nav panel
    Topbar.tsx            — breadcrumb, search, bell, Ask
    CmdKPill.tsx          — persistent bottom pill
  ui/
    index.ts              — barrel export
    Card.tsx
    Chip.tsx
    Avatar.tsx
    AiBubble.tsx
    Tabs.tsx
    Field.tsx
    Eyebrow.tsx

lib/
  ai.ts                   — provider-agnostic AI service (mock → real)
  db.ts                   — PostgreSQL connection pool
  types.ts                — TypeScript interfaces

db/
  schema.sql              — initial DDL
```
