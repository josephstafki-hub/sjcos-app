# Phase 7.x — Inbox interactivity & Gmail parity (PLAN)

Status: **planned** (Gmail read + AI draft + send already shipped). This covers
turning the inbox's currently visual-only controls into real, working features
and bringing it closer to Gmail parity.

## What's inert today (and the goal)

| Control | Now | Goal |
|---|---|---|
| Smart views (Needs reply / Awaiting them / Snoozed / Done) | render, don't filter | filter the thread list |
| Channel filters (Email / SMS / …) | render, don't filter | filter (only Email is real) |
| By-project rail | static | filter by linked project |
| All / Clients / Subs / Money chips | render, don't filter | classify + filter threads |
| Gmail labels & categories | not shown | list labels, category tabs, per-thread chips |
| Pin (reader header) | inert icon | map to Gmail **star** |
| ⋮ three-dot menu (reader header) | inert icon | dropdown of real Gmail actions |

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
