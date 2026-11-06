SCORES: design=8 completeness=7

# Canvas Phase 1 build, round 2: design & UX judge

Reviewed HEAD `a0c436ff` (UI fixes `ddbabe0a`, server fixes `6ea30751`, real Mermaid 12.3.0 fixtures
`a0c436ff`) on branch `t3/in-app-browser-agent-tools`. I read every PNG in
`/home/joe/qa-sjcos/abc/shots/c1-r2/`, plus `c2-log.json`, `c2b-log.json`, `c2c-log.json`, the capture
script `shoot-c2c.mjs`, and the source: `components/panel/CanvasPane.tsx`, `CanvasSaveDialog.tsx`,
`JobPicker.tsx`, `CanvasVersions.tsx`, `app/panel/canvas/[id]/not-found.tsx`,
`lib/canvas-save-policy.mjs`, `lib/actions/ai-chat.ts` and `tests/canvas-save-dialog.test.mjs`.
I checked them against `ask-canvas-plan.md` §3.1, §3.2, §4, §4.1 and §4.2.

## Round-1 items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Labels centered, no outline | **Fixed** | Handover is centered in its box at 1280, 856, 820 sheet and 360 sheet. |
| 2 | Arrowheads, sequence lines | **Fixed** | Flowchart shows 3 arrowheads. The sequence diagram shows a solid "Approve plan" arrow and a dashed "Work complete" arrow, each with its label above. |
| 3 | App palette | **Fixed** | Card paper stage, ink-3 node strokes, ink text, ai-green edges, paper float box. |
| 4 | 100-node diagram | **Fixed (copy)** | The real 20166 px fixture shows **This diagram is too complex to show here.** with Show code and Ask Claude to simplify it. The buttons have no visible affordance (R2-5). |
| 5 | Syntax-error controls | **Fixed (copy)** | Shows exactly **Copy code** and **Ask Claude to fix it**, plus the diagnostic line "Mermaid could not parse the diagram. Check its syntax." Ask Claude to fix it is bare text (R2-5). |
| 6 | Ligatures | **Fixed** | `-->` shows its real characters in the error code block. |
| 7 | Save dialog project pick | **Partly fixed** | Bordered 48 px **Project [Pick a project ▾]** control, inline picker in flow, 16 px search, **Choose a project.**, visible disabled Save. Staff cannot search at all, the toggle is a trap, and the audience section was never captured (R2-1, R2-2, R2-3). |
| 8 | Staff chips | **Fixed in code, not captured** | `CanvasAudienceChips`: at most 3, then **+N more**, full list in `title`/`aria-label`, touch-expandable, empty → **🔒 Staff**. Staff can't reach it until R2-1 is fixed. |
| 9 | Preview/Code selected state | **Fixed** | Preview has the card background; Code is muted ink-3. |
| 10 | Meta row on older version | **Fixed** | **Diagram · Version 1 of 3 · Version 3 is ready Latest** (wrapper-flow_v1). |
| 11 | Versions sheet | **Fixed** | "Added handover · Joe Stafki · 9:59 PM"; Version 1 reads "Joe Stafki · 9:59 PM" with no leading dot. |
| 12 | Unavailable page | **Fixed** | Paper theme, **This canvas isn't available to this account.**, bordered 44 px **‹ Chat**. Status stays 404 and no title or owner is shown. |
| 13 | Landscape 800×360 | **Fixed** | Popout: left strip (Dock back plus vertical Queue/Chat/Canvas•) and a 128 px right column (‹ / Versions / › / Ask for a change). Sheet: the strip holds × first. The stage is about 280 px tall in both; the 125×260 frame is the tall diagram's aspect, not the stage. |
| 14 | Card and Save affordance | **Fixed** | **Open canvas** / **Showing** and **Save to project files** are bordered card buttons. |

Round-1 captures:
- **Phone sheet from /today at 360, 390, 820 and 800×360:** done. Chevron hidden, **×** Close Operator, **‹ Chat** as the only exit. The 360 stage is about 530 px, over the 420 gate.
- **855/856 boundary:** done. 856 is a 480 px compact pane with the four fine-pointer floats.
- **Dock expanded, browser Back, app-nav:** done. Back to app returns to /today with Chat selected and the Canvas• dot, and the dock width is unchanged.
- **Phone ⋯ menu:** done in the popout (Show code, About this diagram, Save to project files, Download, Open in new tab, Delete canvas…). `phone360-sheet-menu` shows the sheet with the menu closed.

Isolation and logs: zero cross-person leaks, zero overflow, and no console errors except the expected 404.

## Coordinator note: is project selection broken?

**Owner: no, the capture script caused it.** With no project, the dialog opens with the picker already
open (`useState(!project)`, `CanvasSaveDialog.tsx:19`). `shoot-c2c.mjs:36` then clicks the
**Pick a project ▾** button, which toggles `pick` to false and closes the picker
(`CanvasSaveDialog.tsx:39`). The script's next lookup of **QA Canvas empty project** finds nothing
visible, so it never clicks a row. `onPick` (`:40`) does call `setProject(j.slug)` and fetch
save-policy, and `tests/canvas-save-dialog.test.mjs` exercises that path. The audience section is
correctly hidden until a project's policy loads (`p?.owner&&…`, `:42`).

That accident still exposes a real trap: the closed and open states look the same (R2-3).

**Staff: yes, it is broken.** See R2-1.

## REQUIRED fixes

**R2-1. Staff cannot pick a project, so staff can never save.**
- What happens: `searchJobsActionImpl` (`lib/actions/ai-chat.ts:377`) throws `ASK_ACCESS_DENIED` for
  any non-owner. The staff picker therefore shows **Chat isn't turned on for this account.**, which is
  wrong copy for a person who is chatting, and **No jobs match “”.** (staff-desk1280-save-dialog).
- Why it's required: §4.2 says Project uses "JobPicker filtered to accessible projects", and Phase 1
  says staff "can create and save canvases". The test mocks `searchJobsAction`, so the gate is never
  exercised.
- Fix:
  - Give the Save dialog its own project search, e.g. `searchCanvasProjectsAction(q)`, that allows
    owner and staff.
  - Return only `kind='project'` rows whose files the principal can open, using the same check as
    the save-policy route.
  - Pass it to `JobPicker` through a `search` prop, so the rail keeps its owner-only folder search.
  - On failure, show **Couldn't load projects. [Try again]** below the search row (in inline mode).
    Today the error `<p>` sits inside the search row at `JobPicker.tsx:159` and squeezes the input.
- Test: a staff principal, with the real action not mocked, gets projects back; a project without
  file access is not returned.

**R2-2. The inline picker shows rail-only folder state.**
- What happens: the Save picker shows **FILED** badges and "Already has a folder…" titles
  (`JobPicker.tsx:216, 228, 237–238`). In the Save dialog that reads as "this canvas is already
  saved there".
- Fix:
  - When `projectOnly`, set `taken=false` and use `title={j.name}`.
  - In inline mode, also use readable sizes: name `text-[12px]` → `text-body`; sub `text-[10.5px]`
    → `text-meta`; the kind header and the "Loading jobs…" / "No jobs match" lines → `text-meta`.

**R2-3. The project toggle doesn't show that the list is open.**
- What happens: `CanvasSaveDialog.tsx:39` always renders `▾`. The picker is already open on arrival,
  so the obvious click on **Pick a project ▾** closes it.
- Fix:
  - Render `{label} {pick?'▴':'▾'}`.
  - Update the test's `find(tree,'Pick a project ▾')` to the open-state label
    **Pick a project ▴**.

**R2-4. Unrenderable versions show a disabled Save with no reason.**
- What happens: render_error and the too-complex 100-node wrapper show a greyed **Save to project
  files** with nothing beside it. §4 says a disabled Save is explained beside it.
- Why hide it: there is no drawing to export.
- Fix:
  - Hide Save when `view.renderError` is `RENDER_FAILED` or `RENDER_TIMEOUT`, at
    `CanvasPane.tsx:67` (fuller layout) and `:90` (⋯ menu):
    `data?.capabilities.save&&!['RENDER_FAILED','RENDER_TIMEOUT'].includes(view.renderError??'')`.
  - Keep the disabled state only while it is still loading or `LOAD_TIMEOUT`.

**R2-5. State-action buttons still render as bare text.** Round-1 #14 fixed the card and Save but not
these. Give each one `rounded-md border border-rule bg-card px-3`, keeping its current
`min-h-11`/`min-h-12`:
- `CanvasPane.tsx:75`: **Ask Claude to fix it** (keep `text-ai-2`). It sits beside the bordered
  Copy code and reads as a label.
- `CanvasPane.tsx:77`: **Show code**, **Try again**, **Ask Claude to simplify it**.
- `CanvasPane.tsx:61`: **Draw the steps for a permit**.
- `CanvasPane.tsx:62–63`: **Try again** and **Sign in**.
- `CanvasPane.tsx:97–98`: **Use this version** and **Delete canvas** (Delete keeps `text-flag`).
  Cancel stays plain.
- `CanvasSaveDialog.tsx:43`: **Untick all**. §4.2 draws it as a 48 px `[Untick all]` button.

## REQUIRED captures (after R2-1 through R2-3)

In the script, **do not click "Pick a project"** when the picker is already open. Click the
**QA Canvas empty project** row directly, then wait for the save-policy fetch.

1. **Owner, UNKNOWN operator canvas, at 1280 and 360.** Capture:
   - (a) the picker open, with no FILED badges;
   - (b) after the pick: **Project [QA Canvas empty project ▾]**, then **◉ Share with staff**
     pre-selected, directly under it **Claude may have used anything in this chat, so every area is
     ticked.**, then the bordered 48 px **[Untick all]**, then the scroll region with 21 ticked rows
     in catalog order (Today … Bidding, All other financials), then **○ Only Joe**, then **Only Joe
     and staff with every ticked area can read this copy.** and **It won't appear on the client
     portal.**;
   - (c) the list scrolled to the end;
   - (d) untick Today and Inbox: two **Staff without … access will be able to read this. [Keep …
     ticked]** lines, the acknowledgement **I understand — share without Today, Inbox**, **Tick the
     line above to save.**, and Save disabled;
   - (e) **Untick all**: no per-row lines, a single row **I checked this canvas. Share it with
     everyone who can open QA Canvas empty project files.**, the sentence **Staff who can open QA
     Canvas empty project files can read this copy.**, and Save disabled;
   - (f) the acknowledgement ticked: Save enabled;
   - (g) **Only Joe** selected: **Only Joe can read this copy.** and no checklist.
2. **Staff, COMPLETE-narrow canvas, at 1280 and 360.** Capture:
   - the project search returning rows;
   - after the pick: no radios and no checkboxes;
   - read-only chips (≤3, then **+N more**), or **🔒 Staff** if the baseline is empty;
   - the matching audience sentence and the portal line;
   - if **+N more** is shown, a second shot with it expanded.
3. **Phone 360 sheet ⋯ menu** from /today, with the menu open. The current `sheet-menu` shot has it
   closed.
4. **The render_error and too-complex wrappers at 1280 and 360** after R2-4/R2-5: bordered action
   buttons, and no disabled Save.

## Non-blocking notes

- The fuller layout spends about 140 px on Preview·Code, Save and About before the stage. Putting
  **Save to project files** on the Preview·Code row, right-aligned, would get back 48 px; §3.1
  draws it under the stage.
- The title button's focus ring on open is the browser's black outline. `focus-visible:outline-focus`
  would match the app.
- The landscape right column stretches **Ask for a change** to about 200 px tall. That is acceptable,
  but `flex-none min-h-12` with the bar centered would read better.
