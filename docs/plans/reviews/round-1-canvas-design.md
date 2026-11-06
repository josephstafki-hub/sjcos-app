SCORES: design=7 completeness=7

# Round 1 — Design & UX judge — Ask-panel Canvas plan

Judged `docs/plans/ask-canvas-plan.md` at `a30a530b` against Joe's request and decisions
(`docs/plans/_context-agent-browser-canvas.md`), the companion browser plan §6.2–6.3, and the
real UI: `components/panel/PanelHost.tsx` (desktop dock = `aside` with the label **Operator**,
default width from `layout.width`; below 1024 px a modal sheet that is `h-[66dvh]` off the home
page, with its own Escape handler and Tab focus trap; `PanelDock width={400}` hard-coded),
`PanelDock.tsx` (below 560 px an existing `Segmented` **Queue · Chat** (+ **Threads** in the
popout) at `h-12`; threads rail at 880), `PanelChat.tsx` (agent picker Claude/Qwen/Hermes, History
icon, **New**; replies in `bg-ai-soft` at 13 px; `RunReview` under each reply), `JobPicker.tsx`
(existing searchable job sheet with ↑/↓/Enter/Esc), `components/shell/MobileTabBar.tsx` (phone
tab **Operator**), `components/projects/FloorPlan.tsx` + `components/floor/DesignsStrip.tsx`
(Floor tab: **Designs** with `v{n}` chips, then **Plan versions**), `components/floor/Designer.tsx`
/ `TopBar.tsx` (`readOnly` still renders the tool buttons, only disabled, plus a "Read only"
pill), `components/projects/ProjectFiles.tsx`, `app/globals.css` (`--text-body` is **13 px**;
there is a `prefers-reduced-motion` block; there is **no dark theme** anywhere), and
`docs/design-tokens.md`.

## What's strong

- One word, **Canvas**, taken from Joe, plus type labels **Diagram / Page / Floor plan**. No
  "artifact" and no L1/L2/L3 on screen. The Words table is the right tool, and most of the copy is
  short and honest. No "secure ✓" and no "approved" on a preview.
- The core loop matches the Claude/ChatGPT canvas: a card in the chat, a pane beside it on a wide
  panel, immutable versions, **Version 3 is ready [Latest]** instead of yanking the view, and
  **Use this version** making a new latest version instead of rewriting history. It never steals
  focus from take-over, approvals or the composer.
- The §4 state table is unusually complete: render failure shows the source with **Ask Claude to
  fix it**; too complex, offline, session expired, feature off, quota, and an outward 404 that
  leaks no title. Every error keeps the last working version.
- Cards come from durable version records, not Markdown. They survive reload, a crashed run and a
  run with no reply. `AssistantMarkdown` stays tiny.
- Saving is an explicit, named audience decision. **"Only Joe can read this copy."** is the default
  for Joe, financial areas are preselected under **Share with staff**, nothing reaches the portal,
  and nothing is sent.
- The floor designer is reused (same `Designer`, `readOnly`, existing versions). There is no second
  CAD store.
- Accessibility is thought about: a region name, iframe titles, one announcement per committed
  version, zoom buttons that aren't gesture-only, focus returned to the card, reduced motion.

## Required to reach 10

1. **§3 + browser §6.2: one shared pane contract, written the same way in both plans.** Today they
   disagree on every number.

   | | Canvas plan | Browser plan |
   |---|---|---|
   | Host file | `PanelContentPane.tsx` | `AskContentPane.tsx` |
   | Split at | 960 px | 720 px |
   | Minimum widths | chat 360 / pane 480 | chat 320 / browser 380 |
   | Docked 1280 desktop | stays a 420 dock with tabs; "never grow" | expands to 960 over the app with **Back to app** |
   | Phone back label | **‹ Back to chat** plus a separate × | **‹ Chat** |

   Pick one name, one split width, one pair of minimums and one back label. Put them in a single
   table and paste it verbatim into both plans. My recommendation:
   - Host: `AskContentPane.tsx`.
   - Split when the content width is ≥ 840 px, with chat at least 340 and the pane at least 480.
     That makes iPad portrait 820 a single pane and iPad landscape a split.
   - Back label: **‹ Chat** on every width, with no second × on narrow screens.

2. **§3: the docked desktop and iPad-landscape case is the common one. Make it feel like Claude.**
   At ≥ 1024 px the panel is the `aside` dock, usually about 420 px wide. Under the current plan,
   Joe's main desktop shows the diagram in a roughly 400 px tab. Adopt the browser plan's expanded
   workspace for Canvas too:
   - **Open canvas** keeps Chat at the dock's width and opens the pane over the app view to its
     right. That matches the existing "Inspect opens beside the dock" pattern.
   - The pane header gets **Back to app**, which restores the app view and returns focus to the
     card.
   - Auto-open on the dock never expands the workspace. It shows the card plus a **Canvas ·**
     badge (dot) only.
   - Add a fourth wireframe: **1280 × 900, docked dock + expanded Canvas**. Relabel the current
     1280 wireframe as "popout ≥ 1100".

3. **§3 wireframes: draw the real panel chrome.**
   - The panel is labelled **Operator** on screen (PanelHost header, sheet header, phone tab), not
     "Ask". The chat header is the Claude/Qwen/Hermes picker, the History icon and **New**.
   - Narrow layouts already have the `Segmented` **Queue · Chat**. Extend that one control to
     **Queue · Chat · Canvas** (· **Browser** when enabled). Don't add the second `[Chat] [Canvas ·
     New]` row the 360 wireframe shows.
   - "New" is a dot on the Canvas segment with `aria-label="Canvas, new version"`. The words
     "Canvas · New" won't fit four segments at 360.
   - Redraw the 360 and 820 wireframes with the Operator sheet header (grabber, chevron, ×), this
     segmented control, and then the canvas.

4. **§4: add the "more than one canvas in this chat" state and its wireframe.** A thread can hold
   20 canvases, but the pane only ever shows one. There's no way to switch between them.
   - Pane header title becomes a picker: **Permit steps ▾**. It opens a list titled **Canvases in
     this chat**: one 56 px row per canvas with its type icon, title, "Version n", time, and the
     current one ticked.
   - The empty Canvas segment shows the same list, or the empty state when there are none.
   - Specify what the Canvas segment opens: the last canvas you viewed in this tab, else the newest.

5. **§3/§4 phone loop: let Joe ask for a change without hunting for the composer, and show the
   update live.**
   - Footer of the full-screen phone and iPad canvas: **[Ask for a change]** (48 px). It switches
     to Chat with the composer focused and a hint line **"About: Permit steps · Version 2"**.
   - While a run is updating the open canvas, the canvas header shows **"Claude is updating this
     canvas…"** with the current version still visible.
   - Follow latest is on by default when you open the newest version, so Version 3 slides in. It
     turns off when you pick an older version, which brings back **Version 3 is ready [Latest]**.
     State this default.

6. **§3 phone back: specify the mechanism and the Escape order.**
   - Opening Canvas in the sheet pushes one history entry (`?canvas=<id>`; the id is already
     allowed in URLs). `popstate` and the iOS edge swipe return to Chat. A second Back behaves as
     today.
   - PanelHost's sheet Escape handler currently closes the whole Operator sheet. Escape must close
     the innermost layer first: version list or menu → code sheet → save dialog → canvas back to
     Chat → sheet.
   - PanelHost's focus-trap selector has no `iframe`. Add it, plus the pane's region, so Tab can't
     escape the modal sheet through the preview.

7. **Words, §1 table and §4/§6.5 copy: use the Claude/ChatGPT words Joe is comparing against, and
   no developer terms.**

   | Now | Becomes |
   |---|---|
   | View source (buried in ⋯) / Copy source / Diagram source (.mmd) | A **Preview · Code** toggle in the pane header / **Copy code** / **Diagram code (.mmd)** |
   | SVG / PNG / HTML | **Picture (PNG)** / **Drawing (SVG)** / **Page (HTML)** |
   | "Couldn't draw this diagram. The source is below." | **"Couldn't draw this diagram. Its code is below."** |
   | "This page uses something Canvas can't show. Ask for a static page with inline styles." | **"Claude's page couldn't be shown. [Ask Claude to try again]"** |
   | "Page formatting was repaired." | Not shown to Joe (log only) |
   | Fix prefill `Fix canvas {id}, version {n}: …` | **`Fix the "Permit steps" diagram (version 2). The error was: …`** (no UUIDs in the composer) |
   | Filename `Permit steps — canvas <short-id> — v2.html` | **`Permit steps (v2).html`** (identity is already not the filename) |

   **Try again** on a parse error only appears for timeouts and load failures, not for a
   deterministic syntax error.

8. **§4 state table: split "what Joe sees" from "what Claude is told".** `CONTENT_TOO_LARGE`,
   `UNSAFE_CONTENT` and `UNSUPPORTED_KIND` reject at tool time and create no version, so Joe never
   sees a canvas for them. Today the table words them as if Joe could act ("Ask for a smaller
   one").
   - Add one Joe-facing line for when Claude gives up after a rejection. In the transcript, where
     the card would be: **"Claude couldn't make this canvas (too big). It's still in the chat as
     text."** Use a fixed reason word: *too big / not supported / not allowed*.
   - Mark each row as **Joe**, **Claude**, or **both**.

9. **§4 version list: make "compare with its previous version" real.**
   - Add a `change_note` (≤ 120 chars, required on `update_canvas`, optional on restore) to §5.1.
   - Show it in the version list: **"Version 3 · Moved inspection before closeout · Claude · 2:14
     PM"**, and under the pane title on a non-latest version.
   - Version list on phone and iPad: a bottom sheet with 56 px rows.
   - The ‹ and › icon buttons get `aria-label`s **"Previous version"** and **"Next version"**, and
     when disabled, **"No earlier version"** and **"No newer version"**.

10. **§3 accessibility: dark mode, text alternative, zoom keys.**
    - **Dark mode:** the app has no dark theme. State that Canvas stays on the light paper theme.
      Both renderer documents set `color-scheme: light` and an explicit `--card` background, so a
      phone in dark mode doesn't paint a black iframe or invert controls.
    - **Diagram colors:** Mermaid `theme:'base'` with themeVariables mapped to tokens (node fill
      `--card`, stroke `--ink-3`, text `--ink`, accent edges `--ai`). Fonts are system fonts,
      because `font-src 'none'` blocks Mulish.
    - **Text alternative:** an **About this diagram** disclosure under the title shows the summary.
      The iframe uses it as `aria-describedby`, and its `<svg>` gets `role="img"` with
      title/desc.
    - **Zoom:** range 25–400 %, default **Fit**, and a **100 %** button. When the stage is focused,
      **+ / − / 0** zoom and the arrow keys pan. On touch, pinch zooms the diagram only (stage
      `touch-action:none`) and double-tap fits.
    - **Type sizes:** "≥ 16 px body" contradicts the token `--text-body` = 13 px. Name the tokens:
      title `font-serif text-heading` (17), meta `text-subheading` (14), and the project-search
      input at 16 px so iOS Safari doesn't zoom.

11. **§4 Save dialog: one dialog per audience, with wireframes at 360 and 1280, and the §9 copy
    folded in.** Right now §4 says "People with project-file access can read it" while §9 says to
    replace it at runtime. Write the final copy in §4:
    - **Joe:**
      - **Canvas: Permit steps · Version 2**
      - **Project** picker: reuse `JobPicker`, filtered to projects.
      - Filename.
      - Radio: **Only Joe (default)** / **Share with staff**. Share opens the areas checklist with
        money areas pre-ticked, and **"Staff with these areas can read this copy."**
      - **"It won't appear on the client portal."**
      - Buttons: **Save** / **Cancel**.
    - **Staff:** the same dialog with no audience choice. The access line reads **"Joe and staff
      with {areas} can read this copy."**
    - **Lead-filed thread:** say what happens. Either list the lead as a destination (project files
      already carry "· lead stage"), or show **"Leads can't hold canvas copies yet. Pick a project,
      or download it."**
    - **After save:** **Saved to Larson bath files. [Open file]**, plus the card's provenance line
      **Saved to Larson bath**.

12. **§8.4: show how a saved canvas looks in Project › Files.** Wireframe one row:
    - The file name.
    - A **Canvas** chip (not the shouting tag `CANVAS`).
    - **Only Joe** or **Staff: Money, Bidding** chips with a lock icon plus the word.
    - The version.
    - Opening it shows the static sandboxed view with **Made by Claude · Version 2 · Internal
      draft**.

    Joe must be able to tell from the Files tab why Abigail can't see it.

13. **§6.5: fix Copy link.** `/panel/canvas/<id>` opens only for the thread owner (and Joe), so a
    link Joe texts to staff lands on "isn't available".
    - Either drop **Copy link** for diagrams and pages in v1 and offer **Save to project files** to
      share, or label it **"Copy link (only you can open it)"**.
    - Floor plans keep their link to the real `/floor/<id>`. The Floor tab and its own access rules
      already cover it.

14. **§7 floor canvas: one version number, real chrome, and wireframes.** A floor canvas currently
    shows both **Version 2 of 3** (canvas) and **Saved version {n}** (design). That's two
    numbering systems on one screen.
    - For floor plans, show only the design's own: **"Floor plan · Kitchen layout · v5"**. The
      `v{n}` chip matches DesignsStrip.
    - The version list lists design versions, and **Load latest** appends one.
    - Inline read-only must **hide** the tool groups and TopBar edit controls. Today `readOnly` only
      disables them and adds a "Read only" pill. Keep zoom/Fit, the 2D/3D toggle (3D only on an
      explicit tap) and **Edit floor plan**.
    - Staff without the `projects` area, or on a phone where the full designer is cramped: **Edit
      floor plan** still opens `/floor/<id>`. Say what a 360 px user gets there, or label it
      **"Edit on a tablet or computer"**, the way the browser plan does for take-over.
    - Add floor wireframes at 360 and 1280.

15. **§2 iOS row / §5.4: say what Joe sees in the iPhone app before native cards ship.** He uses
    the native app (TestFlight), and today it would show a reply that talks about a diagram he
    can't see.
    - Until the mobile change, the mobile operator API appends one plain line per canvas to the
      reply body for old clients: **"Canvas: Permit steps · Version 2 — open it in the web app."**
    - The transcript card's ⋯ offers **Open in Safari** (web login required, no token in the URL).

16. **§4 chat card: specify its anatomy and its states.**
    - **Contents:** type icon (`Workflow` diagram, `FileText` page, `LayoutGrid` floor plan), serif
      title, **"Diagram · Version 2"**, a one-line summary (clamped), and a 44 px **Open canvas**
      button.
    - **Accessible name:** "Open canvas: Permit steps, diagram, version 2".
    - **While shown:** when the wide pane already shows this canvas, the button reads **Showing**
      and is disabled.
    - **Failed run:** keeps **"Canvas saved before the run stopped."**
    - **Deleted:** the generic card reads **"This canvas was deleted."**
    - **Placement:** the card sits between the reply bubble and `RunReview`. RunReview's "Changes"
      lists **Made canvas "Permit steps" · Version 2** and **Saved to Larson bath files**, in Joe's
      words.

17. **§3 exits: one way out per width.** Today there are ‹ Back to chat, × Canvas, and **Hide
    canvas** in ⋯.
    - **Narrow:** **‹ Chat** only.
    - **Split:** one × with `aria-label="Close canvas"`. It returns the width to Chat and moves
      focus to the card.
    - **Expanded over the app:** **Back to app**.
    - Remove **Hide canvas**.

## Optional

- Use the existing `Splitter.tsx` for the chat/pane split, so the keyboard handling and width
  persistence match the dock.
- Thread rail: a small canvas icon on threads that have canvases helps Joe find "the one with the
  permit diagram".
- The empty state's example button: on narrow screens, tapping it switches to Chat and focuses the
  filled composer. Say so.
- Download on a phone: a bottom sheet of 56 px rows instead of a nested menu.
