SCORES: design=9 completeness=8

# Canvas Phase 2 + 3, build round 2: design review

Judge: design lens. Branch `t3/canvas-phase2-3` @ `12d0f9c5`. Evidence: the PNGs in `/home/joe/qa-sjcos/abc/shots/c23-r2/` and `summary.txt` / `summary-menu.txt`, read against plan §1 Words used, §3.1–3.2, §4/4.1/4.2, §6.5, §7/7.1 and §10, plus the code behind each screen. I ran no build, server or browser.

## Round 1 fixes, checked

1. **Floor ⋯ menu: fixed, with leftovers.** The stray "› ⋯" over the drawing is gone. A 44 px ⋯ now sits in the title row (`FloorCanvasPane.tsx:38`). The menu order is right: hint (<640 only) → Open/Edit floor plan ↗ → About this floor plan → Use this version → Copy link → Delete canvas…. At 360 it is a bottom sheet with the hint, at 1100/1280 a desktop menu with no hint. Leftovers are required fixes 1–3 below.
2. **Visible "Edit floor plan ↗" on fuller panes: fixed.** It shows at 820, 1100 and 1280. The duplicate menu row is still there (fix 1).
3. **800×360 floor bar: fixed.** "‹ Versions ›" sits above a full-width **Ask for a change** in the 128 px right column, and nothing is cut off (`owner-floor_v1-land800-open`, `-3d`).
4. **Scale bar vs zoom controls: fixed.** "4' 0"" / "2' 0"" / "10' 0"" now sit above Fit/100% and −/+ at every width. No stray "2".
5. **Floor title: fixed in the pane, not elsewhere.**
   - Compact panes read "QA Joe kitchen ▾" over "Floor plan · v1 · Read only".
   - Fuller panes read "Floor plan · QA Joe kitchen · v1 ▾".
   - Version rows, picker rows and chat cards still use the canvas title (fix 4).
6. **Card icons and labels: fixed.** The page card has FileText and "Page · Version 2". The floor card has LayoutGrid and "Floor plan · v1 · Newer version available" with **Open floor plan v1**, and the newest card reads "Floor plan · v2" (`*-floor-desk1280-chat-card`).
7. **One picker with floor labels: fixed.** One shared "Canvases in this chat" sheet (`CanvasPane.tsx:53`), with rows labeled Page · Version n / Diagram · Version n / Floor plan · v{n}.
8. **Floor-aware empty copy: fixed** (`CanvasPane.tsx:50`).
9. **Screenshot gaps: mostly closed.** New this round:
   - Page ⋯ at 360
   - Save dialog at 360 (unpicked)
   - Cards and table at 360/820/800
   - Floor ⋯ at 360/1100/1280 for owner and staff
   - Floor chat cards
   - Page loading / error / retry
   - Load latest and two-version history

   Still missing: a picked Save dialog, the floor restore flow, and a view-only floor menu (see the last section).

Optional items from round 1: O1 (frame shrinks, start height 200) and O2 (one 100% reset) are done, and O3 (2D/3D pressed state) is clearly visible. O4 is partly done: the notice is now in the meta row ("Changed. Load latest" at <640). O5–O7 are not done; they are restated below.

## What works

- **Phone pages read well.** Page ⋯ at 360 is a bottom sheet with 56 px rows in the §6.5 order (Show code, About this page, Save to project files, › Download, Print / Save PDF, Open in new tab, divider, Delete canvas…). The cards/table page stacks cleanly at 360 and sits side by side at 820. No overflow at any width.
- **Save dialog fits at 360.** Title, "Canvas: QA Joe · Weekly board · Version 2", Project picker with search, Filename, "Choose a project.", Cancel and a disabled Save all fit on screen, for both owner and staff (`*-page_v2-phone360-save-dialog-r2`).
- **Error state is plain and useful:** "Claude's page couldn't be shown." with **Show code / Ask Claude to try again / Try again**. Retry recovers to the page (`*-desk1280-error`, `-retry`).
- **Floor read-only is clear.** The meta row says "Read only". There are no tools, inspector or estimate controls. Load latest gives "Loaded latest floor plan" and v2. Edit links point to the canonical `/floor/9`.
- **One way back at each width:** ‹ Chat on compact panes, × on split, × in the new-tab wrapper. The other person's canvas still shows only "This canvas isn't available to this account." with one exit.
- **Owner and staff match** apart from names. No run-time name is given a pronoun in any copy I read.

## REQUIRED fixes

1. **"Edit floor plan ↗" appears twice when the button is already visible.** At 820, 1100 and 1280 the title row has the button and the ⋯ menu repeats it as its first row (`owner-floor_v1-pop1100-menu`, `-desk1280-menu`, `staff-floor_v1-desk1280-menu`). §6.5: "Fuller editable panes have the visible **Edit floor plan** button, without a duplicate Open menu row; fuller view-only panes keep **Open floor plan** in ⋯."
   **Change:**
   - `components/panel/canvas/floor/FloorCanvasPane.tsx:37`: render the visible link only when `canEdit`, with the label **Edit floor plan ↗** only.
   - `FloorCanvasPane.tsx:63`: when `canEdit`, add `min-[820px]:hidden` to the menu `<a>`, so the menu link hides at exactly the breakpoint where the visible button appears.
   - View-only people keep **Open floor plan ↗** in ⋯ at every width.

2. **"Use this version" looks tappable on the latest version but does nothing.** `FloorCanvasPane.tsx:65` renders it `disabled` when `v.version===canvas.latest_version` and gives it no disabled styling. It looks live in every floor menu shot, including `owner-floor-desk1280-used-v1`, which is on v2 (latest). That is likely why the QA script's "Use this version" step never completed. §4.1 and my round 1 note: the row appears only when an older version is selected.
   **Change:** render the button only when `v.version<canvas.latest_version`; omit it rather than disabling it.

3. **Floor menu rows are 44 px; page menu rows are 56 px.** §6.5: "phone/iPad use a bottom sheet of 56 px rows". The page menu follows this (`min-h-14`, `owner-page_v2-phone360-menu`). The floor sheet at 360 uses `min-h-11` rows (`owner-floor_v1-phone360-menu`).
   **Change:** in `FloorCanvasPane.tsx:63–67`, change `min-h-11` to `min-h-14` on the Open/Edit `<a>` and on the About, Use this version, Copy link and Delete buttons. Put the divider (`border-t border-rule`) above **Delete canvas…**, as the page menu has it.

4. **Floor names don't match between header, card, picker and versions** (the rest of round 1 fix 5). The pane header says "QA Joe kitchen", the design's name. The chat card Joe tapped, the picker row and every version row say "QA Joe · Kitchen floor plan", the canvas title: "Floor plan · QA Joe · Kitchen floor plan · v2" (`owner-floor-desk1280-versions-two`, `-phone360-versions`). §7.1: "Floor pane title/list/cards show **Floor plan · Kitchen layout · v5**, matching `DesignsStrip` chips."
   **Change:**
   - `components/panel/CanvasVersions.tsx:12`: floor rows read `Floor plan · v${v.design.number}`. The header already names the design, and this also stops the long name wrapping at 360.
   - Add `name:string` to `VersionMeta.design` (`lib/canvas-api-types.ts:6`) and fill it from `plan_designs.name` in the two `design:{…}` builders (`lib/canvas-floor.ts:32/39/77`; the line-38 read needs one more join to `plan_designs`).
   - Then use `item.latest.design?.name ?? item.latest.title` for floor rows in the picker (`CanvasPane.tsx:53`) and for the floor card title (`components/panel/CanvasCard.tsx`).
   - Note: `canvas-floor.ts` carries a reviewed source digest, so the allowlist needs a re-audit.

5. **While a page is loading, the browser's own error page shows through.** `owner-page_v2-desk1280-loading` shows "Opening page…" drawn over Chromium's "The webpage at http://localhost:3093/api/canvas/…/versions/2/preview might be temporarily down…". The raw preview URL and a browser message are visible for up to 10 s, until the timeout copy appears. `PageStage.tsx:17` shows the iframe before the bridge says it is ready.
   **Change:** in `components/panel/canvas/PageStage.tsx:17`, add `visibility: ready ? 'visible' : 'hidden'` to the iframe `style`. The frame still loads and the bridge still connects; nothing but "Opening page…" shows until ready. Also hide the zoom group on line 18 until `ready`.

## Optional

- O5 (carried over). Title the floor restore confirm **Make floor plan v{n} the latest?** (`FloorCanvasPane.tsx:70`, now "Use floor plan v1?") so it matches the page's "Make Version 1 the latest?". Keep the body copy.
- O6/O7 (carried over). Wrap long code lines in the Code view, and consider "Text only. Not run." in place of "Untrusted text".
- O8. Fuller floor panes say "Floor plan · v1" twice: in the title and again in the meta row. On fuller panes the meta row could read just "Read only" plus the change notice (`FloorCanvasPane.tsx:41`, when `!context.compact`).
- O9. Make the landscape bars match. On a page at 800×360, ‹ / Versions / › stack as three tall rows and Ask fills the rest. On a floor plan, "‹ Versions ›" is one row and Ask is a small button. Either is fine; pick one (the floor version reads better).
- O10. The new-tab wrapper focuses the title button on load, and its focus ring makes it look like a text box (`*-page_v1-*-wrapper`). Use `focus-visible` styling so the ring only shows for keyboard focus.
- O11. Picker rows still have no type icon or time (§4.1 lists "type icon, title, Version n, time, current tick"). Reuse the card's icon map.
- O12. Disabled ‹ / › in the bottom bars look the same as enabled ones. Add `disabled:opacity-40`, here and anywhere else a disabled button has no styling.

## Screenshots still needed for a 10

- **Save dialog at 360 with a project picked:** Joe sees the **Share with staff / Only Joe** radios and the permission checkbox rows; Abigail sees the read-only chips. Confirm Save stays on screen.
- **Floor restore end to end:** select v1 in Versions (the `selected-v1` shot is still on v2, so selecting a row is unverified), then ⋯ with **Use this version** showing, then the confirm, then the result ("Floor plan · v1" as the newest entry, with "Use this version" gone).
- **View-only floor menu at 1280** (someone without edit rights): no visible Edit button, and **Open floor plan ↗** in ⋯.
- After fixes 1–3 and 5: recapture the floor ⋯ at 360/1100/1280 and the page loading state.
