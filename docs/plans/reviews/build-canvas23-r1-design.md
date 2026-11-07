SCORES: design=7 completeness=6

# Canvas Phase 2 + 3, build round 1: design review

Judge: design lens. Branch `t3/canvas-phase2-3` @ `e6cb3693`. Evidence: the 81 PNGs in `/home/joe/qa-sjcos/abc/shots/c23-r1/`, `c23-log.json`, `c23-floor-log.json` and `summary-pages.txt`, read against plan §1 Words used, §3.1–3.2, §4/4.1/4.2, §6.5, §7/7.1 and the Phase 2/3 handoffs. I did not run any build, server or browser.

## What works

- **Pages look right at every width.** The Phase 1 chrome carries over to pages without change. At 360/390 you get ‹ Chat · title ▾ · ⋯, a 20 px meta row reading "Page · Version 2 of 2", the stage, floating Fit/100%, and a 56 px bar with ‹ Versions › and **Ask for a change**. At 820/1280 the fuller layout adds Preview · Code, **Save to project files** and **About this page ▸**. At 800×360 the right column stacks correctly. The 1100 popout is compact and shows all four zoom controls (fine pointer). Nothing overflows at any width (`OVERFLOW []`).
- **Plain words.** "Page", "About this page", "This page can show text, tables, and drawings. Ask Claude to change it.", "Page code · Version 2", "Version 2 is ready · Latest", "Read only", "The floor plan changed. Load latest", "Loaded latest floor plan". No invented nouns, and no pronouns for names that fill in at run time (a grep of the canvas UI files found none).
- **Older-version page** (`page_v1-desk1280-wrapper`): "Page · Version 1 of 2 · Version 2 is ready Latest" sits in the same meta row with no extra banner, as §3.1 asks. The v1 cards and table read cleanly at 1280.
- **Unavailable state** (`*-wrapper-OTHER`, owner and staff, page and floor): plain "This canvas isn't available to this account." with one **‹ Chat** button. No title, owner name or pixels, and a real 404.
- **Versions sheet**: a bottom sheet on phones and a dialog on desktop. Rows read "Version 2 ✓ / Added inline SVG · Joe Stafki · 12:34 PM". Floor rows show only the design number ("Floor plan · … · v1"), never the canvas integer.
- **Floor is read-only and easy to read.** "Read only" sits in the meta row. There are no tools, inspector, estimate or publish controls. 2D is the default and 3D starts only on a tap. Room name and square footage are legible at 360. The stage at 360×800 is about 524 px (≥420). **Load latest** works: v1 → v2 with the note "Loaded latest floor plan" (`owner-floor-desk1280-after-load-latest`). The designer link points to the same `/floor/9` as the project's Floor chip.
- **Owner and staff look the same** apart from names, which matches the plan for these states. Staff (Abigail) gets the same page and floor chrome, and the Save dialog uses the staff's own canvas title.

## REQUIRED fixes

1. **The floor ⋯ menu floats over the drawing, shows a stray "›", and is missing most of its §6.5 items.** `components/panel/canvas/floor/FloorCanvasStage.tsx:21` draws a `<details>` in the stage's top-right corner. Its default disclosure marker makes it render as "› ⋯" in every floor shot, it covers the plan, and it holds only the designer link. The title row (`FloorCanvasPane.tsx:34`) has no ⋯, unlike pages (`CanvasPane.tsx:50`). As a result, a floor canvas has no **Delete canvas…** or **Copy link**, and **Use this version** is reachable only through About (`FloorCanvasPane.tsx:44`).
   **Change:**
   - Delete the `<details>` block at `FloorCanvasStage.tsx:21`.
   - In `FloorCanvasPane.tsx:34`, render the title the same way `CanvasPane.tsx:50` does: title button plus a 44 px `⋯` button with `aria-label="Canvas actions"`.
   - The ⋯ opens a `CanvasOverlay menu` with 56 px rows, in this order:
     - when `viewport < 640`: the non-action hint **Edit on a tablet or computer**, then **Open floor plan ↗**
     - otherwise **Edit floor plan ↗**
     - **About this floor plan**
     - **Use this version** (only when an older version is selected)
     - **Copy link** (canonical `/floor/<id>`)
     - a divider
     - **Delete canvas…**, wired to the same delete confirm as `CanvasPane.tsx` (the "Delete canvas?" sheet)
   - Someone who can view but not edit gets **Open floor plan ↗** at any width. The preview payload (`FloorCanvasPreview`) needs a server-computed `canEdit` boolean for this.

2. **Fuller panes don't show the "Edit floor plan" button.** At 820 (`owner-floor_v1-ipad820-open`) and 1280 (`*-floor_v1-desk1280-open`) the pane is the fuller layout, but the handoff is hidden behind the corner menu (`hasEdit:false` in every log entry). §6.5 and §7.1 say: "Fuller editable panes have the visible **Edit floor plan** button, without a duplicate Open menu row."
   **Change:** in `FloorCanvasPane.tsx`, when `!context.compact && canEdit`, render a visible `min-h-12` **Edit floor plan ↗** link to `/floor/<id>`. Put it in the actions bar after Ask for a change, or under the meta row the way pages put Save to project files. When it is visible, leave Edit out of the ⋯ menu.

3. **At 800×360 the floor action bar is cut off.** In `owner-floor_v1-land800-open` and `-versions`, the 128 px right column shows "Versions | Abou…" side by side, and **Ask for a change** is off-screen. The cause is `FloorCanvasPane.tsx:36`, which always uses a horizontal `flex min-h-14 items-center` row.
   **Change:** copy the page bar from `CanvasPane.tsx:56`: `` className={`flex h-full w-full min-w-0 ${context.landscape?'flex-col':'items-center'}`} ``, with ‹ (Previous version / No earlier version), **Versions**, › (Next version / No newer version) and a primary `flex-1 bg-ai-soft text-ai-2` **Ask for a change**. This also matches the §7.1 wireframe. Drop **About** from the bar, since it moves into ⋯ under fix 1.

4. **The floor scale bar collides with the zoom controls.** Pane controls are `components/floor/Designer.tsx:405` (`absolute bottom-2 left-2 right-2`). `Canvas2D`'s ScaleControl (`components/floor/Canvas2D.tsx:1354`, which renders at `absolute bottom-2 right-2`, line 1398) sits in the same place:
   - At 1280 and 1100, "4' 0"" runs under the − button.
   - At 360, 390 and 820 it is cut off by Fit, and a stray "2" peeks out from the hidden scale label.
   - At 800×360 it is cut off by Fit.

   **Change:** give `Canvas2D` an inset prop (for example `scaleInset`) that Designer sets in its `embeddedPreview` branch, and have `ScaleControl` add it to its bottom offset (`style={{bottom: 8 + inset}}`, about 56 px when embedded), so the bar sits just above the pane controls. Don't turn the pane controls into a separate row: that would push the 800×360 stage below 200 px.

5. **The floor title loses the version number on phones, uses the canvas title instead of the design name, and doesn't follow the compact layout.** `FloorCanvasPane.tsx:32` builds `Floor plan · ${v.title} · v${n}`, which here gives "Floor plan · QA Joe · Kitchen floor plan · v1 ▾". At 360 that already fills the row, so any real job name ("Larson bath main floor addition") will cut off the "· v1 ▾" end, the one part that tells Joe which version he is looking at. §7.1 says the title must match the `DesignsStrip` chip, which uses the design's name, and the §7.1 compact wireframe is `‹ Chat · Kitchen layout ▾ · ⋯` over `Floor plan · v5`.
   **Change:**
   - Use the design name (`floor.props.design.name`, already used for the stage's `aria-label` at `FloorCanvasStage.tsx:19`) instead of `v.title`, here and in the picker and version rows.
   - When `context.compact`, the title is the name alone and the meta row (`FloorCanvasPane.tsx:35`) reads `Floor plan · v{n} · Read only`.
   - Fuller panes keep `Floor plan · {name} · v{n}`.

6. **Canvas cards use the wrong icon and label.** `components/panel/CanvasCard.tsx:4,22` always draws `Workflow`, so the Page card in every thread shot has the diagram icon. Line 9 maps `floor_plan` to "Canvas", so a floor card would read "Canvas · v1" instead of "Floor plan · v1" (§4.1 card anatomy, §7.1).
   **Change:** import `FileText` and `LayoutGrid`. Use `Workflow` for diagram, `FileText` for page, `LayoutGrid` for floor_plan, and set `label = kind==='page'?'Page':kind==='diagram'?'Diagram':kind==='floor_plan'?'Floor plan':'Canvas'`. The accessible name follows automatically ("…, floor plan, floor plan v1": simplify that to `Open canvas: {title}, floor plan, v{n}`).

7. **Floor canvases are mislabeled in the picker, and floor panes open a different picker.**
   - `components/panel/CanvasPane.tsx:90` labels every non-page row "Diagram · Version n", so a floor canvas in a page or diagram pane's picker reads "Diagram · Version 3".
   - `FloorCanvasPane.tsx:43` opens a second picker titled "Canvases". It shows plain titles with no type or version for other canvases, has no ✓, and its rows are not the 56 px rows of §4.1.

   **Change:** in `CanvasPane.tsx:90`, label rows `Page · Version n` / `Diagram · Version n` / `Floor plan · v{design.number}`. Have `FloorCanvasPane` reuse that same "Canvases in this chat" overlay (move it into one shared component) instead of its own.

8. **Empty-state copy leaves out floor plans.** `CanvasPane.tsx:64` (and the empty picker at :90) say "No canvas yet. Ask for a diagram or a page." With Phase 3 integrated, §4 says **"No canvas yet. Ask for a diagram, a page, or a floor plan."**
   **Change:** use the §4 sentence when `availability.floor` is true, and keep the current sentence otherwise.

9. **Screenshot gaps that block the Phase 2/3 exit criteria (completeness).** Recapture in round 2:
   - **Save dialog at 360.** `owner-` and `staff-page_v2-phone360-save-dialog` are pixel-identical to the plain stage, so the dialog never opened. The phone-width fit of the Save dialog (§4.2 360 wireframe) is unproven for pages. Open it through ⋯ → Save to project files, and capture both an unpicked project and a picked project (audience radios visible for Joe, read-only chips for Abigail).
   - **Cards and table at 360 and 820.** Only `page_v1-desk1280-wrapper` shows the cards/table fixture. The Phase 2 exit ("adapts to all three widths") is about exactly that content. Capture `page_v1` in-pane at phone360, ipad820 and land800.
   - **Floor card in chat.** It is never in frame in any `floor_v1-*-thread` shot. Capture the floor card, plus the older-version card ("Open floor plan v1 · Newer version available").
   - **Floor ⋯ open (after fix 1).** At 360: hint plus Open floor plan ↗. At 1100: Edit floor plan ↗, no hint. At 1280: the visible Edit button. Also staff (view-only, if applicable).
   - **Page ⋯ open at 360.** Show code, About this page, Save to project files, Download ▸ Page (HTML), Print / Save PDF, Open in new tab, Delete canvas….
   - **Page loading, error and retry.** Capture "Opening page…", then after a blocked preview the 10 s copy "Claude's page couldn't be shown." with Show code / Ask Claude to try again / Try again, as listed in the Phase 2 handoff matrix.
   - **Floor restore.** Two pinned design numbers, the older one selected, "Use this version" confirm, and the result.

## Coordinator's notes, judged

- **Scale bar vs zoom controls at 1280, cut off at 360:** confirmed, and it happens at every width. **Required** (fix 4).
- **Edit/Open floor plan hidden behind "›⋯":** confirmed. **Required** (fixes 1 and 2).
- **Floor title "Floor plan · QA Joe · Kitchen floor plan · v1":** the "QA Joe ·" part comes from the seed's canvas title, but the code uses the canvas title where §7.1 wants the design name, and the long string risks cutting off "v1" on phones. **Required** (fix 5).
- **Page iframe 600 px tall at every width:** confirmed, but not a visible defect in these shots. The frame background matches the card, and taller content (v1) still grows the frame and scrolls in the stage. The cause is that the bridge measures `max(documentElement.scrollHeight, body.scrollHeight)` (`lib/canvas-renderer.mjs:308`), which can never be less than the frame's own 600 px starting height (`PageStage.tsx:9`). The frame can grow but never shrink. That leaves extra blank scroll after rotating or after a shorter version replaces a longer one. **Optional** (O1).

## Optional

- O1. **Let the page frame shrink.** In the page bridge, measure the content (`document.body.getBoundingClientRect().height` plus body margins, or a wrapper element's height) instead of `scrollHeight`, and start `PageStage.tsx:9` at about 200 instead of 600. This removes empty scroll in landscape and after version changes.
- O2. **Page Fit and 100% do the same thing.** In `PageStage.tsx:18`, both call `setScale(1)`. Either make **Fit** scale to fit the whole page height in the stage (`stageHeight / frameHeight`, capped at 1), or show just one of them for pages. Two buttons with identical results is confusing.
- O3. **Show which of 2D/3D is on.** `Designer.tsx:406–407` set `aria-pressed` but don't style it. Add `aria-pressed:bg-ink aria-pressed:text-paper`.
- O4. **Put the change notice in the meta row.** "The floor plan changed. Load latest" currently takes its own 44 px row above the stage (`FloorCanvasStage.tsx:20`). §7 puts it in the metadata row. Move it there (the row may grow to 44 px only while the notice shows), which gives the stage back roughly 44 px on phones.
- O5. **Match the floor restore confirm to the page one.** Title it **Make floor plan v1 the latest?** (`FloorCanvasPane.tsx:45`), in line with §4.1's "Make Version 1 the latest?". The body copy ("Your newer versions will stay. The full designer will keep its current drawing.") is good and should stay.
- O6. **Wrap long code lines.** The Code view's single-line canonical HTML scrolls sideways for a long way (`owner-page_v2-desk1280-code`). Consider `whitespace-pre-wrap break-all` for page code, so the source can be read without scrolling.
- O7. **Spell out "Untrusted text".** "Page code · Untrusted text" works, but "Text only. Not run." would be plainer for Joe. Change it only if the Phase 1 diagram code label changes too.
