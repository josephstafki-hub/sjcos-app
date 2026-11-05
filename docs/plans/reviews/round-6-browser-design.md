SCORES: design=9 completeness=9

# Round 6 — Design & UX judge — in-app agent browser (`agent-browser-plan.md`)

I judged committed HEAD `61237edf`, which is where the Browser plan was last changed. Host `_ask-pane-host.md` is unchanged at `85a7a5c6`, which the plan adopts. In `ask-canvas-plan.md` only one pronoun changed (`febc1e26`). I ignored the Codex builder's uncommitted `components/panel/*` and `tests/*` edits.

I read the plan against:
- the context file
- my round-5 review
- the "Round-5 fixes" appendix
- `git diff 3f309aac..HEAD`
- host H1–H5, including H3's short-landscape shell and its 800 × 360 fixture row
- Canvas §3.1 / §6.5, the floor hint rule

I also looked at `/home/joe/sjcos-mobile/app.json` (read-only). It sets `supportsTablet: true`, so the native app runs on Joe's iPad.

## Round-5 items: verified / not fixed

All 3 are **verified fixed**.

| # | Status | Where / note |
|---|---|---|
| 1 800 × 360 landscape frames | **Verified.** Three frames are drawn: own task viewing, Joe's own review (plus the staff waiting variant), and the owner layer on a staff task (review, Watch before Show the page, Watch after it). Each has a 48/20 center, a 128 px right column, decisions pinned outside the card scroll, ⋯ for guarded ‹ / › / Reload, Saved logins and the window switch, and "· 2 windows" in the meta row. The owner layer has no strip or selector and one full-width "‹ Back · Abigail's browser · Larson bath" header. The budgets add up: 360−48−20−8−80 = 204; columns 268/272, 256/272 and 204 or 216/224. The 44 px keyboard row replaces the 48/20 rows, and the stacking rule for the capture bar is stated in §6.5. Shared-fixture rows and Phase 1/3 test entries are present. The plan matches the host: H3 says "Browser draws its own content and right column inside this same shell", and H3 says the owner layer has "no view selector". | §6.2, §6.3, §6.5, §12 Phases 1/3 + fixture table |
| 2 One phone definition | **Verified.** A single §6.2 helper: native app, or a screen whose shorter side is <600, fixed through rotation. It gates every Take over variant, first-fill, instruction and accepting Open/restart. The old "<1024 viewport" wording and the "open the wider web view" advice are gone (grep: no remaining hits). 820 and 744 iPad portrait, and Split View, accept without rotating. Tests cover 599 vs 600, screen vs pane and forged hints. **Remaining edge:** the helper sends a *native app on an iPad* down the phone path, and the phone copy then tells Joe to finish "on your iPad" while he is holding it. See required 1. | §6.2, §6.4, §6.5, §12 Phases 1/2 |
| 3 No guessed pronouns | **Verified.** I ran a whole-word, case-insensitive grep for she/her/hers/herself/he/him/his/himself and their contractions over `agent-browser-plan.md`, `_ask-pane-host.md` and `ask-canvas-plan.md`. It found **zero hits**. Every replacement string I asked for is present word for word, including "Joe signs in instead", "Joe will finish this in a separate browser", "Ask Joe to open SJC OS" and "until Abigail opens it again" (both places). The §1 Words rule and the copy-lint test entry are present. | §1, §5.2, §6.2–6.5, §12 |

## What's strong

- **The landscape frames can be built as written.** Every control has a place, every budget is shown with its arithmetic, and the rules for larger text are spelled out: decisions stay pinned and secondary actions scroll.
- **Device input is kept apart from layout.** Width decides layout. The device helper decides whether input is allowed. Screen hints grant no authority. That keeps the iPad and sideways-phone cases honest without touching the security contracts.
- **The copy rule now applies to the plan's own prose.** Builders copying sentences out of the plan won't reintroduce a guessed pronoun.

## Required to reach 10

### 1. §6.2 / §6.4 frame + §6.5 "Joe hand-off phone/native" row / §10.2 / §12 Phase 2 — native app on an iPad must not be told "Finish this on your iPad"

**The problem.**
- §6.2 says: "A native iPad app still follows the native/phone path." The mobile app sets `supportsTablet: true`.
- So Joe opens the hand-off bell in the SJC OS app **on his iPad** and reads: "Finish this on your iPad or computer. It stays in Browser › Asked to finish. [Don't finish] [Close]", with Open in Safari below it.
- This is the round-5 contradiction again, in the native shell. The instruction tells him to go to the device he is already holding, and it never says that the step that actually works is *Safari*. On a native phone, the same sentence also hides that Safari is the route on his iPad.

**The fix: keep the phone web copy, and give native (any device) its own sentence that names Safari.** In the §6.4 frame, replace the line "Native additionally: [Open in Safari] …" with this native variant:

```text
Native app (phone or iPad):
Abigail asked you to finish: Apply for Larson permit · city.example · Larson bath.
Abigail's answers come with it.
Finish this in Safari on an iPad or computer. It stays in Browser › Asked to finish.
[Open in Safari] [Don't finish] [Close]
```

- **Open in Safari** comes first, at 48 px, and keeps browserHandoff.
- **Don't finish** keeps its §10.2 behavior (it opens Safari) and its explanation "Open in Safari to tell Abigail."
- Use the same sentence in the §6.5 row and in §10.2's "Native hand-off landing shows …".
- §6.2's native/phone line still holds for *input*. Only the wording differs.
- In §12 Phase 2, add a native-iPad case: render the native variant and assert that no "on your iPad" string appears.

### 2. §6.3 800 × 360 meta row + §6.5 "Staff, owner viewer present" — say where "Joe is watching." goes in landscape, and that it is never cut off

**The problem.**
- §6.3 fixes the 20 px landscape meta row as "fixed state … and '· 2 windows'". The staff notice **"Joe is watching."**, which §6.2/§6.5 promise in the staff status row, has no place in any landscape frame.
- With a long state ("Private — you took over. The agent can't see this page.") plus "· 2 windows", a fixed 20 px row will ellipsize. A builder can't tell what to drop. That makes the one privacy notice staff rely on the likeliest thing to vanish when Abigail turns her phone sideways while Joe watches.

**The fix: add to §6.3 after the meta-row sentence:**

> **Staff meta appends “· Joe is watching.”** while any owner viewer is joined (same lifecycle as §6.5). Order: state · Joe is watching. · 2 windows. If it does not fit one line, drop “· 2 windows” first (the window switch stays in ⋯), then shorten a private state to its first sentence (“Private — you took over.”); if it still does not fit (larger text), the meta row wraps to two lines and the stage gives up the space. **Never truncate or hide “Joe is watching.”**

**Then:**
- In §6.5, add "in short landscape, appended to the meta row (§6.3)" to the "Staff, owner viewer present" row.
- Add an 800 × 360 staff row to the shared fixture table: private state, 2 windows, owner joined. Assert that the full "Joe is watching." is visible and "· 2 windows" is the first thing dropped.

## Optional

- **Write down that the two device rules differ on purpose.** Canvas's floor hint uses *viewport width <640* (Canvas §6.5 / H3). Browser input uses *shorter screen side <600*. So a sideways 800 × 360 phone gets **Edit floor plan ↗** in Canvas but no Take over in Browser. Both are right for their jobs: floor editing needs width, takeover needs a real pointer/keyboard. Ask the host owner to add one sentence to H3 saying the rules are separate on purpose, so a builder doesn't "unify" them.
- **Staff-facing instruction.** "Open SJC OS on your iPad or computer, then Operator › Browser." assumes staff own an iPad. Suggest **"Open SJC OS on an iPad or computer, then Operator › Browser."** for staff. Joe's copy can stay "your".
- **Hand-off outcome buttons in landscape.** When Joe is viewing an accepted hand-off task on a sideways phone, say whether [Mark finished] [Didn't finish] go in the right column after the primary action (in the scrolling secondary group), or stay only on the chat card. Today a builder has to infer this from "status row + chat card".
- **Carried from round 5, not taken:**
  - Silent Telegram (`disable_notification`) while Joe's owner layer for that task is already visible.
  - A short-landscape sheet should always be single view on ~915 × 412 Android (host).
  - The staff 360 portrait status row should wrap (`min-h-11`) rather than truncate "Joe is watching." This is the portrait twin of required 2.
