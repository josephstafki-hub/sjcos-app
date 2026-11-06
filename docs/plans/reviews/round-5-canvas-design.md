SCORES: design=10 completeness=10

# Round 5 — Design & UX judge — Ask-panel Canvas plan

I judged `docs/plans/ask-canvas-plan.md` (the "Round-4 fixes" appendix and the sections it names: §§3.1, 3.2, 4.2, 6.5, 7.1 and 10) and `docs/plans/_ask-pane-host.md` at `85a7a5c6`. That HEAD includes the H3 change "Escape on Watch closes only Joe's view".

I checked them against:
- my round-4 review;
- the committed Browser plan at HEAD (`agent-browser-plan.md`; I ignored any uncommitted edits);
- the real source:
  - `components/panel/PanelHost.tsx:119–125`: the popout opens at `width=1100`.
  - `components/panel/PanelHost.tsx:227–268`: the sheet is `h-[66dvh]` drawer or `top-0` full height, with a grabber (`mt-2 h-1`), a `py-2` header holding the 44 px chevron and × (`aria-label="Close operator panel"`), and a `PanelDock width={400}` child.
  - `components/panel/PanelDock.tsx:75–84`: the narrow branch is `flex-col gap-2 p-2` with a horizontal `Segmented` (`h-12 [&_button]:h-11`) offering Queue / (Threads in the popout) / Chat.
  - `components/ui/Segmented.tsx:25–33`: today it is `role="group"` with `aria-pressed` buttons, `whitespace-nowrap`, `px-2.5` and `text-label`, which is 12 px (`app/globals.css:143`).
  - `components/floor/Designer.tsx:79–85`: the existing designer already has its own narrow layout below 960 px.

## Round-4 items: verified / not fixed

| # | Item | Status |
|---|---|---|
| 1 | Pointer-aware compact controls + 1100 popout row | **Verified.** H3 and §3.2 separate layout from input. A fine pointer (`(pointer: fine)`, plus `any-pointer: fine` for hybrids) gets **[−] [Fit] [100%] [+]**, Ctrl/⌘+wheel zoom (captured only over the stage, so plain wheel still scrolls) and drag-to-pan at every pane width. Touch keeps Fit/100% with pinch and double-tap. §6.5/§7.1 choose the floor menu by **screen** width: the hint shows only below 640, otherwise **Edit floor plan ↗**, and view-only people get **Open floor plan ↗**. The fuller frames now have **Edit floor plan** as a visible button with no duplicate Open row. That also covers my old floor 100% optional: the fuller floor frame shows all four zoom controls. H1 Popout row and H5 have an explicit **1100 popout → 455/12/~617 → compact** row. The "fuller above about 1150 px" figure checks out: the pane reaches 640 when content ≥ ~1124, so the window must be ≥ ~1140. §7.1 says it outright: "A 617 px pane on an 1100 px computer must offer Edit, never tell its user to find a computer." |
| 2 | 800 × 360 landscape Operator chrome, stage ≥200 px | **Verified, and it can be built from the real PanelHost/PanelDock.** It is drawn in §3.1, with numbers. H3's "Shared Operator-sheet short landscape layout" specifies the left strip (≥64 px: Close Operator + one vertical four-tab selector in 48 px rows), hidden grabber/chevron/horizontal header, the dialog name still **Operator**, a 128 px right action column and 48/20 center rows. Stage: 360 − 48 − 20 − 8 − 80 = **204 ≥ 200**. Strip: 5 × 48 = 240, which fits in 360 − 80 − 8 = 272. Without the restructure only 156 px is left. The "Verified implementation gap" paragraph names exactly what has to change: the hard-coded sheet `flex-col`, grabber and header in `PanelHost.tsx:229–268`; the synthetic `width={400}`; and the horizontal `Segmented` row in `PanelDock.tsx:75–80`. It assigns that refactor to Phase 0 and reuses the existing focus trap and Close handler. H2 commits to one selector instance with `aria-orientation="vertical"` and Up/Down/Home/End, not a duplicate tablist, and to replacing today's `role="group"`/`aria-pressed` with real tabs. Browser is told to use the same strip and draw only its own right column. H5 and §10 assert all of it, including rotation keeping state and focus with no extra history entry. |
| 3 | ≤3-removal warnings + revised Save frame | **Verified.** §4.2 shows the per-row "Staff without {area} access…" warning and the [Keep {area} ticked] button only at **≤3 removals counted from the server baseline**. Above three, rows show only their checkbox and the one acknowledgement is the warning. Reticking back down to three brings the per-row warnings back and clears the acknowledgement. The third 360 frame is redrawn: plain ☐ rows, then the single "I checked this canvas…" row, then "Staff who can open Larson bath files can read this copy.", then Save disabled with "Tick the line above to save." The obsolete ticked-audience sentence is explicitly not stacked. `tests/canvas-save-dialog.test.mjs` and the release matrix test 1 / 3 / 4 / 21 removals. |

**Changed areas and consistency.**
- **Copy.** The host file, the Canvas plan and the Browser plan agree on the labels. **Close Operator** is a deliberate, fixture-asserted rename of `PanelHost.tsx:257` "Close operator panel". The Browser plan (line ~1126) already asserts the new label.
- **Escape on Watch.** `85a7a5c6` makes host H3 match Browser §6.2 (lines ~1231 and ~1627): on Watch with no Joe control, Escape/Back/‹ Back/Close only close Joe's view; **[Pause agent]** is the deliberate action; the review sheet keeps Escape = Keep paused (layer 3).
- **Exits.** The one-exit rule holds in landscape: × in the strip closes Operator and ‹ Chat in the center is the pane exit.
- **Numbers.** The portrait 136 + 8 budget and the 360 × 800 ≥420 stage are unchanged. All three Canvas types are named in each stage gate.
- **Browser plan.** The committed Browser plan adopted the host at `22a48134`, which predates the landscape shell. The host file states that Browser adopts the shell verbatim and draws its own right column. That is a follow-up for the Browser author and judge, not a gap in the Canvas plan.

## What's strong

- **The 1100 popout is now honest.** Joe's actual default window is called compact, and he still gets mouse zoom up to 400% and an **Edit floor plan** link. Nobody on a computer gets told to find a computer.
- **Landscape is one shared shell, not a Canvas hack.** The plan worked out that moving the bottom bar alone leaves 156 px. It named the exact PanelHost/PanelDock lines to change and put the work in Phase 0, so Browser inherits a strip instead of inventing a second one. The vertical tablist gives keyboard users real semantics they don't have today.
- **The Save dialog is calm on Joe's everyday path.** Untick all leaves 21 plain boxes and one sentence he has to tick. The detailed per-row warnings return exactly when they matter: when he is removing one to three specific areas from a tracked baseline.
- **Fixtures replace prose.** Every new rule (1100 popout, 800 × 360 strip and stage, pointer floats, screen-based floor menu, 4–21 removal states) is a named H5 row, a §10 assertion or a release-matrix row. A builder doesn't have to re-derive any number.

## Required to reach 10

None. Nothing left would trip Joe or staff, and nothing is left for a builder to guess.

## Optional

1. **H3 strip width vs the real `Segmented`.**
   - At today's `text-label` (12 px medium) with `px-2.5`, **Browser** is about 66 px and **Canvas•** about 72 px. Both are wider than a literal 64 px strip.
   - The existing `overflow-x-auto` + `whitespace-nowrap` would then clip a label or scroll it sideways.
   - The plan already says "≥64 px" and "can widen for text size". Make that concrete: "the vertical variant sizes to its widest label (`w-max min-w-16`, `px-2`, no `overflow-x-auto`); it never clips or scrolls a tab label".
2. **H1/H3 short landscape is always a single view.**
   - A wide Android phone in landscape (about 915 × 412 with thin insets) can leave a measured content box ≥840 next to the 64 px strip.
   - That would trigger a split: ~357 Chat beside a ~482 pane whose 128 px right column leaves ~350 px of stage.
   - Add: "In the short-landscape sheet, the host always uses the narrow single view, whatever the measured width."
3. **§3.1 / §4 "Version 3 is ready [Latest]" in the 20 px meta row.** [Latest] is a control, but its row is 20 px tall. Give it a ≥44 px invisible hit area (an extended `::before`) without growing the row. › Next and Versions already reach the same place, so this is polish.
4. **§4.2 acknowledgement position.** The redrawn frame says "below the scroll region" but doesn't show where ○ Only Joe sits. Say: "the acknowledgement sits directly under the checklist, inside the Share with staff group and above ○ Only Joe. It is hidden when Only Joe is chosen."
5. Carried over from round 4, still optional:
   - §8.4: the real meta line is `truncate`, so the plan should say Canvas rows switch to `flex-wrap`.
   - §4.2: relabel **Untick all** to **Tick all again** once nothing is ticked.
   - §8.5: the pre-fence copy "Deletion has not started. [Try again]" should become **"Couldn't delete this canvas. Nothing changed. [Try again]"**.
   - §8.4: use `EyeOff` instead of a second lock glyph.
   - Thread rail: a small canvas icon on threads that hold canvases.
