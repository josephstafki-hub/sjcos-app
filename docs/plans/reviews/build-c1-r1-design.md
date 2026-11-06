SCORES: design=5 completeness=5

# Canvas Phase 1 build, round 1: design & UX judge

Reviewed HEAD `b98a8aa7` (branch `t3/in-app-browser-agent-tools`). I read the screenshots in
`/home/joe/qa-sjcos/abc/shots/c1-r1c/` and `c1-log.json`. I checked them against
`_context-agent-browser-canvas.md` (decisions 1–11 and the Canvas Phase 1 build decisions),
`_ask-pane-host.md` H1–H5, and `ask-canvas-plan.md` §1 Words used, §3.1/3.2, §4, §4.1, §4.2 and §6.5.
I also read the UI source: `components/panel/Canvas*.tsx`, `components/panel/canvas/**` and
`lib/canvas-renderer.mjs`.

## What passes

- **Split arithmetic is correct where it was captured.** The popout measures the content box after `p-2`:
  - 1000 viewport → 984 content → **413 / 12 / 559**, compact, × exit.
  - 1100 popout → 1084 → **455 / 12 / 617**, compact, × exit, all four zoom floats.
  - 1280 popout → 1264 → **531 / 12 / 721**, fuller.
- **1280 dock expansion matches H1/H3.** Chat stays at the 420 dock width and the pane fills the
  app area. The title row is **Back to app · title ▾ · ⋯**. Back to app restores /today, and the
  dock width does not change.
- **Phone 360 (popout).** One row **‹ Chat · title ▾ · ⋯**, a 20 px meta row and a 56 px bar.
  The stage is about **568 px**, well over the 420 gate. Floats are touch-only Fit/100%.
- **Copy matches the plan:** Showing (`aria-disabled`), Open canvas, Open version n,
  Ask for a change, Versions, Previous/Next version labels, the Delete canvas confirm, and the
  Use this version confirm. Save dialog sentences come from `lib/canvas-save-policy.mjs` and match
  §4.2 word for word.
- **Isolation.** There are zero cross-person leaks and zero console errors (only the expected 404),
  no page overflows at any width, and the iframe is present at every width.

## REQUIRED fixes

1. **Diagram labels are off-center, and their text is outlined.** Visible in owner-desk1280-canvas-open,
   ipad820 and wrapper-flow_v1. In `lib/canvas-renderer.mjs:86–95` the `style` attribute is dropped,
   and with it Mermaid's `text-anchor:middle` and `dominant-baseline`. Text then starts at the node
   center and runs right, so **Handover** overflows its box. Separately, the palette sets
   `stroke:#64748b` on `g.node` (`:74`), and labels inherit it, which gives them the outlined
   "double" look.
   - Fix: before removing `style`, copy only `text-anchor`, `dominant-baseline` and
     `alignment-baseline` from it into attributes, checked against the existing enums.
   - In the text/tspan block (`:119–131`), set `stroke="none"`.
   - Acceptance: each label's center is within 2 px of its box center, and Handover sits inside its
     box at 1280, 820 and 360.
2. **Arrowheads and sequence message lines are missing.** The flowchart edges have no arrowheads,
   so direction is lost. The sequence diagram shows "Approve plan" and "Work complete" with no
   message lines or arrows (owner-desk1280-wrapper-sequence). The cause: the class-based CSS that
   drew them went with `<style>`.
   - Fix: add palette entries in `lib/canvas-renderer.mjs:74`:
     - `arrowheadPath` / `arrowMarkerPath` / `marker path`: fill and stroke in the edge color.
     - `messageLine0`: solid stroke. `messageLine1`: stroke plus `stroke-dasharray:3 3`.
     - `messageText`: text color.
   - Acceptance: the v3 flowchart shows 3 arrowheads, and the sequence diagram shows 2 arrows with
     labels above them.
3. **The diagram colors are not the app's colors (§3.2).** The stage and document are white, nodes
   are `#eef2ff` and borders slate, which looks like stock Mermaid, not SJC OS paper. Use the
   resolved tokens:
   - Background and node fill: `--card` `#fbfaf4`.
   - Node stroke: `--ink-3` `#5f6454`.
   - Text: `--ink` `#2c3326`.
   - Edges and lines: `--ai` `#5b7e72`.

   Where to change it: `lib/canvas-renderer.mjs:11` (CANVAS_STYLE `color` and `background`), `:74`,
   `:122` and the `:232` themeVariables. Also `DiagramStage.tsx:50` `bg-white text-slate-900` →
   `bg-card text-ink`, and the float box `:56` `border-slate-300 bg-white/95` →
   `border-rule bg-card/95`.
4. **A valid 100-node diagram says its code is broken.** "100 nodes at complexity limit" is valid
   syntax: 99 edges, under `maxEdges:200`. It shows **Couldn't draw this diagram. Its code is
   below.** at both widths, with no frame. Find out which gate rejects it (element cap, size, or
   measure).
   - It must draw.
   - If it really exceeds a render budget, it must show the §4 complexity state instead:
     **This diagram is too complex to show here. [Show code] [Ask Claude to simplify it]**.
     Never the syntax-error copy for valid code.
5. **The syntax-error state does not match §4.** `CanvasPane.tsx:67` adds a **Show code** button
   even though the code is already shown below it.
   - For `RENDER_FAILED`, the controls must be exactly **[Copy code] [Ask Claude to fix it]**, with
     no Show code.
   - Add the bounded plain diagnostic line that §4 requires, both under the message and in
     `fixCanvasPrompt` (`state.ts:15`). Today it is always "The diagram could not be drawn.".
6. **Code text shows font ligatures.** `-->` displays as **⟶** in Code view and in the error code
   block (owner-desk1280-code, wrapper-large, wrapper-render_error). This is untrusted text and must
   show its real characters.
   - Fix: on the `<pre>` at `CanvasPane.tsx:45`, add `[font-variant-ligatures:none]
     [font-feature-settings:'liga'_0,'calt'_0]`.
7. **The Save dialog cannot pick a project**, so none of §4.2 ever appears (owner and staff
   desk1280-save-dialog). The screen shows only "Project ·", Filename, the portal line and a Save
   button that looks enabled.
   - `CanvasSaveDialog.tsx:30`: the `??` chain shows `''`. Use
     `p?.project.name || project || 'Pick a project'` and render it as a bordered 48 px control
     **Project [Pick a project ▾]**.
   - `:31`: `JobPicker` is `absolute top-full` (`JobPicker.tsx` root) with no positioned ancestor,
     so it opens off-screen. Wrap it in a `relative` block, or add an inline/static mode.
   - The picker search input is `text-[12px]`. §3.2 needs **16 px** so iOS doesn't zoom.
   - While no project is chosen, show **Choose a project.** beside Save.
   - Give the disabled Save a visible state (`disabled:opacity-50`).
   - After the fix, recapture owner unknown-provenance at 1280 and 360. Expect:
     - **Share with staff** pre-selected (decision 9).
     - **Claude may have used anything in this chat, so every area is ticked.**
     - 48 px **[Untick all]**, then 21 rows in catalog order.
     - After Untick all: no per-row lines, the single acknowledgement, and **Tick the line above to
       save.**
   - Also recapture the staff COMPLETE-narrow dialog.
8. **The staff audience is a comma string, not chips.** At `CanvasSaveDialog.tsx:37`, §4.2 requires
   read-only chips:
   - At most three names, then **+N more**, with the full list in `title` and the accessible name,
     and expandable on touch.
   - Empty → **🔒 Staff**.
9. **Preview / Code has no visible selected state.** In the fuller layout (`CanvasPane.tsx:61`) both
   look identical. Only `aria-pressed` changes. Style the pressed state the way the Operator
   Segmented does (card background, ink text, shadow), or reuse that control.
10. **On an older version, the meta row hides which version is shown.** wrapper-flow_v1 shows only
    "Version 3 is ready Latest". At `CanvasPane.tsx:47`, keep the version and append the newer
    notice: **Diagram · Version 1 of 3 · Version 3 is ready [Latest]**, truncating from the left
    part first. Same at every width.
11. **Versions sheet formatting.**
    - `CanvasVersions.tsx:12` renders "· Joe Stafki · …" when `change_note` is empty. Join only the
      non-empty parts.
    - Show time the way §4.1 does (**2:14 PM**; prefix **Nov 5,** when not today). No seconds, no
      `11/5/2026`.
12. **The other-person / missing canvas page is a bare 404.** It shows Next's "404 This page could
    not be found." on white (owner-desk1280-wrapper-OTHER). Add `app/panel/canvas/[id]/not-found.tsx`
    with the §4 unavailable state on the paper theme:
    **This canvas isn't available to this account.** plus a 44 px **‹ Chat** link to `/panel`.
    Keep the 404 status and show no title or owner.
13. **Landscape 800 × 360 is unreadable.** In the popout, the stage is about **128 px** (360 − 36 header − 64
    selector − 48 − 20 − 56 − 8) and the diagram renders at about 20% scale (iframe 49×103). The
    ≥200 gate fails. `askPaneLayout.ts:16` applies the H3 strip only when `mode==='sheet'`.
    - Apply the same left strip and 128 px right action column when the popout is landscape with
      height <600. The strip holds only the vertical selector, since a popout has no Operator ×.
    - Compact the popout "Operator · Window" bar into that strip.
    - Acceptance: stage ≥200 px at 800×360 in both popout and sheet.
14. **Give buttons a visible affordance.** Card **Open canvas** (`CanvasCard.tsx:21`) and fuller
    **Save to project files** (`CanvasPane.tsx:62`) render as bare text. Give them the bordered
    button style that Copy code already uses (`rounded-md border border-rule bg-card px-3`).
    §3.1 draws both as `[ ]` buttons.

## REQUIRED captures (completeness: the deferred pane-host evidence is still incomplete)

- **Phone sheet.** Every phone and tablet shot is the `/panel` popout ("Operator · Window /
  Dock back"), not the Operator **sheet** Joe uses on the iPhone. Capture the sheet from an app
  route such as /today with the Operator sheet open, at 360×800, 390×844, 820×1180 and 800×360.
  Show:
  - chevron hidden and **Close Operator** ×;
  - **‹ Chat** as the only pane exit;
  - the H3 landscape strip (× plus a vertical Queue/Chat/Canvas tablist) and the 128 px right
    column;
  - stage height measured.
- **839/840 boundary.** The 839 and 840 viewports give content widths of 823/824, so both shots are
  narrow and the boundary is never exercised. Capture at viewports whose content box is exactly 839
  and 840 (855/856 popout) and show 840 → **348 / 12 / 480**.
- **Phone ⋯ and Save.** The 360 "save-dialog" shots show no dialog, because Save lives in ⋯ in the
  compact layout. Capture the ⋯ menu (Show code, About this diagram, Save to project files,
  Download ▸, Open in new tab, Delete canvas…) and the Save dialog at 360 for owner and staff.
- **Dock-expanded history.** Capture browser Back from the expanded dock, and an app-nav click while
  expanded (exit once, then navigate once).

## Non-blocking notes

- The **Canvas•** dot stays on while the latest version is shown. That is fine if it means other
  canvases are unviewed. Confirm it clears once all revisions are viewed.
- **[Latest]** in the 20 px meta row is a small tap target; the ‹ › bar controls cover the same
  action.
