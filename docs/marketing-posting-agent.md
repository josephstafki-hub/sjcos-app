# Marketing posting agent (A17)

Joe's rule (2026-10-30): no paid social APIs. /marketing drafts the posts. Joe either posts one by
hand (Copy, Download the photos, Mark posted) or approves it and **the posting agent** puts it up on his
Facebook page, Instagram or Google Business Profile, through a browser on this server that Joe
signed in to himself.

## What Joe does

1. **Once:** on /marketing › **Posting accounts**, enter the Facebook page link, the Instagram account
   and the Google Business name. Then press **Sign in** for each site. A live picture of the posting
   browser opens. Click into it and sign in as usual, codes and all, then press **Done**. The browser
   stays signed in.
2. **Per post:** on a social draft, tick **OK to share** on the photos the client agreed to share. Tick
   **In post** on the ones that go with this post. Pick **Where to?** (one site per draft), then
   **Ask to post**.
3. **Approve** the card: on the draft itself (**Approve & post**), on /engine/decisions or on Telegram.
   It's the existing `publish_marketing` card. It covers exactly that text, those photos and that site.
4. The draft shows **posting…**, then **posted** with **See the post**. If it didn't go up it shows
   **not posted** and why, with **Try again**. If the agent pressed Post but couldn't confirm it, the
   draft shows **check it** with the agent's screenshots. Joe looks at the site and presses **It's up**
   (with the link) or **It isn't up**.

To stop all posting, pause the **publication** lane (/engine/decisions). Queued posts wait.

## How it works

```
draft ─Ask to post→ publish_marketing card ─Approve→ queueApprovedPublication
   → action_intents kind 'publication' (decision attached; lane 'publication')
   → dispatcher: lane open? approval still valid? → spends the approval
   → publisher provider: starts ONE systemd unit (MemoryMax 3G, 25 min)
        scripts/run-publication.mjs --intent <id>
          journal first · re-check approval, text and photo rights · daily $ cap
          take the browser lock · copy the approved photos out of uploads/
          claude -p  (only MCP server: mcp/publisher-browser.mjs; no other tools)
          close the journal (posted + link / not posted + why / unsure)
   → dispatcher reconcile (2-min timer) reads the journal
        posted → draft 'posted', posted_url, bell "Posted to …"
        never pressed Post → draft 'failed', bell; Joe can Try again (his click = authority)
        pressed Post, no clear answer → stays open; Joe says It's up / It isn't up
```

| Piece | File |
|---|---|
| Platforms, limits (Instagram needs a photo; Google: 1 photo, 1500 characters) | `lib/marketing-types.ts` |
| Card, queue, run-time check, Try again, Joe's answer | `lib/closeout/marketing.ts` |
| Dispatcher kind and effect | `lib/dispatch/kinds.ts`, `lib/dispatch/effects.ts` (`publication`) |
| Provider (start the run, read its journal) | `lib/providers/publisher.ts` |
| Browser places, lock, journal, verdicts | `lib/publisher/core.ts` |
| Launching the browser | `lib/publisher/browser.mjs` |
| The posting run | `scripts/run-publication.mjs` |
| The agent's only tools | `mcp/publisher-browser.mjs` |
| Joe's sign-in window | `scripts/publisher-browser.mjs`, `app/api/marketing/signin/*` |
| Approve / decline hooks, Next glue | `lib/decisions/after-approval.ts`, `lib/publisher/server.ts` |
| /marketing UI | `components/marketing/PostingPanel.tsx`, `PostingAccounts.tsx` |
| Migration | `db/migrations/0056_marketing_publication.sql` |

## Safety: what stops a wrong post

- **Nothing goes up without Joe's approval.** The intent carries the card's decision, and the dispatcher
  spends it only if the text, photos and site still hash to what he approved. The run checks again
  before it opens the browser (`checkPublicationRun`): the approval was spent on this send and never
  given back, the draft is unchanged, and it is the draft's current send. Editing a post retires its
  waiting card. Edits are refused while a post is on its way.
- **No photo without a publication right.** Photos are picked only from ones with a live right on that
  job. The right is re-checked when the card is staged, when it's queued and when the run starts.
  Unticking OK to share withdraws the right, cancels a queued post and takes the photo off any post
  that hasn't gone out.
- **The agent can't write anything else.** Its tools: snapshot, screenshot, click, scroll, a few
  navigation keys, open a page on that site only, `fill_approved_text` (types exactly the approved
  text and reads it back), `upload_photos` (exactly the approved files) and `submit_post`. There is
  no free typing, so it can't enter a password, a comment or a reply, whatever a page says. Clicks
  on Delete / Remove / Log out / Block / Report are refused. The final Post / Share / Publish
  button only works through `submit_post`, once per run, after the text and photos are in.
  The CLI runs `--restricted --strict-mcp-config --tools ToolSearch` with no Bash, files, web or SJC
  OS tools. A smoke run (2026-10-30) showed exactly ToolSearch plus the 12 publisher tools.
- **Never posts twice.** The journal records "pressed Post" (fsynced) before the click. A run that
  dies after that is never retried by itself; Joe looks. The provider never starts a second run for
  an intent that has a journal. Try again is offered only when the run never pressed Post, or when
  Joe said it isn't up.
- **Signed out = stop.** A sign-in or "confirm it's you" page ends the run as *not posted: needs
  sign-in*. Joe signs in again, then presses Try again.

## Where the browser lives and how it signs in

- One Chromium profile: `~/.local/share/sjcos-publisher/profile` (0700). It sits outside the repo,
  the uploads and the backups. Override the location with `SJC_PUBLISHER_DIR`.
- **Joe signs in himself** in the sign-in window. That is a picture of the real browser on the
  server, refreshed about twice a second, with his clicks and keys relayed over a 0600 unix socket
  (`signin.sock`). Owner only. SJC OS never stores or logs what he types, and no password is kept in
  the database or env. The sites' own cookies stay in the profile. If the server is lost, Joe signs
  in again. That's why the profile is not in the backups.
- The browser is the full Chromium in new-headless mode with an ordinary desktop Chrome user agent,
  the same for sign-in and posting. Facebook, Instagram and Google see one consistent browser from
  Joe's own server IP.
- **One browser at a time:** `browser.lock` names the holder (the sign-in window or a posting run).
  A post waits up to 90 s for a sign-in to finish. Otherwise it fails without posting, and the
  provider retries busy starts every 5 minutes. A lock whose process is gone is taken over.
- Limits (box rules): posting run `MemoryMax=3G`, 25 min; sign-in window `MemoryMax=2G`, 30 min, and it
  closes after 5 idle minutes. Both are `Restart=no` transient units (`sjcos-publish-<id>`,
  `sjcos-publisher-signin`). Nothing stays running.
- Cost: model `SJC_PUBLISHER_MODEL` (default `sonnet`), `--max-budget-usd 3`, 70 turns, 18 min. Each run
  is an `agent_executions` row (`trigger_kind = 'publication'`), so it counts toward the agents' daily
  dollar cap, and the run refuses to start once the cap is reached.
- Old run folders (journals and screenshots) are pruned after 120 days.

## Deploy (not done; Joe's OK first)

1. `node db/migrate.mjs` applies **0056** (additive only).
2. In the live checkout, `npm ci` (adds `playwright-core` 1.61.1, which matches the Chromium 1228 already
   in `~/.cache/ms-playwright`). If the cache is ever cleared: `npx playwright-core install chromium`.
3. Build with `SJC_DIST_DIR`, restart `sjcos.service` and `sjcos-worker` (dispatch runs inside the app).
4. Joe fills in Posting accounts and signs in to each site, then sends one test post.

Not built yet: an MCP tool for agents to stage a marketing post (today the card is staged from
/marketing); posting blog posts to the website; one card covering several sites (each site is its own
draft, since each takes different text).
