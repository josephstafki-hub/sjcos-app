SCORES: design=9 completeness=9

# Canvas Phase 1 build, round 4 confirm: design & UX judge

Reviewed HEAD `ea123891` on branch `t3/in-app-browser-agent-tools`. I read the `ea123891` diff (both
`components/panel/CanvasSaveDialog.tsx` and `tests/canvas-save-dialog.test.mjs`) and
`components/panel/canvas/CanvasOverlay.tsx`. I read the PNGs, `c4-log.json` and `c2-log.json` in
`/home/joe/qa-sjcos/abc/shots/c1-r4/`, plus `shoot-c4.mjs` and `c4.out`. I checked them against
`ask-canvas-plan.md` §4.2 (prose and the three wireframes) and my round-3 review.

## R3-1: fixed

The diff applies my R3-1 classes exactly:
- The inner `max-h-[65dvh] overflow-auto` scroller is gone, so the overlay body is the only dialog
  scroller.
- The checklist is `role="group"`, `max-h-[min(20rem,38dvh)] shrink-0 overflow-y-auto
  overscroll-contain`, with a border and card background.
- Rows are `min-h-12 w-full cursor-pointer … gap-3`, and the checkboxes are `size-5 accent-ink`.
- The warnings are `pb-2 pl-8 text-meta text-ink-2`, with bordered `min-h-11` **Keep {area} ticked**
  buttons.
- **Untick all** is `shrink-0 self-start`.
- The Cancel/Save row is `sticky bottom-0 … border-t bg-paper py-2`.

The new test pins all of these.

The log passes all three round-3 thresholds:
- **Checklist height:** 320 px at 1280×860 (needed ≥ 240) and 304 px at 360×800 (needed ≥ 200).
- **Rows:** 21, the smallest 48 px.
- **Save:** `saveInView` true at both widths.

| Capture | Result |
|---|---|
| (a)/(b) picked, top | `owner-*-save-picked`: **QA Canvas empty project ▾**, filename, **Share with staff**, the unknown-provenance line directly under it, the bordered **Untick all**, then the bordered checklist from **Today** with 48 px ticked rows, and the sticky **Cancel / Save**. No FILED badges. |
| (c) end | **Bidding** sits directly above **All other financials**, then **Only Joe**, the >3 sentence and the portal line. See the capture note below. |
| (d) two unticked | Two lines, **Staff without Today/Inbox access will be able to read this. [Keep … ticked]**, with bordered buttons. Wrapping is clean at 360. **I understand — share without Today, Inbox**; Save disabled. |
| (e) four unticked | No per-row lines. **I understand — share without Today, Inbox +2 more**. |
| (f) Untick all | Plain unchecked rows, **Staff who can open QA Canvas empty project files can read this copy.**, **I checked this canvas. Share it with everyone who can open QA Canvas empty project files.**, Save disabled. See R4-1. |
| (g) acknowledgement ticked | Save enabled. |
| (h) Only Joe | **Only Joe can read this copy.** and the portal line. No checklist and no Untick all. |
| Staff, COMPLETE narrow | No radios or checkboxes. **🔒 Staff**, **Staff who can open … files can read this copy.**, the portal line and **Cancel / Save**, at both widths. |
| Phone ⋯ sheet, owner and staff | **Canvas actions**: Show code, About this diagram, Save to project files, › Download, Open in new tab, a divider, then **Delete canvas…**. Matches the popout. |
| render_error / too complex | No Save at either width (`saveVisible:false`). |
| c2 regression | 95 shots, zero leaks, zero overflow. The only console lines are the two expected 404s on `wrapper-OTHER`. Those pages show the calm **This canvas isn't available to this account. [‹ Chat]**. |

## REQUIRED fix

**R4-1. With the new sticky Save row, the reason Save is disabled, and any error, can sit hidden
under it.** In `owner-*-save-two-unticked`, `-four-unticked` and `-untick-all` at both widths,
**Tick the line above to save.** is not on screen: it is in flow below the acknowledgement, under the
pinned row. In `-untick-all` at 1280 and 360, the acknowledgement row itself, the one control that
unlocks Save, is cut in half by the pinned row ("…can open QA Canvas empty project / files"). Joe
sees a greyed **Save** with no reason in view. The `role="alert"` error (save failures, **Review who
can read this copy again.** on expiry) is in the same place, so a failed Save can look like
nothing happened. §4.2's wireframe puts the helper on the button row:
`[Cancel] [Save disabled]  Tick the line above to save.`.

All of these are in `components/panel/CanvasSaveDialog.tsx`:
- Delete the in-flow `{!ack&&<p>Tick the line above to save.</p>}` (the line after the
  acknowledgement and details) and the in-flow `{error&&<p role="alert">{error}</p>}` (before
  `offerAnother`).
- Compute one hint:
  `const hint=!project?'Choose a project.':p?.owner&&kind==='staff'&&removed.length>0&&!ack?'Tick the line above to save.':'';`
- Make the sticky row a two-part footer:
  ```tsx
  <div className="sticky bottom-0 z-10 border-t border-rule bg-paper py-2">
   {error&&<p role="alert" className="pb-2 text-body text-flag">{error}</p>}
   <div className="flex items-center justify-end gap-4">
    {hint&&<p className="mr-auto min-w-0 text-body text-ink-3">{hint}</p>}
    …Cancel… …Save… (unchanged)
   </div>
  </div>
  ```
  This replaces the current `{!project&&<p …>Choose a project.</p>}`. At 360 the hint wraps to two
  lines beside Cancel/Save, which is fine.
- Keep the acknowledgement clear of the pinned row:
  - add `ref={ackRow}` and `scroll-mb-24` to the acknowledgement `<label>`;
  - add `useEffect(()=>{if(removed.length>0)ackRow.current?.scrollIntoView({block:'nearest'});},[removed.length>0]);`.
    This scrolls only when the row first appears (0 → ≥1 removals, including **Untick all**). It
    never fires on later unticks, so rows don't jump under Joe's finger.
- **Test** (`tests/canvas-save-dialog.test.mjs`, the layout test): assert that
  - `Tick the line above to save.` occurs only through `hint`;
  - the `role="alert"` error renders inside the `sticky bottom-0` element;
  - the acknowledgement label matches `/scroll-mb-24/`.

  Also assert, in the existing owner unknown-context render test, that after **Untick all** the
  footer text contains **Tick the line above to save.**, and after the acknowledgement is ticked it
  does not.

## Captures needed next round (after R4-1)

At 1280×860 and 360×800, owner, UNKNOWN provenance, take each shot right after the click, with no
extra scrolling:
- `-two-unticked` and `-untick-all`: **Tick the line above to save.** visible in the pinned row next
  to a disabled Save, and the whole acknowledgement row visible above the pinned row. Log
  `ackFullyVisible`: the ack label's bottom ≤ the footer's top.
- `-ack-ticked`: no hint, Save enabled. Log the acknowledgement POST status (200). This item was
  already on the round-3 list and is missing from `c4-log.json`.
- One error shot: force `/save` to fail (e.g. route-intercept a 409 `SAVE_POLICY_CHANGED`). Show the
  alert in the pinned footer above **Cancel / Save**.

Capture note, not a product bug: `shoot-c4.mjs:40` scrolls every scroller in the dialog to the end
before `-save-checklist-top`. So `-checklist-top`, `-checklist-end` and `-picked-scrolled` are
byte-identical (same md5). `-save-picked` covers the top state. Next time, drop the line-40 loop or
reset `g.scrollTop=0` before the top shot.

## Non-blocking notes

- The **🔒 Staff** baseline renders as a bare `<p>`, while named areas render as bordered chips
  (`CanvasSaveDialog.tsx:11`). For the same look, use
  `<span className="rounded-md border border-rule bg-card px-2 py-1 text-meta">🔒 Staff</span>`.
- The acknowledgement checkbox and the two radios still use the default ~13 px controls beside the
  new 20 px checklist boxes. `size-5 shrink-0 accent-ink` on them would match.
- `overscroll-contain` on the checklist stops a swipe that starts inside it from scrolling the
  dialog once the list is at its end. At 360×800 there is always ≥ 250 px of dialog outside the
  list to swipe on, so this is fine. If phone testing shows people getting stuck, drop
  `overscroll-contain`.
- Round-2 and round-3 notes still stand:
  - the black title focus outline is still visible in `owner-*-render_error`/`-large`;
  - **Show code** and **Ask Claude to simplify it** touch each other in the 360 too-complex wrapper
    (`gap-2`).
