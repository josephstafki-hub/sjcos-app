SCORES: design=8 completeness=8

# Round 2 — Design & UX judge — Ask-panel Canvas plan

Judged `docs/plans/ask-canvas-plan.md` and the shared `docs/plans/_ask-pane-host.md` at
`7405f261` (commits `dc36db88`, `7405f261` since round 1), against Joe's decisions 1–9
(`_context-agent-browser-canvas.md`), my round-1 review, and the real UI:
`components/panel/PanelHost.tsx` (sheet header: grabber, **Operator**, 44 px chevron and ×; Escape
closes the whole sheet; `PanelDock width={400}`), `PanelDock.tsx` (narrow `Segmented` at `h-12`,
buttons `h-11`; two columns ≥560, threads rail ≥880), `components/ui/Segmented.tsx` (`role=group`,
`aria-pressed` buttons, no arrow keys today), `components/projects/ProjectFiles.tsx` (each row has
an Eye button **"Publish to dashboard"** whose title says it emails the client),
`components/floor/DesignsStrip.tsx` (`v{n}` chips), `components/floor/TopBar.tsx` (`readOnly` →
"Read only" pill), `app/globals.css` (heading 17 / subheading 14 / body 13 / label 12), and
`memory/joes-words-not-invented-terms.md`.

## Round-1 items: verified / not fixed

| # | Item | Status |
|---|---|---|
| 1 | One shared pane contract | **Verified.** H1: `AskContentPane.tsx`, split ≥840 content px, Chat 340 / pane 480 / gutter 12, ‹ Chat. Browser plan §6.2 now adopts it by reference. |
| 2 | Docked desktop expands over the app | **Verified.** H1 "Explicit dock open", H2 arrival = dot + card only, fourth wireframe added (§3.1). |
| 3 | Real panel chrome, one segmented control | **Verified.** Operator header, Claude ▾ / History / New, one `Queue · Chat · Canvas · Browser` control, dot with `aria-label="Canvas, new version"`. |
| 4 | More than one canvas in a chat | **Verified.** §4.1 **Canvases in this chat** picker, 56 px rows, last-viewed-else-newest. |
| 5 | Ask for a change, live updating | **Verified.** 48 px footer, "About: Permit steps · Version 2" hint, **Claude is updating this canvas…**, follow-latest default stated. |
| 6 | Phone back / Escape / focus trap | **Verified.** H3: one history entry, popstate/edge swipe, innermost-first Escape, iframe + sentinels in the trap. |
| 7 | Joe's words, no developer terms | **Verified.** Preview · Code, Copy code, Picture (PNG) / Drawing (SVG) / Page (HTML), fix prefill without UUIDs, `Permit steps (v2).html`, repair notice log-only. |
| 8 | Joe vs Claude rows; give-up line | **Verified.** §4 audience column; durable `rejected` event with **too big / not supported / not allowed** (§5.4 item 6). |
| 9 | change_note and version list | **Verified.** §5.1 `change_note`, §4.1 row format, bottom sheet, Previous/Next and disabled labels. |
| 10 | Dark mode, text alternative, zoom, type tokens | **Verified.** §3.2. |
| 11 | Save dialog per audience | **Verified in substance**, with new gaps from decision 9 (checklist never drawn, empty-areas default, radio order). See required 2–3. |
| 12 | Saved canvas in Project › Files | **Mostly verified.** Chips and viewer caption are there. The row's existing **Publish to dashboard** eye button is not addressed. See required 6. |
| 13 | Copy link | **Verified.** No Copy link for diagrams and pages; the floor plan keeps `/floor/<id>`. |
| 14 | Floor: one number, hidden edit chrome, wireframes | **Verified.** `embeddedPreview` hides tools, design `v5` only, 360/1280 wireframes. |
| 15 | iPhone app before native cards | **Verified.** Plain fallback line in the mobile adapter, **Open in Safari** with no token. |
| 16 | Card anatomy and states | **Verified.** Older-version and redacted card copy is still missing. See required 7. |
| 17 | One way out per width | **Verified** (‹ Chat / × Close canvas / Back to app; Hide canvas removed). The revision adds disabled sheet controls. See required 4. |

All 17 are addressed in the text and none is only mentioned. The remaining work is new or second-order.

## What's strong

- The shared host file is the right move. Both plans now use one width rule, one exit per width
  and one attention order (human choice > Browser takeover > active pane > arrival). The browser
  plan already points at it, and there's one fixture for both test files.
- It feels like the Claude/ChatGPT canvas: a card in the chat and the pane beside it, then
  **Version 3 is ready [Latest]** instead of yanking the view. **Use this version** appends a
  version and never rewrites history. On a phone, **Ask for a change** returns to a focused
  composer that already says what it's about.
- Durable cards (stable group IDs, reply → card → RunReview, a standalone card for a crashed run,
  generic deleted/unavailable cards) mean reload and the iPhone app can't lose a canvas.
- The floor plan is reused rather than reinvented: one design number (`v5`, the same as
  DesignsStrip), edit chrome hidden rather than greyed out, and **Edit on a tablet or computer**
  on phones.
- The copy is short and plain throughout, with no "artifact", L1/L2/L3 or UUID on screen.

## Required to reach 10

1. **§3.1 360 wireframe + §3.2: give the diagram room on a phone.** At 360 × 800 the stacked
   chrome is the grabber/header, segmented control, ‹ Chat, title, meta, Preview · Code, About,
   the version row, the zoom row, Save and Ask for a change. That's about 11 rows (~520 px with
   the safe areas), which leaves the diagram roughly 220 px tall. Claude's and ChatGPT's phone
   canvases are mostly canvas. Specify this phone layout and a budget:
   - Row 1, 48 px: `‹ Chat` · **Permit steps ▾** (title picker) · `⋯`.
   - Row 2, 20 px meta: **Diagram · Version 2 of 3**. When a newer version exists, the same row
     reads **Version 3 is ready [Latest]**.
   - The stage, with **Fit** and **100%** as 48 px buttons floating in its bottom-right corner.
     Pinch and double-tap as §3.2. Drop the separate `[−] [+]` row on phones, where the keys
     and buttons stay for desktop and iPad.
   - Bottom bar, 56 px: `[‹]` `[Versions]` `[›]` · **[Ask for a change]** (primary).
   - **Preview · Code**, **About this diagram**, **Save to project files**, Download, Print and
     Delete move into `⋯` (see item 5).
   - State the rule: **at 360 × 800 the diagram stage is at least 420 px tall.** Redraw the 360
     wireframe to match. The 820 and 1280 layouts may keep the fuller header.

2. **§4.2 + §8.4: Save dialog under decision 9. Draw the checklist and fix the empty-areas
   default.**
   - Draw the area checklist in both wireframes. It's the thing decision 9 is about. Under the
     Share radio, list the catalog areas as 48 px checkbox rows with the derived ones ticked,
     e.g. `☑ Money  ☑ Bidding  ☐ Invoices …`.
   - Today an empty checklist "requires explicit 'Share with all staff…' confirmation". With
     Share pre-selected, every non-sensitive canvas (the permit-steps example) would hit an extra
     confirmation on the default path. Change it: when nothing is ticked, nothing extra is asked
     and the sentence reads **"Staff who can open Larson bath files can read this copy."** (this
     is decision 8's own rule). Keep a confirmation only when Joe **unticks an area that was
     pre-ticked**. Show it inline under that row: **"Staff without Money access will be able to
     read this. [Keep Money ticked]"**. That inline line is the audited weaker-audience choice
     in §8.4. No second dialog.
   - With areas ticked, replace the vague **"Staff with these areas can read this copy."** with
     the same shape as the staff variant: **"Joe and staff with Money and Bidding access can read
     this copy."**
   - Copy cleanup in §4.2: the radio order must be the same everywhere (Share with staff first,
     then Only Joe; the 360 wireframe has it reversed). "(default, Joe decision 9)" must not
     appear in the radio label. Delete the duplicated "Copy **Staff with these areas…**"
     sentence. Fix the broken right border in the 1280 box.

3. **§4.2 / §9 "monotonic policy": say what staff actually see when they save, and check it
   against decision 8.** A staff save unions the saver's **current full area set** (including
   `ai`). Say Abigail holds ai, projects, money, bidding, leads and schedule. Her permit diagram
   then becomes readable only by staff who hold all six. The dialog would read "Joe and staff
   with AI, Projects, Money, Bidding, Leads, Schedule can read this copy", and the Files chip
   would be equally long. The wireframe's "Money, Bidding" understates this. Decision 8 says
   "anyone with access to that job's files sees it." Do two things:
   - (a) Drop the baseline areas the save already requires or that don't classify content (`ai`,
     `projects`) from the saved-copy union and from all copy, or record why not.
   - (b) If the full-area union stays, flag it to Joe in §12 as a decision-8 trade-off in one
     plain sentence. The staff wireframe must show a realistic list, with the sentence
     **"Joe and staff with Money, Bidding, Leads and Schedule access can read this copy. These
     match your own access."** Truncation rule for chips and sentences: show three areas, then
     **"+2 more"**, with the full list in the chip's `title` / accessible name.

4. **H1 "Sheet / phone" + H3 sheet chrome: don't show dead controls.** H3 disables the sheet
   chevron and × while Canvas is open, with an explanation on a disabled button. Disabled buttons
   aren't focusable, so VoiceOver users won't hear "Return to Chat to close Operator". The
   wireframes show `⌄(off) ×(off)`. H1 also says "Sheet × closes Operator", which contradicts
   H3. Pick one:
   - **Hide** the chevron while side content is open (the sheet is forced to 100dvh anyway).
   - **Keep × working.** It closes Operator, consumes the pane history entry, and remembers the
     selection so reopening Operator lands back on the canvas.

   Update H1, H3 and both wireframes so there is one rule.

5. **§3.1 / §6.5: define the `⋯` menu and the Delete entry point.** `⋯` appears in every
   wireframe, but its items are never listed. §8.5 has the delete confirmation copy, but nothing
   opens it. Specify per type, in order (phone and iPad: a bottom sheet of 56 px rows; desktop: a
   menu):
   - **Diagram:** Preview · Code (phone only) · About this diagram (phone only) · Save to project
     files (phone only) · **Download ▸** Picture (PNG) / Drawing (SVG) / Diagram code (.mmd) ·
     **Print / Save PDF** · **Open in new tab** · divider · **Delete canvas…**
   - **Page:** the same items, with Download = Page (HTML).
   - **Floor plan:** **Open floor plan** · **Copy link** · divider · **Delete canvas…**
   - Add **Open in new tab**, **Delete canvas**, **Close canvas** and **Versions** to the §1 Words
     table.

6. **§8.4 Project › Files row: handle the existing Publish button.** Every file row in
   `ProjectFiles.tsx` has an Eye button **"Publish to dashboard"** (title: "Publish to the client
   dashboard (emails the client)"). Canvas copies are internal-only (decision 8), and the server
   refuses that action. The row must therefore **not render** the button. In its place, show a
   lock icon with `aria-label` and title **"Canvas copies stay internal."** Clicking a refused
   button must never be the way Joe finds out. Also specify:
   - The audience chip for an empty-area staff copy: **🔒 Staff** (no colon).
   - Long chips truncate as in item 3.
   - The `Version 2` text uses the row's existing meta style (`font-mono text-[10px]` line), not
     a new right-hand column that pushes out the size and download controls at 360.

7. **§4.1 cards: the last missing card states.**
   - **Older-version card while a newer one exists:** meta **"Diagram · Version 2 · Newer
     version available"**, button **Open version 2** (opens that version; follow-latest off). The
     accessible name follows it.
   - **Redacted `unavailable` event** (master/staff off or revoked; §5.5): the card reads
     **"This canvas isn't available."** with no title and no button.
   - **Master off** (§4 "disabled"): the generic card reads **"Canvas is turned off."**
   - **Creating, before version 1 commits:** the card slot shows **"Claude is making a
     canvas…"** beside the run activity, then becomes the card.
   - **Empty state's example:** name its exact button text, e.g. **[Draw the steps for a
     permit]**, which fills the composer with **"Draw the permit steps for this job as a
     diagram."** and focuses it (no send).

8. **H3: Back on desktop when Canvas is expanded over the app.** "Desktop pane selection does not
   add a history entry", but Back to app "restores prior route/scroll". In the expanded dock the
   app view visibly changes, so Joe will press the browser's Back. Today that silently navigates
   the hidden app route while the canvas stays. Specify:
   - Explicit expansion pushes the same one `?canvas=<id>` entry as the sheet, so browser Back
     equals **Back to app**.
   - Split-in-popout selection still adds no entry.
   - Clicking any app navigation link (sidebar, tab bar, record link) while expanded first does
     **Back to app** (canvas closes, dot stays), then navigates.

   Add both cases to the shared fixture's expected results in H5.

9. **H3 / §3.2 focus on entry and announcements.**
   - On opening, focus goes to the pane title button (**Permit steps ▾**), never into the
     iframe. Arrival auto-select moves no focus (already stated).
   - The once-per-commit announcement depends on follow-latest. With follow on:
     **"Canvas updated: Permit steps, version 3"**. With follow off: **"Version 3 is ready."**
   - The **About: Permit steps · Version 2** composer hint has a 44 px × with
     `aria-label="Remove canvas from message"`.

10. **§3.1 wireframe copy consistency.** The 1280 popout and dock-expanded wireframes label the
    save button **Save**. Use **Save to project files** (or the `⋯` placement from item 5) on
    every width, matching the dialog title and the Words table. The dock-expanded wireframe
    shows **Canvas•** with a dot while that canvas is open and current. Per H2 the dot clears once
    viewed, so remove it there, or show the Version 3 banner that justifies it.

## Optional

- **H2:** "four equal segments" isn't what `Segmented` does today (it uses `shrink-0` with
  padding). Either say "the four labels fit at 360 without wrapping", which is true, or add
  `flex-1` to the narrow variant. For arrow keys, specify `role="radiogroup"`/`radio` or
  `tablist` semantics in place of today's `aria-pressed` buttons, so the arrow-key promise
  matches a real pattern.
- **§3.2:** "Touch controls ≥48 px" vs the existing 44 px segmented control and sheet buttons.
  State "≥44 px, 48 px for Canvas's own bars" so the requirement doesn't silently demand a
  re-skin of existing chrome.
- **§7.1:** on phones, render **Edit on a tablet or computer** as a hint line with a separate
  **Open floor plan ↗** link. That way the instruction and the action don't share one label.
- **Thread rail:** a small canvas icon on threads that have canvases (round-1 optional, still a
  cheap win).
