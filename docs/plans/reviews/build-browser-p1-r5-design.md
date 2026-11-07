SCORES: design=9 completeness=9

# Browser Phase 1 — build round 5, DESIGN judge

Reviewed at HEAD `c7ce2675` (t3/browser-phase1). The changes since round 4 are:
- `bf21b4d3`: lease tokens, SSE only after join, inert ⋯ under dialogs, collapsed empty strip, keyboard prompt, duplicate private sentence removed
- `b2b599e6` + `ecb040e2`: Earlier view, UI and server `navigation.loading`
- `b45fe1fa`: QA recipes
- `e7c389c3`: audit only

Evidence:
- the 680 r4 shots in `/home/joe/qa-sjcos/browser-p1/shots/r4/`. I judged from the images; `log.json` was overwritten.
- the coordinator's full-run facts: 0 crossover, 0 overflow, 0 small targets, 0 clipped, 0 zero-height views
- the R4, R4b and R4c handoffs
- plan §1, §6.2, §6.3, §6.5, the state table (lines 2249–2300), §6.5 exit/take-over (lines 1232–1243) and resource review (lines 2695–2704)
- `components/panel/Browser*.tsx`, `components/panel/browser/*` and `components/panel/useBrowserSession.ts`

QA artifacts ignored: the repeated chat message, "QA SAMPLE", and the QA thread title showing raw state names ("Taylor · resource_review").

The round 4 UI options have all landed. Most of the missing captures are now rendered, and they are correct. Two items remain, and both have the same root cause:
- Disconnected, already known.
- **Couldn't pause, new finding:** the R4 shooter fix was not the problem; the UI itself overwrites the state.

Both are client-side recovery states, and the next 5 s detail poll overwrites them.

## Round 4 items — verified or not

| R4 item | Status | Evidence |
|---|---|---|
| R1 B5 iPad sheet | **Verified.** | The sheet opens on the Browser tab and shows "Open a website with the agent. You can watch and take over." It has an In use row reading "Abigail · Check public permit requirements for a residential… — Maple Ave kitchen · Agent is working [Watch]" and [Open browser] in the action row (B5-today-sheet-owner-w820). The staff sheet has no In use row (B5-today-sheet-staff-w360). That is correct, because staff see no other people's tasks. |
| R1 Earlier view | **Verified.** | "Loading City permits…", then the "Earlier view" label, then the kept image. Owner actions are [Take over][Stop browser][Zoom][Pause live view] (B10-earlier-view-owner-w1280). At 360 the image is followed by the phone instruction and [Stop browser][Zoom][Pause live view] (B10-earlier-view-owner-w360). The label sits outside the image, so it never covers page content. |
| R1 Resource 21 | **Verified, and my R4 expectation is retracted.** | Plan line 2702 says "person reviews ≤20 at a time". "Too many files to review at once." is not plan copy; I made it up in round 4. The page-of-20 flow is correct. Page one lists public-1…public-20 with [Allow these files once][Keep blocked][Next files] (B10-resource21-owner-w1280). Next shows public-21 alone with Allow enabled and no Next (B10-resource21-next-owner-w1280). |
| R1 Resource expired | **Verified.** | After a real 23 s wait: "These page addresses need a fresh review before they can be allowed." Allow is disabled and Keep blocked is still enabled (B10-resource-after-expiry-owner-w1280). Before expiry, Allow is enabled (B10-resource-before-expiry-*). |
| R1 Private pending text | **Verified.** | "‹ Back  Abigail's browser — Maple Ave kitchen", then "City permits" and "Waiting to show the private page…". There is no image and no buttons, and Abigail's answers are listed as plain text (B10-waiting-to-show-w820, w360, w1280). **What happens after release is broken. See Required 2.** |
| R1 Disconnected → Reconnect | **Not rendered. Ruled REQUIRED (Required 1).** | B10-disconnected_public-owner-w1280 shows "Browser is paused." [Continue][Take over][Stop browser] instead of "Connection lost. Browser paused." [Reconnect]. Private shows "Paused. The agent can't read this page." [Take over again][Open a fresh browser][Stop browser] (B10-disconnected_private-after-reconnect-owner-w820). The fixture doc itself says "normal 5s status polling can replace a transient error" (QA-FIXTURE line 244). That polling behaviour is the defect, not a timing problem with the fixture. |
| R1 Couldn't pause | **Not rendered. REQUIRED (Required 1).** | Take over → ‹ Chat → Pause and return with a signed 503 lands on "You're in control on your other device." [Take over here][Stop browser] (B10-couldnt-pause-owner-w820 and staff-w1280). The B8 409 variant lands there too. That message is false: the person is on the same device that just failed to pause. Root cause is in the code, below. |
| R1 Compact keyboard row | **Partly.** | B2-keyboard-owner-w820 shows the standard controlling layout. The keyboard box now has the visible "Type here to send keys to the page.", "Keys go to the website · Esc to stop", Type it, and [Done][Stop browser][Zoom][Pause live view][Keyboard]. The compact row (`data-browser-compact-capture`) only appears in landscape or with a soft keyboard showing, and there is no land800 keyboard shot. It is optional now (see Optional) because its logic is unit-tested and it adds no new copy. |
| R1 Owner queued / queue expired | **Queue expired verified; owner queued partly.** | Removing the events-503 artifact fixed queue expired. "You left the line after 5 minutes." [Get back in line], with the row "Browser · You left the line. ›" (A-queue_expired-owner-w1280). Staff queued reads "Browser is busy. You're number 2 in line." [Leave line] (A-queued-staff-w360). Owner queued reads only "Browser is busy." (A-queued-owner-w360). See Required 3. |
| Opt: empty Sites heading | **Verified.** | "Add at least one site to start." is the heading, with no duplicate line under the address field (B3-sites-staff-w360). |
| Opt: ⋯ under dialogs | **Verified at 1280 and in fresh/takeover.** | No ⋯ appears in B2-fresh-dialog-owner-w820 or B2-leave-dialog-staff-w1280. **Exception:** B2-leave-dialog-owner-w820 still draws ⋯ at top right. See Optional. |
| Opt: empty strip | **Verified.** | Dialog buttons sit at the pane bottom with no extra top rule or empty band (B2-fresh-dialog-owner-w820, B2-leave-dialog-owner-w820, B3-sites-staff-w360). |
| Opt: keyboard prompt | **Verified.** | B2-keyboard-owner-w820. |
| Opt: paused-private duplicate | **Verified.** | Only "Paused. The agent can't read this page." remains (B10-disconnected_private-after-reconnect-owner-w820). |

## Root cause shared by Required 1

- `useBrowserSession.ts:126` patches `state:'disconnected'` when the stream ends. `:189` patches `state:'pause_failed'` when `confirm_leave`/`retry_pause` throws.
- Both are local overlays. `apply()` recomputes `state` from server detail on every poll (`:51`), and nothing in that expression keeps a local recovery state. The presence/detail poll keeps running after the stream drops, so the overlay disappears within about 5 s.
- `perform()` also clears `token.current=null` **before** sending the pause (`:136`). When the pause fails, the server still reports `control==='person'`, but there is no token any more. `browserModel` (`browser/model.ts:31`) then derives `other_device`. So the person who was in control is told their control is "on your other device".
- Plan line 1240 says: "Service failure: 'Couldn't pause the browser. Keep this screen open, or stop the browser.' [Try again] [Stop browser]; no silent unmount/control transfer." The current behaviour is a silent control transfer, as far as the UI is concerned.

## REQUIRED fixes

1. **Keep "Connection lost" and "Couldn't pause" on screen until the person acts.** Affected screenshots: B10-disconnected_public-*, B10-disconnected_private-*, B10-couldnt-pause-*, B8-couldnt-pause-*. This is the coordinator's queued finding, ruled REQUIRED, together with the pause-failed case that shares its cause.
   - **(a) Add a hold.** In `useBrowserSession.ts`, add `const recovery=useRef<'disconnected'|'pause_failed'|null>(null)`.
     - Set it next to `patch({state:'disconnected'})` (`:126`).
     - Set it next to `patch({state:'pause_failed',…})` (`:189`).
   - **(b) Respect the hold in `apply()`.** At `:51`, before the derived fallback, add: `recovery.current&&d.task.state!=='closed'&&d.task.state!=='failed'&&d.pending_action?.state!=='pending'?recovery.current:…`.
     - Copy must stay exactly "Connection lost. Browser paused." / "Couldn't pause the browser. Keep this screen open, or stop the browser."
     - Actions must stay [Reconnect] / [Try again][Stop browser] (`BrowserView.tsx:50–51`).
     - Closed, failed and a real pending review still win.
   - **(c) Clear the hold** only in these cases:
     - Reconnect is clicked (`:182`, before `rejoin`).
     - `retry_pause` succeeds.
     - `stop` succeeds.
     - A successful take_over/fresh_browser happens.
     - The task id changes.
   - **(d) Keep control on a failed pause.** In `perform()` (`:136`), keep `const held=token.current` and don't clear the token for `action==='pause'` until the control call resolves. In the `confirm_leave`/`retry_pause` catch (`:189`), restore `token.current=held` when the reloaded detail still has `control==='person'` and the same `control_epoch`. Input stays disabled while `pause_failed` shows (the action row only offers Try again / Stop browser). Only the false "other device" copy and the lost token are removed.
   - **Recapture:**
     - B10-disconnected_public: "Connection lost. Browser paused." [Reconnect]. After Reconnect: "Connected. Review the page before continuing." [Resume][Take over][Stop browser].
     - B10-disconnected_private: after Reconnect, [Take over again] and no Resume at 820/1280. No Take over at 360.
     - B10-couldnt-pause: "Couldn't pause the browser. Keep this screen open, or stop the browser." [Try again][Stop browser].
     - For each, take one more shot ≥6 s later to prove polling no longer replaces it.
   - **Regression:** in `tests/browser-ui.test.mjs`, drop the stream (and, separately, reject the pause control), advance through two detail polls, then assert the state and copy are unchanged. For pause, also assert the state is not `other_device`.

2. **Owner private Watch: releasing the audit ends in "Couldn't connect to the browser."** Affected screenshots: B10-shown-after-release-w360, w820, w1280.
   - The run: staff takes over → owner Watch → [Show the page] → "Waiting to show the private page…" (correct) → `touch release-audit` → after 5.5 s the owner sees "Couldn't connect to the browser." [Try again][Close] instead of the private image with "Private — only you and Abigail see this page."
   - The already-authorized path does render the image (B4-controlling-private-image-*), so only the held → authorized transition fails.
   - Check whether the SSE open that fires when `privateViewStatus` flips to `authorized` (stream effect, `useBrowserSession.ts:113`, deps include `model.privateViewStatus`) hits a refusal that `failure()` maps to `service_unavailable`. That would be a viewer/stream binding that is stale against the consent re-join from `show_private`, `:184`.
   - **Fix:**
     - If the cause is the UI, open the stream only with the viewer returned by the `show_private` join, and treat a refusal of a not-yet-authorized stream as staying "Waiting to show the private page…", not as a fatal error.
     - If the cause is the fixture's audit ACK timing, record that in the QA fixture doc and shoot after ≥2 polls (≥11 s).
   - **Recapture** B10-shown-after-release at 360/820/1280 showing the private image and "Private — only you and Abigail see this page." Joe must never see "Couldn't connect" for a normal audit delay.

3. **Owner queued never shows who holds the browser.** Affected screenshot: A-queued-owner-w360 ("Browser is busy." [Leave line]).
   - Plan line 499 says Joe sees "Browser is busy. Abigail is using it." and the In use list. The code supports this: `browser/model.ts:16` and `lib/browser/web.ts:135` `busy_with_label` for the owner. But the fixture's holder is not a starting/active/paused task with a named initiator, so the label comes back null.
   - Seed the owner-queued case with Abigail's task active, then recapture A-queued-owner at 360/1280. Expect "Browser is busy. Abigail is using it." and, where the pane shows it, the In use row with [Watch].
   - Also fix the fallback in `browser/model.ts:16`. When the label is null, use the queue position instead of the bare sentence: `m.busyWithLabel?…:m.queuePosition?`Browser is busy. You're number ${m.queuePosition} in line.`:'Browser is busy.'`. With that change the owner is never shown less than staff are.

## Optional

- **⋯ under the leave dialog at 820** (B2-leave-dialog-owner-w820). ⋯ still shows at top right, while the same dialog at 1280 (staff) and the fresh dialog at 820 have none. `BrowserView.tsx:81` already gates on `!m.dialog`, so the title slot is probably not re-rendering when `beforeLeave` patches `dialog:'leave'` in docked-iPad layout. It may also be a different header instance. Check this once in the recapture. Fix it only if it reproduces.
- **Compact keyboard row.** Add one `B2-keyboard-owner-land800` shot showing `[data-browser-compact-capture="true"]`, "· You're in control" and [Done] in the title row.
- **Count line on paged file reviews.** A line under "This page needs these files" such as "Files 1–20 of 21" (or "21 of 21" on the next page) tells Joe there is more before he decides. The pages read correctly without it.
- **Page loading "Stop loading"** (§6.5 line 2254). Still absent because there is no guarded server control (raised in R2). Keep it on the Phase 2 list.
- **Carried from earlier rounds:**
  - "You paused the agent." for the owner's own pause.
  - `size-5` checkboxes in Settings.
  - The QA fake site label should return the host.

## Expected absences, confirmed correct

- No replace dialog when nobody controls the task or on phones.
- No Pause agent while a person is in control.
- No Operator pill on docked desktop.
- No In use row for staff (B5-today-sheet-staff-w360).
- No Take over on phones in the private reconnect case.
