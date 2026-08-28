# Phase 0 — Foundation

**Status:** ✅ complete (2026-06-13). *Historical — the app is long past this phase and is in production; see `README.md` for current status.* All of 0.1–0.5 done. App renders end-to-end at `/today`; AI service + Postgres data layer scaffolded. Next phase: 1.1 Today screen.

---

## Goal

Get a running Next.js app that looks like SJC OS before any screen content is built.
When this phase is done: visiting the app in a browser shows the forest-green sidebar and warm-cream background. All base components exist and can be imported. The shell renders with correct fonts and colors.

---

## Decisions to make before starting

- [x] ~~Dev port: run on `:3001`~~ — **`:3001` is already taken** by another user's `siteme-server` on this shared box, so the build moved to `:3017`. **Resolved: `:3017` is the permanent port**, and the deploy went out on **systemd, not PM2** (`deploy/sjcos.service`; nginx proxies `os.sjcarpentryllc.com` → `127.0.0.1:3017`). See `deploy/README.md`.
- [x] Routing: App Router confirmed (already scaffolded).
- [x] Tailwind: v4 token mapping lives in `globals.css` via `@theme inline`, not `tailwind.config.ts`.

---

## Key files to create / modify

| File | Action |
|------|--------|
| `app/globals.css` | Replace default — add CSS vars + `@theme` Tailwind mapping |
| `app/layout.tsx` | Load Google Fonts, set html/body base styles |
| `app/page.tsx` | Redirect to `/today` |
| `components/shell/Shell.tsx` | Main layout wrapper |
| `components/shell/Sidebar.tsx` | Forest-green nav |
| `components/shell/Topbar.tsx` | Breadcrumb + search + bell + Ask |
| `components/shell/CmdKPill.tsx` | ⌘K persistent pill |
| `components/ui/*.tsx` | 7 base components |
| `lib/ai.ts` | AI abstraction (all mocked) |
| `lib/db.ts` | PostgreSQL pool |
| `lib/types.ts` | TypeScript interfaces |
| `db/schema.sql` | Initial DDL |

---

## Notes / decisions made

- **Icons:** using `lucide-react` (already a dependency) instead of the prototype's inline `WfIco` SVGs. Mapping: Leads→`Sprout`, Projects→`FolderKanban`, Subs→`HardHat`, Catalog→`LayoutGrid`, Compliance→`ShieldCheck`, Warranty→`Star`, Client Portal→`UserRound`, Sub Portal→`UserCheck`.
- **Styling:** components use Tailwind utility classes against the mapped color tokens (`bg-paper`, `text-ink-2`, `border-rule`, `shadow-card`, …). The forest-green sidebar is built directly in `Sidebar.tsx` with cream-on-green colors (no `!important` overrides like the prototype needed).
- **Shell active state:** derived from `usePathname()` in `Sidebar.tsx` rather than a passed `active` prop — one less thing each page has to wire. `Shell` only takes `breadcrumb` + `hideCmd`.
- **`Eyebrow`** absorbed the prototype's `<L>` label: pass `muted` for the quieter ink-3 rail/form-label variant; default is the accent-green eyebrow.
- **`app/today/page.tsx`** is a Phase-0 placeholder so the app renders end-to-end. The real Today screen is Phase 1.1.
