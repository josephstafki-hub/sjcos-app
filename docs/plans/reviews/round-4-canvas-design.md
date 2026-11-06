SCORES: design=9 completeness=9

# Round 4 — Design & UX judge — Ask-panel Canvas plan

I judged `docs/plans/ask-canvas-plan.md` (the "Round-3 fixes" appendix and every section it names) and `docs/plans/_ask-pane-host.md` at `22a48134`.

I checked them against:
- Joe's decisions 1–9 and the coordinator rulings: staff-saved copies need only content-derived areas; staff runs get complete tracked provenance; Joe's operator runs count as unknown, so every area is ticked, with **Untick all** and one acknowledgement.
- My round-2 and round-3 reviews.
- The real source:
  - `lib/permissions.ts:74–101`: 23 keys, 21 content areas once ai/projects are removed; `money` is "All other financials", and the order ends Bidding → Cost book → All other financials.
  - `components/projects/ProjectFiles.tsx:204–262`: the meta line is `flex … truncate font-mono text-[10px]`, and size, Eye and Download are `flex-none` siblings of the name column.
  - `components/panel/PanelHost.tsx:123`: the popout opens with `window.open(…, "width=1100,…")`.
  - `components/panel/PanelHost.tsx:128–187`: the dock sits left of the app view, and that view includes the 216 px Sidebar.
  - `components/shell/Sidebar.tsx:298`.

## Round-3 items: verified / not fixed

| # | Item | Status |
|---|---|---|
| 1 | Unknown provenance is Joe's normal path | **Verified.** §4.2 has the explanation line, all 21 areas in real catalog order in a scroll region, a 48 px **[Untick all]**, the >3-area sentence with no "+N more", and **one** acknowledgement bound to the exact removed set: "I checked this canvas…" when every area is removed, "I understand — share without Today, Inbox +4 more" when some are. A third 360 frame is drawn. Staff: Phase 1 commits to complete business-profile tracking (§§4.2/9/12). Legacy or untracked chats get the fixed fallback plus "Start a new chat to make a canvas." New issue in how the per-row warnings behave after Untick all: required 3. |
| 2 | Compact-layout breakpoint | **Verified as a rule** (H3 and §3.1: pane <640 or viewport <600, plus 390 × 844 and 800 × 360 fixtures in H5). Applying the rule exposes two new gaps: required 1 and required 2. |
| 3 | Real chrome numbers | **Verified.** 72 + 64 = 136 chrome, plus 8 padding, ≤348 total, ≥452 stage, 32 px tolerance. The note "Do not shrink the existing Operator header" is present. H5 fixture rows match. |
| 4 | Floor 360 frame | **Verified.** 48/20/56 rows, floating 2D/3D and Fit/100%, no −/+ row, the hint plus **Open floor plan ↗** in ⋯, and the ≥420 rule stated for floor plans (§7.1, §6.5). |
| 5 | Self-contradicting copy | **Verified.** **About this page** appears in the menu and the fuller disclosure. **Show code** is used in the menu, the timeout row and the complexity row. **[the width's exit]** for unavailable. The Words table distinguishes the toggle from the menu action. |
| 6 | Team page area names | **Verified.** The plan has no stray "Money" label. Checklist, chips, sentences and the 1280/360 frames use catalog labels in catalog order. The list is derived from `PERMISSIONS`, and a catalog revision invalidates preflight. |
| 7 | Files row at 360 | **Verified in substance** (chips move into the meta line below 640, the name keeps its width, "Bidding +1 more"). One mismatch with the real row is under Optional. |
| 8 | Delete states | **Verified.** Fenced failure reads "Deleting didn't finish. The canvas stays hidden until it does. [Try again]", with a title-free card and a chat equivalent. The recovery gate has exact copy and blocks **all Ask threads**. The floor refusal has an own-live branch with the title and [Open canvas], and a generic branch that covers 30-day retained refs. The floor delete confirm adds "The floor plan stays on the Floor tab." |

The plan contains no stale round-3 copy: I searched both files for `Money`, `[Code]`, `112`, `+18`, `Couldn't delete`, `Delete that canvas` and `Hide canvas`. Optional items from round 3 that were adopted: `aria-disabled` on the Showing button, "Tick the line above to save.", a **Filename** label at 360, and the Close Operator rename noted with a fixture.

## What's strong

- **The Save dialog now reads well on the path Joe will actually take.**
  - He opens Save and reads "Claude may have used anything in this chat, so every area is ticked."
  - He taps **Untick all**, ticks one line, and reads "Staff who can open Larson bath files can read this copy."
  - That is one honest sentence, one button and one tick in place of 21. The server still binds the exact removed set, so it is still safe.
- **Staff can make canvases.** Complete tracking is a Phase 1 commitment, not a hope. Only genuinely untracked chats get a refusal, and that refusal tells staff what to do: start a new chat.
- **The compact rule is a single testable sentence**, and the shared fixture checks the actual chrome arithmetic. Nobody will shrink the Operator header to hit a fictional number.
- **Labels match the Team page everywhere.** A 🔒 chip on a Files row names a box Joe can actually find on Team.
- **Delete copy never lies about state.** Pre-fence failures are handled separately from fenced ones, nothing leaks another person's title, and Joe's own floor-plan refusal lets him jump straight to the canvas.

## Required to reach 10

1. **§3.1, §3.2, §6.5, §7.1 + H3/H5: compact layout on a desktop gets phone-only behaviour.** The rule is "pane <640", so the compact layout now covers desktop panes. The most common one is Joe's default popout.
   - `PanelHost.tsx:123` opens the popout at 1100 px. H1's 42% split gives roughly 1084 content → 455 Chat + 12 + **~617 pane**, which is **compact**.
   - A 1024–1100 laptop with the dock expanded (1024 − 420 − 12 = 592) is compact too.
   - In those panes:
     - A mouse user gets only **Fit / 100%**. Compact layout has "no −/+ row", and pinch and double-tap are touch-only. Nothing specifies wheel zoom or drag-to-pan, so Joe cannot zoom a dense permit diagram past 100% on his desktop.
     - The floor ⋯ shows **"Edit on a tablet or computer"** to someone who is on a computer, with no **Edit floor plan**.
   - Change: split the compact rule into *layout* and *device*. The layout stays as written. Then add to §3.2 and §6.5/§7.1:
     - "On a fine pointer (`(pointer: fine)`), the compact floats are **[−] [Fit] [100%] [+]**; Ctrl/⌘ + wheel zooms and drag pans the stage."
     - "The floor hint **Edit on a tablet or computer** shows only when the viewport is narrower than 640 px. Otherwise the floor ⋯ row is **Edit floor plan ↗** (same `/floor/<id>` check)."
   - Add an H5 fixture row: **1100 popout, pane ~617 → compact; fine pointer shows −/+; floor ⋯ shows Edit floor plan ↗, no hint.** Also say in §3.1 that the 1280 popout frame applies only once the popout is wider than about 1150 px, and that the default 1100 popout is compact.

2. **§3.1 + H3: draw the 800 × 360 landscape frame.** Landscape is exactly how someone looks at a wide flowchart on an iPhone.
   - H3 and §3.1 say to put the Operator header, selector and action bar "beside the stage as needed". Without moving them, 360 − 72 − 64 − 48 − 20 = 156 px of stage, under the 200 px floor. So this is not optional reflow: it rebuilds the shared Operator sheet chrome, which Browser also uses.
   - Nothing says which side, whether the selector goes vertical, or where the sheet × and grabber go, so a builder has to invent it.
   - Add a drawn frame and one sentence, e.g.:

   ```text
   800 × 360 (phone landscape, compact)
   ┌──────┬────────────────────────────────────────────┬────────────┐
   │  ×   │ ‹ Chat · Permit steps ▾ · ⋯                │ [‹]        │
   │Queue │ Diagram · Version 2 of 2                   │ [Versions] │
   │Chat  │                                            │ [›]        │
   │Canvas•│        diagram stage ≥200 px tall          │ [Ask for   │
   │Browser│                          [Fit] [100%]     │  a change] │
   └──────┴────────────────────────────────────────────┴────────────┘
   ```

   **"In phone landscape the grabber is hidden. Close Operator (×) and the one selector stack in a left strip of 64 px or wider, with 48 px rows. The 56 px action bar becomes a right column. Title and meta keep their 48/20 rows."** Add a Browser-plan note that the left strip is shared host chrome (H3), so Browser draws its own right column, not a second strip.

3. **§4.2: Untick all leaves 21 warnings and 21 Keep buttons.** §4.2 and the third frame say "After Untick all, checklist warnings remain under each removed row." On Joe's everyday path, the scroll region then holds 21 copies of "Staff without … access will be able to read this. [Keep … ticked]", which is about 42 extra 48 px blocks on a phone. They bury which boxes are which, and they duplicate the one acknowledgement directly below. The checkbox itself is already the way to keep an area. Change:
   - "Per-row **Staff without {area} access will be able to read this. [Keep {area} ticked]** lines show only while **three or fewer** areas are unticked. With more than three unticked, rows show just their checkbox, and the single acknowledgement row is the warning."
   - Update the third 360 frame's footnote to match: after Untick all, plain ☐ rows, then the one ☐ "I checked this canvas…" row.

## Optional

- **§8.4 Files row vs real source.** The real meta line is `truncate` (one line), so "existing meta line, which can wrap" means changing it to `flex-wrap` on Canvas rows. Say so. Size is a `flex-none` sibling of the name column, so the 360 frame's third line "HTML · size" is a move to state explicitly: below 640, size moves out of the name row into a second meta line. Also say what "HTML" is, since the current row has no file-type label; or drop it.
- **§4.2 Untick all after use.** When nothing is ticked, relabel it **Tick all again** (restores the server baseline). That way a mis-tap doesn't cost 21 re-ticks or a Cancel.
- **§7.1 fuller floor frame.** It shows `[−] [Fit] [+]` without **100%**, while the diagram fuller frame has all four. Match them, or say the floor plan uses the Designer's existing zoom set. It also offers both an **[Edit floor plan]** button and a ⋯ **Open floor plan** row going to the same `/floor/<id>`. Keep ⋯ Open floor plan only for someone who can view but not edit.
- **§8.5 pre-fence failure copy.** "Deletion has not started. [Try again]" reads oddly right after Joe pressed Delete. Use **"Couldn't delete this canvas. Nothing changed. [Try again]"**. It stays distinct from the fenced "Deleting didn't finish…" copy.
- **§8.4 two lock glyphs** (🔒 audience chip and the internal lock in the Eye slot) still mean different things. A non-interactive `EyeOff` with the same title reads as "not on the client dashboard".
- **Thread rail:** a small canvas icon on threads that hold canvases. Still cheap, still unaddressed.
