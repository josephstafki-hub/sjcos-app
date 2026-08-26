# Phase 7.x — Inbox interactivity & Gmail parity (PLAN)

Status: **A/B/C/D/E/F BUILT.** Smart views, channels, Gmail labels, the
All/Clients/Subs/Money audience chips, and the by-project rail filter the
list client-side; per-thread label chips render; the reader Pin is a real
STARRED toggle and the ⋮ menu does Mark read/unread, Mark important, Archive
and Trash via owner-gated server actions (`lib/actions/inbox.ts`
modify/trash wrappers → `lib/gmail.ts` `modifyThread`/`trashThread`).
**F: `GMAIL_SCOPES` is now `gmail.modify`+`gmail.send`** and the consent
flow requests it (`lib/gmail.ts`).

> **✅ RESOLVED — the modify re-consent is done (confirmed by Joe 2026-08-25).**
> This doc used to defer it because the only redirect URI available was an
> ephemeral cloudflared tunnel. The app deployed, the permanent
> `https://os.sjcarpentryllc.com/api/inbox/oauth/callback` was registered, and
> the refresh token was re-minted with `modify` — **the E/F actions (star,
> archive, mark read/unread, important, trash) all work in prod.** The
> "Gmail needs modify access" string is just how `withGmail()`
> (`lib/actions/inbox.ts`) translates a scope error at call time; if it ever
> reappears, reconnect the inbox at Settings → Integrations and it clears.

Not built (optional): the ⋮ "apply/remove label" submenu and Gmail category
tabs (Joe skipped categories).

**C resolver notes:** `loadContactMaps()` in lib/inbox.ts joins each thread's
counterparty email/domain against leads (→ client), subs (→ sub, plus
company-domain match for non-consumer domains) and a money heuristic
(known vendor domains + invoice/receipt subject regex); projects link via
`projects.lead_id → leads.email`. Because the *seed* contacts use synthetic
`.example` addresses and `projects.lead_id` is null, Clients/Subs/by-project
resolve to ~0 on seed data today — Money matched 9 real threads in the live
inbox. These chips populate once real lead/sub emails land (leads collected
post-launch — the old CSV import was dropped) and projects are linked to leads.

## What's inert today (and the goal)

| Control | Now | Goal | Status |
|---|---|---|---|
| Smart views (Needs reply / Awaiting them / Snoozed / Done) | filter the thread list | filter the thread list | ✅ done (B) |
| Channel filters (Email / SMS / …) | filter (only Email is real) | filter | ✅ done (B) |
| By-project rail | filters by linked project | filter by linked project | ✅ done (C) |
| All / Clients / Subs / Money chips | classify + filter threads | classify + filter threads | ✅ done (C) |
| Gmail labels | list + filter + per-thread chips | list labels, per-thread chips | ✅ done (D) |
| Gmail category tabs | not shown | Primary/Social/Promotions/Updates tabs | ⬜ D (category carried, tabs not built) |
| Pin (reader header) | real STARRED toggle (optimistic) | map to Gmail **star** + toggle | ✅ built (E); needs re-consent (F) |
| ⋮ three-dot menu (reader header) | read/unread, important, archive, trash | dropdown of real Gmail actions | ✅ built (E); needs re-consent (F) |

## A. Data model — carry Gmail metadata through

Extend `RawGmailThread` (lib/gmail.ts) and `InboxThread` (lib/inbox.ts) with:
`unread`, `starred`, `important`, `labelIds` (raw), `userLabels` (resolved
names), `category` (Primary/Social/Promotions/Updates/Forums from `CATEGORY_*`).
- `fetchThreads` already pulls `labelIds` on the latest message; also aggregate
  across the thread.
- Add `fetchLabels()` → `users.labels.list` (id→{name,color}), cached per
  request, to resolve user label ids to display names.

## B. Smart views → real filters (no new scope)

Compute a `view` per thread from metadata instead of the unread-only heuristic:
- **Needs reply** = latest message is inbound (From ≠ owner) AND in INBOX.
- **Awaiting them** = latest message is outbound (From = owner).
- **Snoozed** = Gmail `SNOOZED` label if present, else a local snooze store
  (Gmail API can't set snooze).
- **Done** = not in INBOX (archived) — recent.

Recommend **client-side filtering**: fetch a larger window once, filter in
`InboxClient` by predicate on enriched metadata (snappy, no refetch). Move to
server-side `q=` queries later if volume grows.

## C. Chips + by-project → classification (needs DB join)

Classify each thread by matching the sender email/domain against
leads/subs/projects contacts in Postgres:
- **Clients** = matches a project/lead client contact.
- **Subs** = matches the subs table.
- **Money** = receipts/invoices (sender/subject heuristic + known vendors).
- **By-project** = resolve sender → project; tag + filter.

New: a server-side `enrichThreads()` that joins Gmail senders against DB
contacts and assigns `tag` + `audience`. Then chips filter client-side.
(Bigger item — needs a contact→entity resolver.)

## D. Gmail labels & categories surfaced (no new scope)

- "Labels" section in the rail from `fetchLabels()`, with unread counts; click
  filters by `labelIds` (client) or `label:<name>` (server).
- Category tabs (Primary / Promotions / Social / Updates) from `CATEGORY_*`.
- Per-thread label chips in the list row.

## E. Pin + three-dot menu → real actions (NEEDS new scope — see F)

Reader header actions become real, each a server action calling
`users.threads.modify` / `.trash`:
- **Pin → Star** (Gmail has no pin): toggle `STARRED`. Relabel icon as a star.
- **⋮ menu**: Archive (remove `INBOX`), Mark read/unread (`UNREAD`),
  Star/unstar, Mark important (`IMPORTANT`), Apply/remove label (submenu),
  Trash (`users.threads.trash`).

New: `modifyThread(threadId, {addLabelIds, removeLabelIds})` and
`trashThread(threadId)` in lib/actions/inbox.ts (owner-gated, `revalidatePath`).
New UI: a dropdown menu component (confirm none exists in components/ui first).

## F. Scope prerequisite (a decision for Joe)

Reading + send use `gmail.readonly` + `gmail.send`. **Pin/star, archive,
mark-read, and label changes require `gmail.modify`** (covers everything except
permanent delete). Enabling E means:
1. Add `gmail.modify` to `GMAIL_SCOPES`,
2. Re-run `/api/inbox/oauth/start` to mint a new refresh token with the broader
   scope.

A/B/C/D are all doable on the **current readonly scope**. Only E needs `modify`.

## Suggested sequence

1. **A** — enrich the data model + `fetchLabels()`.
2. **B** — smart-view filtering (quick visible win, no new scope).
3. **D** — labels/categories in the rail + thread chips (no new scope).
4. **F** — add `gmail.modify` scope + re-consent.
5. **E** — pin→star + ⋮ menu actions.
6. **C** — project linking / audience chips (needs DB contact resolver).
