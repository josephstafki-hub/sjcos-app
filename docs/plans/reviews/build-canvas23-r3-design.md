SCORES: design=9 completeness=9

# Canvas Phase 2 + 3, build round 3: design review

Judge: design lens. Branch `t3/canvas-phase2-3` @ `122e850a` (commits since r2: 5f5a0fc8, 5257cd61, 68802636, 122e850a). Evidence: the PNGs in `/home/joe/qa-sjcos/abc/shots/c23-r3/`, `summary.txt` / `summary-floor.txt` / `c23-r3-floor.out`, and the QA script `shoot-c23.mjs`, read against plan §1, §3, §4, §6.5, §7/7.1 and §10, plus the code behind each screen. I ran no build, server or browser.

## Round 2 required fixes, checked

1. **Duplicate "Edit floor plan ↗": fixed.**
   - At 1100 and 1280 the title row has the visible **Edit floor plan ↗**, and the ⋯ menu starts at **About this floor plan**. This holds for owner and staff (`owner-floor_v1-pop1100-menu`, `-desk1280-menu`, `staff-floor_v1-desk1280-menu`).
   - At 360 the sheet keeps the hint **Edit on a tablet or computer** above **Open floor plan ↗** (`owner-floor_v1-phone360-menu`).
   - Code: the visible link renders only when `canEdit` (`FloorCanvasPane.tsx:37`), and the menu link is `min-[820px]:hidden` when `canEdit` (`:63`).
2. **Dead "Use this version" on the latest version: fixed.**
   - The row is now left out when you are on the latest version (`FloorCanvasPane.tsx:65`). Every latest-version menu shows About / Copy link / Delete only.
   - On an older version it appears (`owner-floor-desk1280-selected-v1-menu`).
3. **56 px floor rows and divider: fixed.** The floor sheet at 360 and the desktop menu now use 56 px rows, with a rule above the red **Delete canvas…**. They match the page menu.
4. **Design name in cards, picker and versions: fixed.**
   - Chat card: **QA Joe kitchen** / "Floor plan · v1" (`owner-floor-desk1280-chat-card`).
   - Picker rows use `design_name` (`CanvasPane.tsx:71`).
   - Version rows read **Floor plan · v2 ✓** / **Floor plan · v1** with byline and time (`owner-floor-desk1280-versions-two`, `-phone360-versions`). No more wrapping at 360.
5. **Iframe/zoom hidden until the page is ready: fixed.** `owner-page_v2-desk1280-loading` shows only "Opening page…" on a plain card. There is no Chromium error page, no raw preview URL and no zoom group (`PageStage.tsx:17–18`).

Also done: O5. The restore confirm now reads **Make floor plan v1 the latest?**, matching the page's "Make Version n the latest?" (`owner-floor-desk1280-used-v1`).

## Round 2 unverified screens, now checked

- **360 Save dialog with a project picked.**
  - Joe's dialog: Canvas line, Project "QA Canvas empty project ▾", Filename, ◉ **Share with staff**, the "Claude may have used anything in this chat, so every area is ticked." line, 48 px **Untick all**, and the 48 px area list scrolling inside its own box. Cancel / **Save** stay pinned in the sticky footer, which is on screen in both shots.
  - Abigail's dialog: **🔒 Staff**, "Staff who can open QA Canvas empty project files can read this copy.", "It won't appear on the client portal.", then Cancel / Save. It's clean and fits without scrolling.
  - Gap: the `-scrolled` shot scrolled only the inner area list, not the dialog. Joe's **○ Only Joe** radio, the audience sentence and the portal line below the list are still unseen at 360 (see the screenshot list).
- **Floor restore.**
  - The two-version list is clear. Selecting v1 works: the header reads "Floor plan · QA Joe kitchen · v1", the drawing shows one B24, and v2 shows two.
  - ⋯ on v1 offers **Use this version**, and the confirm reads well.
  - The script took `-used-v1` *before* it pressed the confirm's button (`shoot-c23.mjs:166–168` clicks the menu row once, which only opens the confirm). So the end state is not pictured: v1 as the newest entry with "Use this version" gone.
- **View-only floor menu: acceptable as unreachable.**
  - `assertFloorAccess` (`lib/canvas-floor.ts:13–17`) admits only the owner, or staff with Projects (plus Leads for a lead design). Those are exactly the people the full designer lets edit. The app has no "can see floors but not edit" role, so `can_edit` is always true whenever a floor canvas renders. Everyone else gets the plain "This canvas isn't available to this account." with one **‹ Chat** (`*-floor_v1-desk1280-wrapper-OTHER`).
  - §6.5's view-only wording is conditional ("A view-only person gets…"). §7.1 says "Without projects area, show unavailable", which is what happens.
  - The `canEdit=false` branch is still coded correctly (no visible button, **Open floor plan ↗** in ⋯ at every width), so a future view-only role would get the right menu. No view-only path is required.

## Fresh pass

- **Plain words.** No jargon on screen: "Read only", "The floor plan changed. Load latest", "Loaded latest floor plan", "Opening page…", "Edit on a tablet or computer", "Make floor plan v1 the latest?". The words match §1 (canvas, page, floor plan, version, latest).
- **44 px targets at 360.** ‹ Chat, title ▾, ⋯, 2D/3D, Fit/100%, ‹ Versions › and Ask for a change all meet the size. Sheet rows are 56 px. "Load latest" is an inline text link in the 20 px meta row, the same pattern §3.1 sets for **[Latest]**.
- **One way back at every width:** ‹ Chat on compact panes, × on split panes, × in the new-tab wrapper, ‹ Chat on the unavailable screen.
- **Floor read-only clarity.** Every width has "Read only" in the meta row, no tools, no inspector and no estimate controls. The designer handoff is the visible button at ≥820 px and in ⋯ below that. Landscape 800×360 keeps "‹ Versions ›" over a wrapping **Ask for a change** in the right column.
- **Owner vs staff** match apart from names and the Save audience block, as the plan intends. No run-time name gets a pronoun anywhere.
- **The logs are clean:** no overflow, no leaks, no frames, and no console errors except the expected 404 on the other person's canvas.

## REQUIRED fixes

1. **An older floor version says "The floor plan changed" instead of saying a newer version is ready.**
   - What Joe sees: in `owner-floor-desk1280-selected-v1`, Joe is looking back at v1 while v2 already exists. The meta row reads "Floor plan · v1 · Read only · The floor plan changed. Load latest". Nothing says v2 is already there.
   - Why it happens: `floor.changed` compares the *selected* snapshot with the designer's live drawing (`lib/canvas-floor.ts:53–56`), so every older version reports "changed".
   - Why it confuses: pressing **Load latest** there returns changed=false and shows "This floor plan is already current." (`FloorCanvasPane.tsx:30`). Joe gets told the plan changed, then told it's current.
   - The page pane already does this right with "· Version {n} is ready [Latest]" (`CanvasPane.tsx:79`). Plan §3.1 and the §194 state table call for that same meta-row notice whenever a newer version exists. §7.1 limits **Load latest** to a new design revision.
   - **Change** (meta slot in `components/panel/canvas/floor/FloorCanvasPane.tsx:40–44`):
     - Compute
       ```ts
       const item=state.items.find(x=>x.canvas.id===canvas.id);
       const latestVersion=item?.canvas.latest_version??canvas.latest_version;
       const older=v.version<latestVersion;
       const latestNumber=item?.latest.design?.number;
       ```
     - When `older`, render
       ```tsx
       <span role="status" className="flex shrink-0 items-center gap-1"><span className="hidden min-[640px]:inline">Floor plan</span> v{latestNumber} is ready <button className="shrink-0 underline" onClick={()=>selectCanvasVersion(canvas.id,latestVersion)}>Latest</button></span>
       ```
       This reads "Floor plan v2 is ready Latest" on wider panes and "v2 is ready Latest" at 360.
     - Show the existing `floor?.changed` "The floor plan changed. Load latest" span only when `!older`. The change-note fallback also only when `!older`.
     - Load latest then always starts from the newest version, as §7.1 describes.

## Optional

- O6/O7 (carried over). Wrap long lines in the Code view, and consider "Text only. Not run." in place of "Untrusted text".
- O8 (carried over). Fuller floor panes say "Floor plan · v1" in both the title and the meta row. When `!context.compact` the meta row could start at "Read only".
- O9 (carried over). The page landscape bar stacks ‹ / Versions / › as three rows, while the floor bar uses one row. Use the floor layout for both.
- O10 (carried over). The new-tab wrapper focuses the title button on load and draws a ring that looks like a text box. Use `focus-visible` styling.
- O11 (carried over). Picker rows still have no type icon or time (§4.1). Reuse the card icon map.
- O12 (carried over). Disabled ‹ / › look the same as enabled ones (e.g. › on the latest version). Add `disabled:opacity-40`.
- O13. In both restore confirms (`FloorCanvasPane.tsx:70`, `CanvasPane.tsx:126`), **Use this version** and **Cancel** look equally weighted. Give **Use this version** the primary fill used by **Ask for a change** so the main action is obvious.
- O14. At 360, Joe sees only **◉ Share with staff** above the fold. **○ Only Joe** sits below a 21-row scroll box, so the choice looks like a single radio. The plan puts it there, so this is not required. A one-line "or keep it to yourself: Only Joe below" hint, or moving **Only Joe** directly under **Share with staff** on <640, would make the choice visible.

## Screenshots still needed for a 10

- **Floor restore result:** in `shoot-c23.mjs:166`, press **Use this version** inside the confirm too, then capture. It should show "Floor plan · QA Joe kitchen · v1" as the newest entry, Versions listing "Floor plan · v1 ✓" on top, and no **Use this version** in ⋯.
- **Owner 360 Save dialog scrolled to the bottom:** scroll the dialog, not the area list. **○ Only Joe**, the audience sentence and "It won't appear on the client portal." should be visible above the sticky footer. Add one shot with **Only Joe** picked ("Only Joe can read this copy.").
- **After fix 1:** `owner-floor-desk1280-selected-v1` showing "Floor plan v2 is ready Latest" and no "changed" notice, plus the same state at 360.
