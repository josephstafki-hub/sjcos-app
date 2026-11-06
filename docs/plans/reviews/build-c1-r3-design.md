SCORES: design=8 completeness=8

# Canvas Phase 1 build, round 3: design & UX judge

Reviewed HEAD `e417b3b9` (fixes `43ffc8a9`, migration renumber `93c49fb7`) on branch
`t3/in-app-browser-agent-tools`. I read the PNGs in `/home/joe/qa-sjcos/abc/shots/c1-r3/`, plus
`c2-log.json`, `c3-log.json`, `c3b-log.json`, `c3b.out` and `shoot-c3.mjs`. I read the source in
`components/panel/CanvasSaveDialog.tsx`, `components/panel/canvas/CanvasOverlay.tsx`,
`components/panel/JobPicker.tsx` and `components/panel/CanvasPane.tsx`, plus the `43ffc8a9` diff and
`tests/canvas-save-dialog.test.mjs`. I checked them against `ask-canvas-plan.md` §4.2.

## Round-2 items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| R2-1 | Staff can pick a project | **Fixed** | `searchCanvasProjectsAction` is passed as `JobPicker search` (`CanvasSaveDialog.tsx:20,42`). `staff-desk1280-save-picked` and `staff-phone360-save-picked` list projects. On error the dialog shows **Couldn't load projects. [Try again]** below the search row (`JobPicker.tsx:176`). `tests/canvas-project-search-db.test.mjs` exists. The staff picked state (chips) was not captured. |
| R2-2 | No rail folder state in the Save picker | **Fixed** | `taken=!projectOnly&&…` (`JobPicker.tsx:219`). In inline mode, names use `text-body`, subtitles and the kind header use `text-meta`. No **FILED** badges appear in any save-dialog shot. |
| R2-3 | Toggle shows open/closed | **Fixed** | **Pick a project ▴** shows while the list is open (owner and staff shots) and **QA Canvas empty project ▾** shows after the pick. The test uses the ▴ label. |
| R2-4 | No disabled Save on unrenderable versions | **Fixed** | `CanvasPane.tsx:67,90` hide Save for `RENDER_FAILED`/`RENDER_TIMEOUT`. `owner-desk1280-wrapper-render_error` and `owner-phone360-wrapper-large` have no Save. |
| R2-5 | State-action buttons bordered | **Fixed, one leftover** | **Ask Claude to fix it**, **Show code**, **Ask Claude to simplify it**, **Try again**, **Sign in**, **Draw the steps…**, **Use this version**, **Delete canvas** and **Untick all** are all bordered card buttons in the shots and the diff. The per-row **Keep {area} ticked** is still `underline` text, but §4.2 draws it as a `[button]`. That is folded into R3-1. |

## The checklist strip: cause

The dialog body is a flex column with its own scroll:
`flex max-h-[65dvh] flex-col gap-3 overflow-auto` (`CanvasSaveDialog.tsx:38`). Every flex item has
`flex-shrink:1`. A flex item with `overflow:visible` cannot shrink below its content
(`min-height:auto`), but one with `overflow:auto` has a min-height of 0. The checklist
(`max-h-56 overflow-auto`, `:46`) is the only direct child with its own overflow. So when the content
is taller than 65dvh, the browser shrinks that one child to almost nothing: the 1-row strip in
`owner-desk1280-save-picked` and `…-scrolled` (only **Today**, then only **All other financials**).
The outer column has nothing left to scroll, and its padding box sits over the clipped rows. That is
why Playwright reported the click on the checkbox as `<div class="flex max-h-[65dvh] …"> intercepts
pointer events`.

The JobPicker list (`max-h-72 overflow-y-auto`) is not squeezed because it is nested inside the
JobPicker's own wrapper, which has `overflow:visible`. That is why the project list looked correct.

There is also a second problem. `CanvasOverlay.tsx:16` already wraps the children in a
`min-h-0 overflow-auto` scroller, capped at 85dvh by `:14`. That makes three nested scrollers, and on
a full owner dialog **Save** sits below the fold at both 1280×860 and 360×800.

## REQUIRED fixes

**R3-1. Give the checklist full-height rows inside a single dialog scroller, with Save always visible.**
All of these are in `components/panel/CanvasSaveDialog.tsx`:

- **`:38`**: remove the inner scroller and let `CanvasOverlay`'s body (`CanvasOverlay.tsx:16`, 85dvh)
  be the only dialog scroller.
  `<div className="flex max-h-[65dvh] flex-col gap-3 overflow-auto py-3">` →
  `<div className="flex flex-col gap-3 pt-3">`
- **`:46`**: make the checklist a bounded scroll region that flex can never squeeze, and that keeps
  wheel and touch scrolling to itself.
  - Container: `<div className="max-h-56 overflow-auto" aria-label="Required access areas">` →
    `<div role="group" aria-label="Required access areas" className="max-h-[min(20rem,38dvh)] shrink-0 overflow-y-auto overscroll-contain rounded-md border border-rule bg-card px-3">`.
    That gives about 6½ rows of 48 px at both 360×800 and 1280×860. The half-visible row is the
    scroll cue.
  - Each row label: `flex min-h-12 items-center gap-2` → `flex min-h-12 w-full cursor-pointer items-center gap-3`.
  - Each checkbox: add `className="size-5 shrink-0 accent-ink"`. The whole 48 px row is the target.
  - The warning `<p>`: add `className="pb-2 pl-8 text-meta text-ink-2"`.
  - Its button: `min-h-12 underline` → `min-h-11 rounded-md border border-rule bg-paper px-3`.
    Keep the copy exactly **Keep {label} ticked**.
- **`:45`**: add `shrink-0` to the **Untick all** button. Also add `self-start` so it is not a
  full-width bar. The 48 px height stays.
- **`:52`**: pin the actions to the bottom of the dialog scroller.
  `<div className="flex items-center justify-end gap-4">` →
  `<div className="sticky bottom-0 z-10 flex items-center justify-end gap-4 border-t border-rule bg-paper py-2">`.
  **Tick the line above to save.** and **Choose a project.** stay in flow above it or beside it as
  now.
- **Test** (`tests/canvas-save-dialog.test.mjs`, the owner unknown-context case near `:67`). Assert
  that:
  - the element with `aria-label="Required access areas"` has `role="group"` and a className matching
    `/shrink-0/`, `/overflow-y-auto/` and `/max-h-\[min\(20rem,38dvh\)\]/`;
  - each of its 21 labels matches `/min-h-12/`;
  - the dialog body className does not match `/max-h-\[65dvh\]|overflow-auto/`;
  - the Save/Cancel row matches `/sticky bottom-0/`.

Nothing else is required. The owner copy shown so far is right. **Claude may have used anything in this
chat, so every area is ticked.** sits directly under **Share with staff**, followed by **Untick all**,
**Only Joe**, **Only Joe and staff with every ticked area can read this copy.** and **It won't
appear on the client portal.**, matching §4.2 and §8.4.

## REQUIRED captures (next round, after R3-1)

Script notes:
- Click the **QA Canvas empty project** row directly; do not click **Pick a project ▴**.
- The phone runs (`owner-phone360-save-picked`, `staff-phone360-save-picked`) still show the picker
  unpicked, so the pick step needs to run at 360 too.
- Before clicking a row, scroll it into the checklist with
  `locator.scrollIntoViewIfNeeded()` rather than setting `scrollTop` on every element.
- For every Save shot, log `checklistHeight`
  (`[aria-label="Required access areas"]` `clientHeight`), `rowHeights` (min/max of its labels), and
  `saveVisible`: the bounding box of **Save** inside the dialog's viewport without scrolling.
  - Pass: `checklistHeight` ≥ 240 at 1280×860 and ≥ 200 at 360×800.
  - Pass: every row ≥ 48.
  - Pass: `saveVisible` true.

1. **Owner, UNKNOWN-provenance canvas, at 1280×860 and 360×800**, project QA Canvas empty project:
   - (a) the picker open, with no FILED badges;
   - (b) after the pick, the checklist at the top: **Share with staff** selected, the explanation, the
     bordered **Untick all**, and a bordered scroll region showing about 6 ticked 48 px rows from
     **Today**, followed by **Only Joe**, the audience sentence, the portal line, and sticky
     **Cancel / Save** (Save enabled);
   - (c) the checklist scrolled to the end, with **Bidding** directly above **All other financials**;
   - (d) Today and Inbox unticked: two lines **Staff without Today access will be able to read this.
     [Keep Today ticked]** / **…Inbox…** with bordered Keep buttons, the acknowledgement row
     **I understand — share without Today, Inbox** (unticked), **Tick the line above to save.**, and
     Save disabled;
   - (e) four areas unticked: no per-row lines, and the acknowledgement
     **I understand — share without Today, Inbox +2 more**;
   - (f) **Untick all**: no per-row lines; the single row **I checked this canvas. Share it with
     everyone who can open QA Canvas empty project files.**; the sentence **Staff who can open QA
     Canvas empty project files can read this copy.**; Save disabled;
   - (g) the acknowledgement ticked: Save enabled, and the log shows the acknowledgement POST
     returned 200;
   - (h) **Only Joe** selected: **Only Joe can read this copy.**, no checklist and no Untick all.
2. **Staff, COMPLETE-narrow canvas, at 1280×860 and 360×800**, after picking a project:
   - no radios and no checkboxes;
   - read-only chips (≤3, then **+N more**), or **🔒 Staff** when the baseline is empty;
   - the matching audience sentence and **It won't appear on the client portal.**;
   - if **+N more** shows, a second shot with it expanded.
3. **Phone 360 sheet ⋯ menu from /today, with the menu open.** `owner-phone360-sheet-menu` still
   shows it closed. The popout `owner-phone360-canvas-menu` is correct: Show code, About this
   diagram, Save to project files, Download, Open in new tab, Delete canvas….
4. **Regression:** rerun the full c2 set and confirm zero leaks, zero console errors and zero
   overflow.

## Non-blocking notes

- Round 2's notes still apply: **Save to project files** on the Preview·Code row, the title focus
  ring (`focus-visible:outline-focus`), and the landscape **Ask for a change** height. The black
  title outline is visible in `owner-desk1280-wrapper-render_error` and `owner-phone360-wrapper-large`.
- In the 360 too-complex wrapper, **Show code** and **Ask Claude to simplify it** touch each other.
  `gap-2` on a flex-wrap row (as the render_error row has) would match.
