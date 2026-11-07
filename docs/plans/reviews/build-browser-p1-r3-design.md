SCORES: design=7 completeness=7

# Browser Phase 1 — build round 3, DESIGN judge

Reviewed at HEAD `16d0f0f4` (t3/browser-phase1), UI fixes in `40b32792`. Evidence: the r2
screenshots `/home/joe/qa-sjcos/browser-p1/shots/r2/*.png` (593) and `log.json`, the shooter
`/home/joe/qa-sjcos/browser-p1/shoot-p1-r2.mjs`, plan §1 / §6.2 / §6.3 / §6.5 / §7 Phase 1, the
R2 UI handoff, `components/panel/Browser*.tsx` and `components/panel/browser/*`. QA artifacts
ignored as instructed: the repeated chat message, "QA SAMPLE", and events 503 in queued/offer/
expired/off. The known double-join "server is busy" (A-other_device-owner-w1280 shows the
resource-cap card from a 429 on `/join`) was not re-scored.

Big improvement since round 2. The own-task pane is now honest and calm at every width: one state
sentence, the right buttons, the image sized to the page, nothing clipped at 320, and a stage of
276 px at 800×360. One new blocker remains: **the owner's Watch view shows no page at all on a
phone or iPad portrait**. There are also a handful of copy and leftover-state bugs that show on the
blocked cards and dialogs.

## Round 2 items — verified or not

| # | Status | Evidence |
|---|---|---|
| 1 Pane and row agree | **Verified** for working / paused / controlling / done / starting / private (B2-controlling-owner-w1280 "You're in control" ↔ "You're in control. The agent is paused."; A-loading-owner-w1280 "Opening browser…" in both). The queue rows still disagree (new item 8). |
| 2 Human status words | **Verified.** "Browser · Agent is working ›", "· Paused ›", "· Needs you ›"; the row is gone after "Browser closed." (A-closed-owner-w1280). |
| 3 In use row | **Verified** ("Abigail · Check public permit … — Maple Ave kitchen · Agent is working [Watch]"; no own task, no task_kind). The label is cut mid-word (new item 7). |
| 4 One sentence per pane | **Verified** across A-*-w360 / w1280 and the owner split. |
| 5 Owner doesn't see "Taylor is watching." | **Verified** (B4-*-watch-*). The staff view shows "Taylor is watching." while the owner is joined (B4-working-staff-while-watched-w1280/w360). |
| 6 No invented owner copy | **Verified.** Status in text-heading, actions directly under it (B4-working-watch-w1280). |
| 7 Owner-paused copy | **Code verified** (`browser/model.ts`). The success state wasn't captured because the pause dialog never opened (see 12). |
| 8 Pause agent only while the agent runs | **Verified.** Shown in B4-working-watch-w1280; hidden once paused (B4-working-pause-dialog-w1280) and on the private page. |
| 9 Owner sees the site | **Verified.** The site row sits under the header (B4-*). The QA fake labels it "City permits"; production `siteHost()` gives the host. |
| 10 "Abigail's answers" | **Verified.** |
| 11 Type it only with control | **Verified** (Type it only in B2-controlling-*). Answers are hidden on blocked/blank cards. Owner-side leftover in new item 11. |
| 12 No media controls without an image | **Verified** (A-service_unavailable/queued-*: Try again / Close only). |
| 13 320 wrapping | **Verified.** Wraps to two rows, no clipped buttons in log, no horizontal overflow. |
| 14 Two-line status | **Verified.** A-unknown-owner-w360 shows the full "The site may have received it. Check the site before trying again." |
| 15 Starting → Cancel | **Verified** (A-loading-owner-w1280 renders the starting state with [Cancel] only). |
| 16 Write card exact | **Verified:** the extra sentence is gone. A different stray sentence now shows (new item 3). |
| 17 Read provenance / paging | **Verified.** "Linked from the page" under every address; 20-item page. 21 can't be seeded (SQL caps at 20); expired needs the 60 s wait the shooter skipped (see 12). |
| 18 Review page addresses is a button | **Partly.** Buttons now, and the reload copy is exact (B1-reload-dialog-*). But the menu button opens the Sites sheet (new item 5; my round 2 wording asked for `'sites'`, which was wrong). |
| 19 Who can use Browser | **Verified** (A-settings-owner-w1280): names, owner first, no IDs. The 11 "small targets" in the log are the 13 px checkbox boxes; each sits inside a 48 px label row, so the real touch target is fine (optional item). |
| 20 Attention dot | **Verified.** No squashed bar at 360. |
| 21 Owner queue copy | **Code verified**; not rendered (owner queued = events 503). |
| 22 Take over again on private reconnect | **Code verified**; not rendered (reconnected seeds a public page). |
| 23 Letterboxing / landscape | **Verified for own pane.** 16:10 box at 360/820, answers right under it; 800×360 stage 553×276 incl. idle warning, Answers collapsed. **Owner portrait regressed** (new item 1). |
| 24 Job in Sites | **Verified for the owner:** JobPicker opens, "Maple Ave kitchen" in In use and the Watch header, "This browser keeps its current job." Broken for staff (new item 4). |
| 25 Recapture with clicks | **Mostly done:** menu, reload, take-over (owner with Don't ask again, staff without), control + Keyboard + Type it, Done, fresh, Keep paused, Sites, job picker, owner Watch, Show the page → pending, staff while watched, /today sheet, staff settings refused (`/projects`). Gaps listed in item 12. |

Also correct and confirmed this round:

- **Phones are view-only.** There is no Take over at 320, 360 or 800×360 (B2-*-w360 / land800 `clicked:false` is correct). The exact §6.2 instruction is shown, and in landscape the short first sentence. The 820 iPad keeps Take over.
- **Public take-over flow:** the copy is exact at every step. Paused-private shows [Take over again] [Open a fresh browser] [Stop browser], with no Continue and no resting Keep paused (B2-kept-paused-owner-w1280).
- **Phase 1 final card** has [Close] only, and the phone write card copy is exact (A-write_blocked-owner-w360). Both still carry the stray sentence from item 3.
- **No gendered pronouns** anywhere in the Browser copy; names come from runtime labels.
- **Staff settings** redirect to `/projects` and never show "Who can use Browser" (B6-*).

## REQUIRED fixes

1. **Owner Watch shows no page on a phone or iPad portrait.** In B4-working-watch-w360, B4-working-watch-w820 and B4-controlling-watch-w360/w820, `log.json` records the live image as **352×0** and **812×0**. Joe sees "City permits / Browser is paused." over an empty column, with Zoom / Pause live view at the bottom. In B4-watch_audit_pending-watch-showpage-w360/w820, "Waiting to show the private page…" is invisible for the same reason.
   - Cause: the single-column owner branch (`BrowserOwnerLayer.tsx:21`) puts `<BrowserView slot="meta">` directly in a flex column. BrowserView's root (`BrowserView.tsx:78`) is always `h-full`, so the meta row takes the whole column and `flex-1 min-h-0` content gets 0 px.
   - Fix: give the root `h-full` only for `slot==='all'||slot==='content'||slot==='actions'` (the meta and title slots use `min-w-0` only), or wrap the meta slot in `<div className="shrink-0">` in the owner layer.
   - Re-shoot B4 at 360/820 and assert the image height is above 0 (16:10 of the width).

2. **The pane's own action row stays live under every dialog.** Two sets of the same buttons are visible:
   - B2-takeover-dialog-owner-w1280/w820: dialog [Take over][Cancel] above the row's [Take over][Stop browser][Zoom][Pause live view].
   - B2-fresh-dialog-*: [Open a fresh browser] appears twice.
   - B3-sites-*-w320…land800: the dialog's disabled [Open browser] sits above an enabled outer [Open browser].
   - B1-reload-dialog-staff-land800: Continue / Stop browser stay live beside "Reload this page?".

   The dialog is `aria-modal`, but the row is outside it and still clickable. At `BrowserView.tsx:104`, when `m.dialog` is set and `slot==='actions'`, render nothing. If the layout needs the space, render the container with `inert` and `aria-hidden`. Do the same for the owner layer's `actions` and the 128 px landscape column.

3. **Stray sentence on the blocked cards.** "These page addresses need a fresh review before they can be allowed." shows under:
   - "This version stops here. Nothing was submitted." (A-final_blocked-owner-w360 / w1280)
   - the write card on desktop (A-write_blocked-owner-w1280)
   - the write card on the phone (A-write_blocked-owner-w360)

   The plan says the final card is that sentence and [Close] **only**. At `BrowserView.tsx:89` change `{review&&m.readExpired&&…}` to `{(m.state==='read_review'||m.state==='resource_review')&&m.readExpired&&…}`. Also clear `readExpired` when the session leaves a read review.

4. **Staff can't choose a job.** B3-jobpicker-staff-w320/w360/w820/land800: "Couldn't load projects. [Try again]" every time, although QA Abigail has Projects access. `BrowserJobField.tsx:7` uses JobPicker's default search, `searchJobsAction`, which refuses non-owners (`lib/actions/ai-chat.ts:377`). Pass JobPicker's existing `search` prop a Browser-only server action in `BrowserIdentity.tsx`. It should check `can(user,'projects')` and return projects only (id, slug, name), never leads, vendors or subs. For a person without Projects access, show "No job" without the ▾ and without a button.

5. **The ⋯ menu's "Review page addresses" opens the wrong sheet.** B1-review-addresses-*: clicking it shows "This task can use these sites." (the Sites sheet with Job / Page address / Add a site), so the label doesn't match the result. At `BrowserView.tsx:65` change `act('Review page addresses','sites')` to `act('Review page addresses','review_addresses')`. That opens the "Review page addresses" list, or read review when candidates are pending. My round 2 instruction named `'sites'`; this corrects it.

6. **The new-task Sites sheet offers review with nothing to review.** B3-sites-owner-w320 / staff-w360 / owner-land800 show "Pages this task may read" over an empty list. Then [Review page addresses] (it opens "No page addresses to review.") appears **above** the Page address field the person hasn't filled in yet.
   - At `BrowserView.tsx:71`, render the "Pages this task may read" heading, its list and [Review page addresses] only when `(m.approvedReadUrls??m.readUrls)?.length`.
   - Keep the plan's order: purpose ("What should the agent read?"), Job, sites, Page address, then the review button.

7. **The In use label is cut mid-word.** "Check public permit requirements for a residential alteratio — Maple Ave kitchen" (A-empty-owner-w360, B5-today-owner-w360, A-sites_empty-owner-w1280). `lib/browser/web.ts:48` does `.slice(0,60)`. Cut at the last space at or before 60 characters and add "…". The row already wraps, so 80 is also fine.

8. **The chat row still contradicts the pane in queue states.** A-offer_expired-staff-w1280: the row says "Browser · Browser is busy." and the pane says "You missed your turn." A-queue_expired-staff-w1280 has the same problem. At `useBrowserSession.ts:142` add:
   - `stateLabel`: offer → "Browser is ready.", offer_expired → "You missed your turn.", queue_expired → "You left the line."
   - attention `needs_you` for both expired states, since the person must act.
   - The `failed` row word: use "Stopped", not "Browser stopped.", so the row doesn't read "Browser · Browser stopped." (A-access_removed/crashed/latched-owner-w1280).

9. **Separators start a line with nothing before them.** "· 2 windows" sits alone above "Read this page?" (A-exact_path_review-owner-w360/w1280, A-exact_resource_review-*). "Browser is paused. / · 2 windows" wraps in A-reload_confirm-owner-w360. "· Taylor is watching." starts its own line in B4-working-staff-while-watched-w360. At `BrowserView.tsx:80`, build the parts array `[hasImage&&status, watching&&`${m.ownerName} is watching.`, twoWindows&&'2 windows']` and join only the present parts with " · ". Keep the plan's order (state · Joe is watching. · 2 windows). On a review card, drop "2 windows" (it stays in ⋯).

10. **Owner header spacing.** Every owner shot reads "‹ Back· Abigail's browser — Maple Ave kitchen". At 360 the title wraps under the Back button (B4-working-watch-w360). At `BrowserOwnerLayer.tsx:19` drop the leading " · " in the span. Give the header `gap-2` and let the title `<span>` wrap on its own line box: "‹ Back" then "Abigail's browser — Maple Ave kitchen".

11. **Owner Watch says "Take over to type these." when no Take over is offered.** This happens before Show the page (B4-watch_audit_pending-watch-w1280) and while waiting (B4-watch_audit_pending-watch-showpage-w1280). At `BrowserView.tsx:21`, render that line only when a Take over button is actually rendered in this view: not `m.phone`, not `privateHidden`, not pending, and `take_over` in `availableControls`. Otherwise show the plain answers list.

12. **Completeness: capture what the r2 run didn't reach.** Use exact selectors scoped to `[data-browser-ui]`, keep the owner joined where needed, and assert dialog names from the handoff table:
    - Leave confirm: click ‹ Chat **while in control** (B2 clicked it after Keep paused, so it correctly went straight to Chat). At 1280 use the pane ×.
    - Owner Pause agent confirm → "Agent paused. Abigail can tap Continue." needs a staff viewer attending so the task stays active. All B4 pause shots were already paused.
    - Replace confirm "Take over from Abigail? Their control ends." and "You're watching. Abigail is in control." need staff to take control first. B4 "controlling" rendered "Agent is working".
    - The authorized private image "Private — only you and Abigail see this page." The fixture stays pending.
    - Loading with "Earlier view", disconnected → reconnected (public Resume and private Take over again), pause_failed, compact keyboard row, owner queued (21), owner queue/offer expired, and resource_expired after the 60 s wait.
      - A-offer/queue_expired-owner show "Your access changed. Browser stopped." from a 403. Find out whether this is the seed. If it is the app, an expired queue must never say access changed.
    - B3 at 1280: `/Open browser|Start|Sites/` matched another button first (no dialog in log). Use `getByRole('button',{name:'Open browser',exact:true})` inside `[data-browser-ui]`.
    - B5 820 `/today` sheet: the Operator pill wasn't clicked.
    - Re-shoot B4 at 360/820 after item 1.

## Optional

- **Own pane, owner-paused own task:** A-owner_paused-owner-w360/w1280 shows "Taylor paused the agent." to Taylor. When `paused_by_user_id` is the viewer, say "You paused the agent.".
- **Settings checkboxes:** add `size-5` (20 px) so the box is easier to see. The 48 px label already meets the target.
- **Read/resource review:** a count line ("20 files") helps on a long list (B7-resource_20-owner-w360).
- **iPad own pane** (A-working-owner-w820): the actions sit about 450 px below the answers. Consider keeping the action row just under the content when the content is short.
- **Sites "Add a site" when disabled:** pair the disabled button with "Use an https website address." beside it, not only under the field (B1-review-addresses-owner-w320).
- **QA fake site label:** have the fake controller return the host ("city.example"), as production `siteHost()` does, so the title and owner site row show the real trusted form in shots.
