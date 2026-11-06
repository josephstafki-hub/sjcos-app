SCORES: design=10 completeness=10

# Canvas Phase 2 + 3, build round 4: design review

Judge: design lens. Branch `t3/canvas-phase2-3` @ `e5970856`. Evidence: the 121 PNGs in `/home/joe/qa-sjcos/abc/shots/c23-r4/` and `summary.txt` (positive control passed; no leaks, no overflow, no stray frames; the only console errors are the expected 404s on the other person's canvas). I read them against my r3 review and the code at `components/panel/canvas/floor/FloorCanvasPane.tsx`. I ran no build, server or browser.

## Round 3 required fix: verified

**An older floor version now says a newer version is ready (`FloorCanvasPane.tsx:43–51`).**
- `owner-floor-desk1280-selected-v1` shows the title "Floor plan · QA Joe kitchen · v1 ▾" and the meta row "Floor plan · v1 · Read only · Floor plan v2 is ready **Latest**". The page pane uses this same pattern. "The floor plan changed" and "Load latest" are both gone from the older version.
- **Latest** only navigates (`selectCanvasVersion`) and changes nothing. Load latest (`mutate('latest')`) now appears only when `!older`, which matches §7.1.
- At <640 px the "Floor plan" word is hidden, so the row reads "v2 is ready Latest". The row fits at 360: the "Read only" span is about 142 px and the notice about 110 px, inside a 344 px row.
- When the head's design number isn't known yet (a stale store), the row falls back to "A newer version is ready **Latest**". The head is taken as `max(data, store)`, so a newer polled head is never hidden.
- The change note is suppressed on older versions. The newest version keeps its change note when there is no designer change.
- Tests in `tests/floor-ui.test.mjs` cover: the older version, the unknown number, the stale head, the newest version with a note, and the newest version with a change.
- `-selected-v1-menu`: ⋯ offers About / **Use this version** / Copy link / a rule / red **Delete canvas…**. The Edit link is not duplicated at 1280.

## Round 3 screenshots: all supplied

- **Restore result.**
  - `-used-v1-confirm` shows "Make floor plan v1 the latest?" with "Your newer versions will stay. The full designer will keep its current drawing." and **Use this version** / Cancel.
  - `-used-v1` is the state after confirming. The pane shows v1's drawing (one B24) and the title "· v1". The meta row now carries "The floor plan changed. Load latest". That notice can only appear when `!older`, so v1 is now the newest Canvas version. The notice is right, because the designer's live drawing is still v2. It is also what the confirm sentence warned about.
- **Joe's 360 Save dialog, scrolled to the bottom** (`owner-page_v2-phone360-save-picked-scrolled`): the whole dialog scrolls, not just the inner list. You see the area list end (Leads, Subs), then ○ **Only Joe**, "Only Joe and staff with every ticked area can read this copy.", and "It won't appear on the client portal." Cancel / Save stay in the sticky footer.
- **"Only Joe" picked** (`-save-only-joe`): the area list collapses and both radios sit together. "Only Joe can read this copy." and the portal line appear, and everything fits on one 360 screen without scrolling. This also mostly answers O14: once Joe touches the choice, both options are side by side.
- **Abigail's 360 Save** (`staff-page_v2-phone360-save-picked(-scrolled)`): 🔒 **Staff**, "Staff who can open QA Canvas empty project files can read this copy.", the portal line, then Cancel / Save. It fits without scrolling, and no owner-only control leaks to staff.

## Fresh pass, every width

- **Plain words.** Canvas, page, floor plan, version and latest are used throughout. "Read only", "v2 is ready Latest", "Changed. Load latest", "Loaded latest floor plan", "Edit on a tablet or computer", "Make floor plan v1 the latest?" and "It won't appear on the client portal." No jargon or internal ids appear anywhere.
- **44 px phone targets.** At 360 and 390, ‹ Chat, title ▾, ⋯, 2D/3D, Fit/100%, ‹ Versions ›, Ask for a change and the dialog's Close / Untick all / Save all meet 44 px. Sheet rows are 56 px. Save-dialog checkbox rows are 48 px. The meta-row **Latest** / **Load latest** remain inline text links, the §3.1 pattern accepted in r2 and r3.
- **One way back to chat.**
  - ‹ Chat on compact panes (360/390, landscape 800).
  - × on split panes (820/1100/1280).
  - × in the new-tab wrapper.
  - ‹ Chat on the unavailable screen (`*-wrapper-OTHER`).
- **States.** Loading ("Opening page…" on a plain card), error, retry, Code view, versions (one and two), changed, loaded latest, older version, restore confirm, restored, and unavailable are all pictured and all read clearly.
- **Owner vs staff.** The screens match apart from names and the Save audience block. Staff floor menus at 360 show the hint "Edit on a tablet or computer" over **Open floor plan ↗**, and at ≥820 the visible **Edit floor plan ↗**, which is correct for staff with Projects.
- **Readable pages at 360.** `owner-page_v2-phone360-open` shows the page at its natural size with a 100% chip. The text is readable without zoom.
- **Floor read-only clarity and designer handoff.**
  - Every width says "Read only". There are no tools, inspector or estimate controls.
  - The handoff is the visible button at ≥820 px and ⋯ › **Open floor plan ↗** below that.
  - Landscape 800×360 keeps ‹ Versions › over a wrapping **Ask for a change**.
- **Version history / restore.**
  - Rows read "Floor plan · v2 ✓ / Loaded latest floor plan · Joe Stafki · 2:42 PM" and "Floor plan · v1 · Joe Stafki · 2:36 PM".
  - Older versions point to Latest.
  - Restore asks first and says what stays.
- **Pronouns.** No run-time person gets a pronoun. Bylines are names only.

## REQUIRED fixes

None.

## Optional

- O6/O7 (carried). Wrap long lines in the Code view, and consider "Text only. Not run." in place of "Untrusted text".
- O8 (carried). On fuller panes "Floor plan" now appears up to three times across the title and meta row (e.g. "Floor plan · QA Joe kitchen · v1" / "Floor plan · v1 · Read only · Floor plan v2 is ready"). When `!context.compact`, the meta row could start at "Read only".
- O9 (carried). The page landscape bar stacks ‹ / Versions / ›. Use the floor bar's one-row layout.
- O10 (carried). The new-tab wrapper's focus ring on load should use `focus-visible`.
- O11 (carried). Picker rows have no type icon or time (§4.1).
- O12 (carried). Disabled ‹ / › should get `disabled:opacity-40`.
- O13 (carried). Give **Use this version** in both restore confirms (`FloorCanvasPane.tsx:78`, `CanvasPane.tsx`) the primary fill.
  - Related: the floor pane's **Ask for a change** (`FloorCanvasPane.tsx:59`) is outlined, while the page pane's is filled teal (`owner-page_v2-phone360-open` vs `owner-floor_v1-phone360-open`). Use one style for both.
  - The Save dialog's **Save** is outlined too.
- O14 (softened). The Only Joe shot shows both radios together once chosen. A "Only Joe below" hint while Share is selected is still a nice touch at 360.
- O15. Right after a restore, the meta row says "The floor plan changed. Load latest" (`-used-v1`). That is accurate, but it reads as if something went wrong just after Joe chose v1. Two options:
  - Show a one-time notice "Floor plan v1 is now the latest." after a successful restore (`FloorCanvasPane.tsx:29`, alongside the `!result.changed` notice).
  - On ≥640, word the changed notice "The designer has a newer drawing. Load latest".
- O16. The fallback "A newer version is ready Latest" (`FloorCanvasPane.tsx:49`) isn't shortened at 360. It still fits (about 335 of 344 px) but with no slack. "Newer version ready" below 640 would leave room.

## Screenshots still needed

None. Nice-to-have only:
- `owner-floor-phone360-selected-v1`, the older-version notice at 360. It is covered by code and the width math.
- The Versions sheet after a restore, showing three entries with v3 "Floor plan · v1 ✓" on top.
