# Inbox drafts backend handoff

Joe approved automatic suggestions and synced drafts on 2026-10-31. The sweep
stages text only. Sending still goes through the existing explicit Send action.
No inbox UI files or `lib/inbox.ts` were changed in this lane.

## UI integration

New server actions in `lib/actions/inbox-drafts.ts` derive mailbox/user identity
from `requireAccess('inbox')` and `withMailboxFor`; never pass either identity.
Types are exported from `lib/inbox-draft-types.ts`.

- `loadDrafts(threadKeys: string[]): Promise<InboxDraft[]>`: one query, up to
  200 keys. Returns own human rows, including terminal tombstones, plus ready AI
  suggestions for the owner only. Suggestions carry `sourceMessageId`; select
  the one matching the reader's latest inbound message, not an older message.
- `saveDraft({threadKey, channel, toEmail, cc: string[], subject, body,
  baseVersion}): Promise<DraftWriteResult>`. Version 0 means no server draft.
  Returns `{conflict:false,current:InboxDraft}` or
  `{conflict:true,current:InboxDraft|null}`. Never blindly retry a conflict.
- `discardDraft({threadKey,channel,baseVersion})`: same result shape. Retains a
  tombstone/version so a stale offline device cannot recreate discarded text.
- `markDraftSent({threadKey,channel,baseVersion,suggestionId?})`: same result
  shape, called **after** a successful explicit send, using the version sent.
  Optional `suggestionId` retires exactly that AI suggestion, not a newer one.
  This action records a send; it never performs one. A cleanup failure must
  never cause the UI to retry the provider send.
- `dismissSuggestion(id: string): Promise<void>`: owner mailbox only; retains
  the AI idempotency key so the next sweep cannot recreate a dismissed reply.

New client hook in `components/inbox/useSyncedDraft.ts`:

```ts
const synced = useSyncedDraft({
  mailbox, userId, threadKey, channel,
  owner: currentUser.role === 'owner',
  latestMessageId, // email reader's latest inbound id; filters stale suggestions
  initial: { body: '', toEmail, cc: [], subject },
});
// synced:
// draft: {body,toEmail,cc:string[],subject}
// setDraft(next | (current => next))
// status: 'saved' | 'saving' | 'local only' | 'conflict'
// version: number
// suggestion: InboxDraft | null
// acceptSuggestion(): void       // explicit replacement only; queues a human save
// conflict: {current:InboxDraft|null} | null
// keepMine(): void               // retry local text using conflict's server version
// resolve('mine' | 'server'): void
// refresh(): Promise<void> | undefined
// flush(): Promise<DraftSyncSnapshot> | undefined
```

The hook debounces saves 800 ms; reads other devices every 20 seconds and on
focus/online/storage events. Local fallback uses the existing `draftKey` and
`readDraft`/`writeDraft` helpers, with a user/channel suffix and version/dirty
metadata. Owner-only legacy adoption preserves old mailbox-only local drafts.
Staff never adopt a mailbox-only legacy draft. Switching threads/mailboxes
cancels pending debounce work; in-flight writes remain fenced by their version.
The pure controller is `createDraftSync(options)` in `lib/inbox-draft-sync.ts`.

On Send: flush, check for conflicts and snapshot changes, retain the version of
exactly the text sent, call the existing send action, then `markDraftSent` and
`refresh`. On discard: flush/resolve any conflict, call `discardDraft` with the
current version, then `refresh`. A newer edit on another device causes a
conflict rather than being cleared by either action. A `local only` snapshot
is not proof of a server save. Keep AI suggestions separate from the composer
until Joe explicitly accepts them; show the human draft first.

## Settings and sweep

- `ai.inboxAutoDraft`: boolean, default true. Existing `setAiToggle` writes it.
- `ai.inboxDraftModel`: `claude` (default) or `hermes`; `setInboxDraftModel`
  writes it with owner authorization. Invalid settings never select Qwen.
- Settings → AI includes both controls.
- `sweepInboxDrafts()` in `lib/inbox-autodraft.ts` is called by authenticated
  GET/POST `/api/cron/inbox-drafts`. CRON_SECRET is mandatory and fails closed.
- Owner only, existing cached loader, oldest first, three attempts per run.
  No unknown senders, automation, no-reply, Done, outbound-last, paused email,
  opted-out recipient, paused send lane, or active human draft.
- AI `(mailbox,thread,source_message_id)` uniqueness provides idempotency.
  Failed claims retry; drafting claims older than 10 minutes can be reclaimed.
  Version checks fence old workers. Discarded/sent suggestions never regenerate.
- Claude uses one conversation fetch plus exported grounding/context helpers.
  Hermes calls the existing grounded `draftReplyForThread(thread,'hermes')`.
  No added per-thread Gmail classification fetches. Gmail rate limits stop the
  run and go through the existing cron log/notification handler.

## Deployment (coordinator; not performed by this lane)

1. Apply `db/migrations/0068_inbox_drafts.sql` through the normal migration flow.
   Its manifest entry/grant permits only `sjcos_readonly SELECT`; website writes
   use the owner login. Run the DB-backed role tests after migration.
2. Deploy the application through the coordinator's normal resource-capped flow.
3. Install the script and units:

   ```sh
   install -m 755 deploy/sjcos-inbox-drafts.sh ~/bin/sjcos-inbox-drafts
   install -m 644 deploy/sjcos-inbox-drafts.service deploy/sjcos-inbox-drafts.timer ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now sjcos-inbox-drafts.timer
   ```

   Timer: `OnCalendar=*:7/10` (offset from first-response). Script reads the
   app's CRON_SECRET and calls the cron endpoint. This lane never installed or
   invoked these files, touched systemd, or contacted any live service.
4. Wire the hook into the inbox in the next UI round. Coordinator visual checks:
   Settings AI controls, suggestion stays separate until accepted, two-device
   save/conflict/discard/send behavior, offline fallback, mailbox/thread switch.

## Lane verification

All checks used stubs; no live DB, Gmail, model, website, server, browser or
systemd calls. Each test file ran individually with `nice -n 19 node --test`:

- `tests/inbox-autodraft.test.mjs`: 9 passed.
- `tests/inbox-drafts-actions.test.mjs`: 7 passed.
- `tests/inbox-draft-sync.test.mjs`: 10 passed.
- `tests/inbox-drafts-contract.test.mjs`: 4 passed.
- Existing `tests/inbox-gmail-load.test.mjs`: 18 passed.

`nice -n 19 npx tsc --noEmit -p .` passed after checking no competing tsc.
`node scripts/db-roles-scan.mjs --diff` reported only intentionally withheld
existing privileges; no new missing grants. `bash -n` passed for the new script.
DB-backed role tests and visual checks are intentionally left to the coordinator.
