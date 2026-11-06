SCORES: design=9 completeness=8

# Round 3 — Design & UX judge — Ask-panel Canvas plan

Judged `docs/plans/ask-canvas-plan.md` and the shared `docs/plans/_ask-pane-host.md` at `4f22bd30`,
against Joe's decisions 1–9 plus the coordinator ruling (staff-saved copies require only
content-derived areas), my round-1 and round-2 reviews, and the real UI:
`components/panel/PanelHost.tsx:237–268` (sheet: `mt-2` grabber + `h-1`, `py-2` header with 44 px
buttons = **72 px**; existing × label "Close operator panel"), `PanelDock.tsx:77–80` (narrow
`Segmented` `h-12` inside a `p-2 gap-2` column = **64 px** with padding and gap),
`components/projects/ProjectFiles.tsx:200–260` (name `flex-1 min-w-0 truncate`, meta line
`font-mono text-[10px]`, "On dashboard" chip `flex-none` beside size, Eye button),
`lib/permissions.ts:73–115` (23 keys; `money` label **"All other financials"**), and
`components/settings/TeamAccess.tsx:108` (Team page renders `p.label`).

## Round-2 items: verified / not fixed

| # | Item | Status |
|---|---|---|
| 1 | Phone room for the diagram | **Verified for Diagram/Page.** Compact 48/20/56 rows, floating Fit/100%, ⋯ holds the rest, ≥420 px rule stated, 360 redrawn. The budget's chrome figure is low, and the floor 360 frame breaks the rule. See required 2–3. |
| 2 | Save dialog under decision 9 | **Verified.** Checklist drawn at 360/1280, Share first, no-tick sentence with no extra confirmation, exact ticked sentence, inline Keep-ticked line. |
| 3 | Staff saved-copy areas | **Verified** under the coordinator ruling. Content-only, no ai/projects, read-only chips, "never match your own access", three names +N more. A new issue in how the fallback looks is in required 1. |
| 4 | Dead sheet controls | **Verified.** Chevron hidden, × = Close Operator, consumes the entry, remembers the selection. H1, H3, both wireframes and the Words table agree. |
| 5 | ⋯ menu + Delete entry | **Verified** (§6.5 order per type, phone sheet / desktop menu, Delete → §8.5 confirm). Copy issues in required 4. |
| 6 | Files row Publish | **Verified** (Eye not rendered, lock "Canvas copies stay internal.", **🔒 Staff**, version in the meta line). The 360 layout of the chips is new; see required 5. |
| 7 | Card states | **Verified.** Older-version, redacted, master-off, creating, and empty-state button + prefill. |
| 8 | Desktop Back when expanded | **Verified.** H3 pushes one entry, browser Back = Back to app, app link exits then navigates once, fixtures in H5. |
| 9 | Focus + announcements | **Verified.** Title button focus, follow on/off announcements, 44 px "Remove canvas from message". |
| 10 | Wireframe copy | **Verified.** "Save to project files" at both 1280 frames, no dot on the current dock-expanded Canvas. |

All 10 items are fixed in substance. What remains is second-order: what the realistic default looks like, one undefined breakpoint, one stale wireframe, and copy that contradicts itself.

## What's strong

- The shared host now settles every cross-plan question (split numbers, exits, history, Escape layers, attention order, sheet ×) in one place, and both plans point at it. I found no contradiction between H1–H5 and Canvas §3 on the diagram path.
- The 360 diagram frame now feels like the Claude/ChatGPT phone canvas: mostly canvas, one title row, one meta row that turns into **Version 3 is ready [Latest]**, and one bottom bar whose primary action is **Ask for a change**.
- The Save dialog reads plainly on the main paths ("Staff who can open Larson bath files can read this copy.", "Joe and staff with Money and Bidding access can read this copy."). Staff get read-only chips and can't weaken anything.
- The Files row stops Joe from pressing a button that would email a client about an internal canvas. Every card state, including redacted and master-off, has exact words.

## Required to reach 10

1. **§4.2 + §9 + §12: draw what Joe actually sees when provenance is unknown. Today that is the normal case, not an edge case.** §9 says that shell/repo reads or any untracked earlier turn make completeness **unknown**, and that unknown means **full C**. C is `PERMISSION_KEYS` minus ai/projects, which is **21 areas**: Today, Inbox, Messages & calls, Team chat … through All other financials. Joe's operator runs read the repo and shell, so his everyday permit diagram will open Save with 21 boxes ticked. The sentence would read "Joe and staff with Today, Inbox, Messages & calls +18 more access can read this copy." In practice no staff member could read it. To share it with Abigail, Joe would untick 21 rows and tick **21 separate acknowledgements** ("multiple removals each have their own line"). The wireframes (Money + Bidding) and the "permit-only, ticks nothing" example don't show this path. Change:
   - When the baseline came from the unknown fallback, show one line under **Share with staff**: **"Claude may have used anything in this chat, so every area is ticked."** The audience sentence becomes **"Only Joe and staff with every ticked area can read this copy."** Use that sentence whenever more than three areas are ticked. Never use "+18 more access".
   - Add one 48 px **[Untick all]** button above the checklist. However many areas are removed, show **one** acknowledgement row: **"I checked this canvas. Share it with everyone who can open Larson bath files."** If some but not all areas are removed, show **"I understand — share without Money, Bidding +4 more"**. The server challenge already binds the exact removed set, so one acknowledgement covers that set. Per-row **Staff without Money access will be able to read this. [Keep Money ticked]** lines stay.
   - Draw this as a third Save wireframe at 360.
   - Staff: under the same fallback a staff run's create/update is refused (§9: "may block a staff write"). Say what staff see: the existing fallback line **"Claude couldn't make this canvas (not allowed). It's still in the chat as text."** Then add one plain sentence to §12, because decision 1 gave staff Canvas: **"Until Claude's reads in staff chats are fully tracked, staff may not be able to make canvases."** Alternatively, commit Phase 1 to complete provenance for business-profile runs (sjcos tools only), which removes the sentence.

2. **H3 + §3.1: define when the compact phone layout applies.** H3 fixes compact rows for "phone content mode" and §3.1 allows "fuller chrome at 820", but no rule says which widths and heights get which. A builder can't place 390/430 iPhones, a 600–744 small tablet, or a **phone in landscape (800 × 360)**. That last one is a sheet (<1024) and narrow (<840), and with 820-style chrome it would leave almost no stage. Add to H3: **"Canvas uses the compact layout when the pane is narrower than 640 px or the viewport is shorter than 600 px; otherwise the fuller layout."** Add 390 × 844 and 800 × 360 to the H5 fixture with expected results (compact). At 800 × 360 the bottom bar may sit beside the stage, but the stage must stay at least 200 px tall.

3. **§3.1 phone budget: use the real chrome numbers.** The plan reserves "≤112 px for grabber/Operator header/single selector". Measured from source, it's 72 (PanelHost header with grabber) + 64 (PanelDock `p-2` + `h-12` selector + `gap-2`) = **136 px**, plus 8 px bottom padding. Corrected: 136 + 48 + 20 + 56 + 8 + ≤80 safe areas = 348 → **452 px stage**. That still meets ≥420, with 32 px of tolerance, not 64. Replace the sentence so the Phase 1 budget test checks the right numbers and nobody shrinks the existing header to hit 112.

4. **§7.1 floor 360 wireframe contradicts the compact rule.** It shows ‹ Chat, the title, a separate `Floor plan · v5  Versions ▾` row, a `2D [3D]` row, a **`[−] Fit [+]` row** (§3.2: "no −/+ row on phones"), the hint, a link, and Ask for a change, with no `⋯`. That's about 9 rows, so the floor stage can't reach 420. Redraw it to the same structure as the diagram:
   - Row 1, 48 px: `‹ Chat · Kitchen layout ▾ · ⋯`.
   - Row 2, 20 px meta: **Floor plan · v5**.
   - Stage with floating **2D/3D**, **Fit** and **100%**.
   - Bottom bar, 56 px: `[‹] [Versions] [›] [Ask for a change]`.
   - Move **Edit on a tablet or computer** into the floor ⋯ sheet as a non-action hint row above **Open floor plan ↗**.
   - State that the ≥420 px stage rule applies to floor plans too.

5. **§6.5 + §4 + §3.2: copy that contradicts itself.**
   - The Page ⋯ entry reuses **About this diagram**. On a page it must read **About this page**, both in the menu and in the 820/1280 disclosure.
   - **Preview · Code** is a toggle name, not a menu action. In the phone ⋯ sheet the row reads **Show code**, and the code sheet's close returns to the preview.
   - The loading-timeout row (`[Try again] [Code]`) and the complexity row (`[Code]`) use the same **Show code** label.
   - §4 **unavailable** offers **[‹ Chat]** at every width. At split it must be the pane **×** (Close canvas), and at dock-expanded **Back to app**, per H1's one-exit rule. Write **"[the width's exit]"**, not a hard-coded ‹ Chat.

6. **§4.2 / §8.4 / §9: use the Team page's area names.** The plan relabels `money` as **Money** ("Team calls it All other financials"). Joe grants access on the Team page (`TeamAccess.tsx:108` renders `lib/permissions.ts` labels). When a Files chip says **🔒 Staff: Money, Bidding** and Abigail can't open it, Joe opens Team and finds no "Money" box. The checklist would also show **Money** next to **Invoices & payments**, which is equally "money" to him. Use the catalog labels verbatim and in catalog order in checkboxes, chips and sentences, e.g. **"Joe and staff with Bidding and All other financials access can read this copy."** and **🔒 Staff: Bidding, All other financials**. If "Money" is wanted, rename it in `lib/permissions.ts` so both screens match. Never use two names for one key.

7. **§8.4 Files row at 360: the chips will crush the filename.** The wireframe puts `[Canvas] [🔒 Staff: Money, Bidding]` on the name line. At 360 the row has roughly 150 px for name plus chips after the icon, size, lock and download, so a `flex-none` chip pair leaves the filename at a few characters. Specify that below 640 px both chips go into the existing meta line, e.g. `Canvas · 🔒 Staff: Bidding +1 more · Version 2 · date`, and the name line keeps the full width. At ≥640 px they may sit beside the name.

8. **§8.5 + §7.2: delete states Joe will actually hit.**
   - **Delete that fails after the fence.** §8.5 installs a per-entity deletion fence before remote work, then shows **"Couldn't delete this canvas. [Try again]"**, while the canvas is already unreadable. Joe is told it wasn't deleted and then watches it disappear. Replace the copy with **"Deleting didn't finish. The canvas stays hidden until it does. [Try again]"**. The card shows **"This canvas is being deleted."** with no title.
   - **Restore/startup gate closed** (authority unavailable): add a §4 row with Operator's words, e.g. **"Chats are paused while SJC OS checks its records. Try again in a few minutes."** Say whether the gate blocks all Ask threads or only Canvas.
   - **Floor-plan delete refusal.** §7.2 refuses with **"This floor plan is used by a canvas. Delete that canvas first."** A tombstoned canvas keeps the reference until purge 30 days later, and a staff member's private canvas is invisible to Joe. Following the instruction therefore can't work. Use:
     - When the only references are Joe's own live canvases: **"This floor plan is used by your canvas "Kitchen layout". [Open canvas]"**.
     - Otherwise: **"A canvas still uses this floor plan, so it can't be deleted yet. Canvases deleted in the last 30 days count too."**
   - The floor-plan Delete confirmation adds **"The floor plan stays on the Floor tab."**

## Optional

- §8.4: the row now has two lock glyphs that mean different things (🔒 audience chip and the "stay internal" lock in the Eye slot). Consider a non-interactive `EyeOff` in the Eye slot with the same title. It reads as "not on the client dashboard", which is exactly what it replaces.
- §4.1: a **Showing** card button that is disabled can't be focused. Use `aria-disabled="true"` so VoiceOver still announces "Showing".
- §4.2: when Save waits on an unticked acknowledgement, add the helper **"Tick the line above to save."** under the buttons. Label the 360 filename field **Filename** as the 1280 frame does.
- H3: the working sheet × changes the existing label from "Close operator panel" to "Close Operator". Fine, but say it's an intentional rename so the test fixture asserts the new one.
- Thread rail: a small canvas icon on threads with canvases (still cheap, still unaddressed).
