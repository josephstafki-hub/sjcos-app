SCORES: design=6 completeness=6

# Phone alerts — build round 2, DESIGN judge

Phone repo `sjcos-mobile` @ 70c9a28 (worktree `~/.t3/worktrees/sjcos-mobile-push`), backend `sjcos-app` @ 263c5260.
Screenshots: `~/qa-sjcos/mobile/shots/push-r2/` (all 27 read). Payloads: `~/qa-sjcos/mobile/push-payloads-r1/`.
QA markers (`[QA c1697aa4]`, `qa-phone-seed asks:`), seed titles (`long_multibyte_draft`, `draft_approve_and_send`) and the dev gear are ignored as instructed.

**Verdict.** The structure is right and the app's look holds: the Today intro card, the feed's "Waiting on you" cards with their button sets, the outcome chips and the portal conversation are all of the house standard. Four things keep it well below 9. They are also where Joe would say "Telegram did this better":

1. **The lock screen no longer says what an alert is about.** R1 made every APNs title the literal `SJC OS` (`lib/providers/apns.ts:22`). The privacy goal was already met on the phone: categories now set `showTitle:false` (`src/lib/push/categories.ts:76`), so hidden previews show the placeholder and nothing else. What the generic title did was remove the only line that names the alert. 40/42/43 show "SJC OS" over "To: client@example.com / Includes: …", "A client payment of $2,500 was recorded." (no client), and "Could we use the warmer oak finish?" (no sender). Telegram led every card with `[SJC OS] Decision: <title>`.
2. **Text written for Telegram reaches the app unchanged.** Raw `https://os.sjcarpentryllc.com/engine/decisions?d=<uuid>` URLs, `Expires: 2026-11-12 12:49`, `Grant id: a1d38751-…`, `[SJC OS] Claude on "…"\nQuestion: …`, "Reply to this message to answer Client B…", and `Status: rejected via app at …` all appear in the feed, on the lock screen and in the thread.
3. **The thread draws Joe's own note as an "SJC OS" bubble on the left** (30). The system's acknowledgement and the agent's question are both labelled "SJC OS" in the same tan bubble. Who said what, the core of a conversation view, is wrong.
4. **History rows are cramped and inconsistent.** The outcome chip takes the trailing column, so titles squeeze to "[QA c1697aa…". Times move left on chipped rows, the chevron disappears on those rows, and "Handled" stands in for "Approved" or "Sent".

Settings adds a well-built section. But the new "Phone alerts" sits under an old "Notify me" list whose switches nothing on the server reads, and the stuck "Signing this phone up…" state has no way out.

## Per-screen table

| Screen (shot) | Design | Completeness vs Telegram | Notes |
|---|---|---|---|
| Today intro card (01) | 9 | n/a | Clear title, plain body, quiet-hours footnote, one primary + "Not now". Good. |
| iOS prompt (02) / after allow (03) | 8.5 | n/a | Card leaves cleanly. No visible confirmation in 03 (a toast is coded at `push-intro-card.tsx:25` but isn't in the shot). |
| Settings › Notify me (10 p1–p2) | 6 | — | Six switches that **nothing reads** (`notify.*` keys have no consumer outside `lib/settings.ts` / `lib/actions/settings.ts`), right above the real alert controls. Joe will turn "Money" off and still get payment alerts. |
| Settings › Phone alerts (10 p2–p3, 11) | 6.5 | 8 | Row and test row are fine. The switch is off while the subtitle says "Signing this phone up…", forever, with no retry. "App: connected" describes the server's Apple key, not this phone, and it sits right under a switch that is off. "Both" is selected while Telegram is "not connected", with nothing saying what that means. The caption is inset 38px against 47px for every other footnote. |
| Settings › Quiet hours (10 p3–p4) | 8.5 | 9 | Clear rule text. Read-only is fine (Telegram's was fixed too). |
| Settings › On this phone › Notifications (10 p4) | 7 | — | A third "notifications" entry ("Approvals, payments and mentions") next to Notify me and Phone alerts. Rename it so the three don't blur. |
| Feed › Waiting on you cards (20 p1–p7) | 5.5 | 7 | Button hierarchy is right (full-width primary; Decline destructive-tinted; Change…/Hold secondary) and the sets match Telegram per type. But decision and permission bodies show raw URLs, machine dates, "Grant id: uuid", "Includes: To: … <…>;…", "Assumptions: Agent's reason:", and "If approved: Approving does it now:". Eyebrow says DECISION on a draft email and on a permission. "Approve: " is repeated in titles above an Approve button. "Open alert" is a stray text link. The STILL WAITING card doesn't say which draft or what Approve does. |
| Feed › Today history (20 p7–p10) | 5.5 | 7 | Chip in the trailing column truncates titles to 1–2 words. Time column misaligned (x≈672 / 550 / 404). No chevron on chipped rows. "Handled" for approved or sent items. "Includes: …" as a preview line. "Decision" detail repeated on every row. p11/p12 are byte-identical to p10. |
| Thread › changes requested (30) | 4.5 | 6 | Joe's note is drawn as SJC OS (left, tan). System ack and agent question look identical. Ack copy is jargon ("No chat is attached to that request, so the operating agent takes your note"). Agent line keeps the Telegram prefix `[SJC OS] Claude on "…"\nQuestion:`. Header card keeps a big "Reply" button **and** the composer below. p1 and p2 are identical, so the top of the decided card (where the body's `Status: rejected via app …` + URL sit) was never captured. |
| Thread › portal (31) | 7.5 | 8.5 | Good: "You" bubble right, ack below, portal placeholder. Wrong: meta says "Waiting on you" though Joe already answered (feed says "Answered"). Body still carries "Reply to this message to answer Client B in the portal." Duplicate Reply button + composer. |
| Banners (40, 41) | 4 | 4 | Title is "SJC OS" on both. Decision banner opens with "To: client…". Portal banner doesn't say who wrote. |
| Notification Center / lock stack (42, 43, 44) | 4 | 4 | Same. The agent question leads with `[SJC OS] Claude on "[…]"`. The payment doesn't name the job. Swipe shows only "Open" (expected for a swipe; long-press actions judged from code). |
| Lock-screen action sets (code) | 8 | 8.5 | Approve/Change/Decline/Hold match Telegram, Decline destructive, Face ID on approve and decline, text inputs with good placeholders. Gaps: Approve on a decision or permission that emails a client says only "Approve" (in-app says "Approve & send"). "Request changes" on decisions vs "Change…" on drafts and in-app. |

## REQUIRED fixes

1. **Put the real title back on the lock screen** (backend). `sjcos-app lib/providers/apns.ts:22`: `alert:{title:'SJC OS',body:m.body??''}` → `alert:{title:m.title,body:m.body??''}`. Hidden previews stay private because the phone already registers every category with `showTitle:false, showSubtitle:false` and a placeholder (`sjcos-mobile src/lib/push/categories.ts:65-77`). Update `docs/mobile-api/push.md:20` to say so. Also keep the alert's titles short and specific: `lib/notify-owner.ts:415,420` `title: \`Approve: ${title}\`` → `title` alone (the category's button already says Approve). Payment and contract alerts must name the job in the title, e.g. "Payment received · Client A kitchen" and "Contract signed · Client A kitchen" (payments/owner-alert.ts and actions/esign.ts callers).
2. **No Telegram link, machine date or status line in app text** (backend). `lib/decisions/notify.ts:42` `cardText(d, { appUrl: appUrl() })` → `cardText(d)`; same at `:79`. The href is already appended once for Telegram by `pushText` (`lib/notify-owner.ts:182`), so Telegram currently shows the link twice. `lib/decisions/cards.ts:193`: `Expires: ${d.expires_at.slice(0,16).replace("T"," ")}` → a Central-time phrase, e.g. `Expires Thu, Nov 12 at 12:49 pm`, using the same formatter the hold line uses. Also give `cardText` an `{app:true}` option that omits the `Status:` line (`cards.ts:190-191`). The app shows the outcome chip and note, and that line reads "rejected" when Joe asked for changes.
3. **Drop ids and bookkeeping labels from decision and permission bodies** (backend). `lib/decisions/summary.ts:119-123`: skip keys that are ids (`/(^id$|Id$|_id$)/`), so `grantId` stops rendering as "Grant id: <uuid>". In `lib/decisions/grants.ts`:
   - `:40`: `Approving does it now: ${…} Nothing else is needed from the agent.` → `${…}` (the line is already labelled "If approved:").
   - `:69`: `` `Agent's reason: ${g.reason}` `` → `g.reason` under the label "Why".
   - `:66`: don't push a `To: … ; Subject: …` inclusion when recipients and subject are already shown.
   Target for the permission card: `To: Client A · Subject: Confirm installation / <message> / Why: … / If approved: Sends the email to client@example.com.`
4. **Agent and system messages in plain words, with an author** (backend + phone).
   - Backend `lib/owner-reply-delivery.ts:238`: keep the Telegram text, but call `recordAppMessage` with `title: \`${agentLabel(input.agent)} ${lead === "Question" ? "has a question" : lead === "No change" ? "made no change" : "is done"}\``, `body: text`, `from: 'agent'`.
   - `:46`: mirror acks with `from: 'system'`.
   - Add a `from: 'owner'|'agent'|'system'` column/field to `owner_push_messages` and the messages API. `owner-actions.ts:62,77,138,146` set `'owner'`.
   - Ack copy `:171`: `No chat is attached to that request, so the operating agent takes your note (within a few minutes). Its answer comes here.` → `Got it. I pulled "<title>" back. An agent will pick up your note in a few minutes, and its answer will show up here.`
   - Phone `src/lib/push/actions.ts:179`: delete `!m.ownerReplyId &&`. Joe's note via Change… has `ownerReplyId` and is drawn as SJC OS today (shot 30).
   - Phone `src/components/alerts/alert-thread.tsx:175`: `name={who === "you" ? "You" : "SJC OS"}` → `"You"` / the agent's name from the message (`"Claude"`, `"Hermes"`). System lines already render as a centred footnote at `:164-169` once `from:'system'` arrives.
5. **One reply affordance in the thread.** `src/components/alerts/alert-parts.tsx:65`: `const reply = m.state !== "open" ? replyButtonFor(m) : null;` → `const reply = m.state !== "open" && !full ? replyButtonFor(m) : null;`. The composer below is the reply in the conversation view (shots 30, 31).
6. **The thread's header state must match the feed.** In 31, "Waiting on you" shows after Joe answered, because the thread root carries no `replies`. `alert-thread.tsx:139`: pass `{...m, replies: thread}` (or the count) into `AlertCard` so `stateLabel` (`actions.ts:195`) returns "Answered".
7. **Portal body without Telegram instructions** (backend). `lib/notify-owner.ts:459`: `body: \`${shown}\n\nReply to this message to answer ${first} in the portal.\`` → `body: shown`, and append the hint only in the Telegram text (`deliverChannels`/`pushText` when `telegram.portalChannelKey` is set). On the phone the lock-screen "Reply" action and the in-app composer already say it.
8. **History rows: chip under the text, consistent trailing column.** `src/components/alerts/alert-parts.tsx:176-182`: remove `accessory={…Chip…}`, set `chevron` always true, and render `<Chip label={state.label} tone={state.tone} size="sm" />` as the row's `children` (ListRow draws children full-width below the text, `src/components/ui/list.tsx:93,339`). Drop `kindLabel` from `detail` for decision kinds (every row says "Decision"). Keep `detail` for "1 reply". The time then sits at the same x on every row, and titles get their full width.
9. **Outcome words say what happened** (backend + phone). `db/migrations/0092_phone_push.sql:68` (unapplied in prod, so it can still be edited): `COALESCE(d.decision_note,d.status)` → the status first, e.g. `d.status || COALESCE(' — '||d.decision_note,'')`. Same at `:72` for work items. Phone `src/lib/push/actions.ts:149-158` `outcomeLabel`:
   - add `/sent|consumed|used|done/ → "Approved"`;
   - add `/supersed|replac|newer card/ → "Replaced"`;
   - change the fallback from `"Handled"` to `"Closed"`.
   The note ("Sent to client@…") shows through `outcomeNote`. Telegram edited the card to "Approved ✓ — sent".
10. **Card eyebrow by what it is, not the raw kind.** `alert-parts.tsx:74` `eyebrow={kindLabel(m.kind)}` → key on category: `SJC_DRAFT_SEND` → "Draft to send", `SJC_DRAFT` → "Draft to approve", `SJC_GRANT` → "Permission", `SJC_DECISION` → "Decision", else `kindLabel(m.kind)`. Shots 20 p2–p6 show DECISION on two draft emails and a permission.
11. **Remove the "Open alert" link from feed cards.** `alert-parts.tsx:111-123`: make the card title pressable (`onOpenThread`). Show the link only when there are replies ("2 replies"). Every card has a stray tint link between body and buttons today, stacked under "Read all" (20 p2, p4).
12. **A "still waiting" card must say which draft and what Approve does.** STILL WAITING (20 p1) shows "This draft is still waiting for your review." above an Approve button. Backend `lib/notify-owner.ts:645-651`: give the nudge a body — the work item's draft preview (`To:` / subject / first lines) plus the same "Approve sends this email now." line `notify-owner.ts:407` uses. Use `workItemKeyboard(item.id, { sends })` so the category is `SJC_DRAFT_SEND` when it sends.
13. **Lock-screen Approve says "Approve & send" when it sends.** `src/lib/push/categories.ts:56-57`: add `SJC_DECISION_SEND` and `SJC_GRANT_SEND` with `approve("Approve & send")`, plus placeholders. Backend `lib/providers/apns.ts:15-18` `categoryFor` returns them when `sends`. Use one verb for changes everywhere: `changes("Change…")` on decisions and grants too (in-app already says "Change…" on every card, `actions.ts:103`).
14. **Settings: the "Notify me" switches must do what they say, or go.** None of `notify.decisions|money|compliance|mentions|emailDigest|sms` is read anywhere (`grep` finds only the setter). Either:
    - **(a)** gate `notifyOwner` by kind → key (decision/grant/stale_approval → `notify.decisions`; payment/contract_signed → `notify.money`; urgent compliance → `notify.compliance`) for every channel, and add footer `src/app/settings.tsx:187`: `"Turns each kind of alert off everywhere: this phone, Telegram and email."`; or
    - **(b)** hide the section on the phone until they're wired.
    As shipped, Joe will flip "Money" off directly above "Phone alerts" and still get payment alerts.
15. **Settings: the stuck sign-up state needs an exit, and the status line must be about this phone.** `src/components/alerts/push-settings-section.tsx:73`:
    - After ~15 s unregistered with no error, show `"Couldn't reach Apple yet. Tap to try again."` with the row's `onPress` retrying `push.turnOn()`.
    - While trying, show the switch **on** with `"Finishing setup…"`, not off.
    - `:157`: `"App: connected"` → `"Phone alerts: set up on the server"` / `"Phone alerts: not set up on the server yet"`.
    - When the choice is Both or Telegram and `!s.configured.telegram`, add: `"Telegram isn't connected, so alerts only come to the app."`
    - `:226`: give the `Footnote` the same horizontal inset as the other section footers (38px vs 47px in 10 p3).

## Optional

- `settings.tsx:246` "Notifications — Approvals, payments and mentions" → "Alerts and notifications — Everything SJC OS has sent you" so it doesn't read as a third settings list.
- Approval cards whose href is a job (`/projects/<slug>`) could show "Open job" (`destinationLabel` returns null for `dest.type:"approval"`). Telegram's link went to the decision; the job is more useful.
- Hold 4 hours (`categories.ts:40`) needn't require Face ID; Telegram's Hold had no gate and it changes nothing irreversible.
- Feed times "11:49 AM" vs the rest of the app's "9 pm" style. Use the house lowercase format if `formatTime` is meant to match.
- Portal title `Client B wrote in the client portal (Client A)`: the parenthetical reads like a person. Prefer `Client B · Client A job`.
- `long_multibyte_draft` body (20 p1–p2): fine. Emoji and accents render, and Read all works.

## Missing screenshots (needed for the next round)

- iPad (known).
- The top of the changes-requested thread card. 30 p1 and p2 are identical and start mid-card, so the decided body (`Status: rejected via app …` + URL) was never seen.
- Lock screen with **Show Previews: Never / When Unlocked** (the placeholder text) — the R1 privacy fix is unverified visually.
- Long-press action menus (automation failed): at least one each for SJC_DECISION, SJC_DRAFT_SEND and SJC_REPLY, on a device.
- Settings with alerts actually **on** (registered) and the "Send a test alert" toast + arriving test alert.
- After-action states: the confirm sheet for Approve & send, the toast, and the card moving from Waiting on you to history with its chip.
- "All notifications" tab, the empty Alerts feed, dark mode.
- The Today bell not navigating (INDEX note). Confirm on a TestFlight build without the dev gear; if it still doesn't open Notifications, that becomes a required fix.
- 20 p11 and p12 are byte-identical to p10 (end of list).
