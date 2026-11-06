SCORES: design=9 completeness=9

# Canvas Phase 1 build, round 5 confirm: design & UX judge

Reviewed HEAD `3c4d911c` on branch `t3/in-app-browser-agent-tools`. I read the `3c4d911c` diff
(`components/panel/CanvasSaveDialog.tsx`, `tests/canvas-save-dialog.test.mjs`) and
`components/panel/canvas/CanvasOverlay.tsx`. I also read every owner Save PNG and the staff chips PNGs
in `/home/joe/qa-sjcos/abc/shots/c1-r5/`, plus `c5-log.json`. I checked them against my round-4 R4-1
fix and the §4.2 wireframe (`[Cancel] [Save disabled]  Tick the line above to save.`).

## R4-1: fixed in the main path

**Code.**
- One `hint` ("Choose a project." / "Tick the line above to save."). `needsAck` uses the same
  condition as Save's `disabled`.
- The in-flow helper and the in-flow `role="alert"` are deleted. The test counts exactly one of each.
- Both now render inside the `sticky bottom-0` footer, error first, then the hint.
- The acknowledgement `<label>` has `ref={ackRow}` and `scroll-mb-24`. It scrolls into view
  (`{block:'nearest'}`) once, when it first appears. `ackShown` resets when no acknowledgement is
  needed, so later unticks don't jump rows under Joe's finger.

**Screens (no scrolling after the clicks):**

| Capture | 1280 | 360 |
|---|---|---|
| checklist-top | Checklist 320 px, 21 rows, min 48 px, Save in view | 304 px, the same rows, Save in view |
| two-unticked | 2 warnings with bordered **Keep … ticked**. **I understand — share without Today, Inbox** is in full view. **Tick the line above to save.** sits in the footer beside **Cancel / Save (disabled)**. | Same. The hint fits on one line beside the buttons. |
| four-unticked | — | **…Today, Inbox +2 more**, **All removed areas**, and the footer hint. |
| untick-all | **Staff who can open QA Canvas empty project files can read this copy.** The two-line **I checked this canvas…** row is fully above the footer (the round-4 half-cut is gone). The hint is in the footer and Save is disabled. | Same. The two-line acknowledgement is fully visible above the footer. |
| ack-ticked | Ack POST 200, Save enabled, no hint. | Same. |
| save-error | **Couldn't save right now. Try again.** in flag colour, in the footer, on one row with **Cancel / Save**. | See R5-1. |
| staff chips | **🔒 Staff**, **Staff who can open … can read this copy.**, the portal line, **Cancel / Save**. | Same. No radios or checklist. |

The log shows `leaked:false` and `overflow:0` everywhere, `alertInFooter:true` at both widths, and
`saveVisible:false` on render_error. The only console lines are the two forced 503s.

## REQUIRED fix

**R5-1. At 360, an error in the footer breaks Cancel and Save apart and covers the acknowledgement.**

**What `owner-phone360-save-error` shows:**
- The footer is `flex flex-wrap`, and the alert is just another flex item with `mr-auto`.
- At 334 px the error and **Cancel** fill the first line, and **Save** wraps alone to a second line.
  The button pair is split, which no other state of the dialog does.
- The footer grows by about 50 px over the content, which doesn't move. The ticked acknowledgement is
  reduced to a checkbox sliver under the footer's top border, which looks broken.

**Why it matters beyond looks:** the 10-minute expiry path calls `reset()` and then
`setError('Review who can read this copy again.')`. That unticks the acknowledgement Joe must now
re-tick, and the error replaces the "Tick the line above" hint. At 360 that row sits under the taller
footer, and the once-only scroll effect does not run again (`needsAck` never changed). Joe sees a
greyed Save, an instruction to review, and nothing visible to tick. (At 1280 everything fits on one
row, so the problem is phone-only.)

This is my round-4 shape, which the commit didn't follow. All of it is in
`components/panel/CanvasSaveDialog.tsx`:

- **Error on its own line, buttons together.** Give the alert `basis-full` so it always takes a full
  line above the buttons, at both widths:
  `{error&&<p role="alert" className="basis-full text-body text-flag">{error}</p>}`.
  Then render the hint separately with the existing `mr-auto` (`{!error&&hint&&<p className="mr-auto
  text-body text-ink-3">{hint}</p>}`). Cancel and Save then always share a row. Alternatively, use the
  two-part footer from R4-1.
- **Keep the row Joe has to tick in view when the footer grows.** Raise the label's `scroll-mb-24` to
  `scroll-mb-28`, because the footer with an error line is about 100 px. Re-run the same
  `scrollIntoView({block:'nearest'})` when an error appears while an acknowledgement is needed, so a
  failure on the way never hides the acknowledgement:
  `useEffect(()=>{if(error&&needsAck)ackRow.current?.scrollIntoView({block:'nearest'});},[error,needsAck]);`
- **Test:** assert `role="alert" className="basis-full`, and assert `scroll-mb-28` on the
  `ackRow` label.
- **Reshoot:** `owner-phone360-save-error` and `owner-desk1280-save-error`, with Cancel and Save on one
  row and the acknowledgement fully visible. If the harness can shorten the expiry, add an expiry
  capture at 360: **Review who can read this copy again.**, the unticked acknowledgement fully
  visible, and Save disabled.

## Not required

The open state of the checklist's inner scroller varies between captures. It is left over from the
earlier clicks in the same session, and it is correct.

Required: R5-1 only.
