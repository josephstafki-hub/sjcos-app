# Canvas Phase 1 UI — round-1 implementation handoff

2026-11-05. Started at `2f320958743b4ea719f5060db5177bfb3b43033c`, branch `t3/in-app-browser-agent-tools`. This replaces the earlier, pre-Save UI handoff: Save/immutable derivative support now comes from the parallel server implementation. This commit changes only the assigned UI/renderer/content gates/tests, the specifically requested fixture-capture script, and this handoff. Joe explicitly authorized the additional `components/panel/PanelWindow.tsx` landscape-only change during this run.

No subagents, browser, server, Next command, install/package operation, DB/QA DB, service operation or deploy was used. The live `node_modules` symlink is untouched. The coordinator capture script has only been syntax-checked; its browser execution is deferred.

## Review items → final changes

| Design REQUIRED | Change |
| --- | --- |
| 1 | Before removing inline style, translate approved text-anchor/dominant-baseline/alignment-baseline enums into SVG attributes. Translate approved font metrics too; convert em offsets at the inherited font size. Recreate pinned flowchart node-label/cluster-label centering lost with stylesheets. All text/tspan gets stroke="none". Preserve geometry rather than moving label coordinates. |
| 2 | Fixed palette covers arrowheadPath/arrowMarkerPath and marker child shapes, solid messageLine0, dashed messageLine1 (3 3), messageText and actor lifelines. Referenced marker shapes keep visible fill/stroke; connector paths remain unfilled. Real fixtures assert 3 flowchart edges with markers, 2 sequence messages/arrows and 3 state edges with markers. |
| 3 | Renderer document/theme/palette and stage/floats use card #fbfaf4, ink-3 #5f6454, ink #2c3326, ai #5b7e72. Notes/clusters/actors/loop boxes/lines have explicit presentation after CSS removal. |
| 4 | Source limit remains the approved 100 nodes/200 edges. The QA 100-node/99-edge LR source passes the lexical gate and an inclusive parser/model seam. SVG bytes, elements, viewBox/dimensions, shared drawing-complexity failures and measured dimensions now produce fixed TOO_COMPLEX → the exact “This diagram is too complex to show here.” / Show code / Ask Claude to simplify it state. No budget was raised. The long LR output is expected to exceed the unchanged 8192-unit dimension budget; the coordinator script records the real viewBox/bytes/elements and actual bootstrap result to establish that final measured evidence. An in-budget 100-node seam renders. |
| 5 | Syntax failure controls are Copy code and Ask Claude to fix it, with code already visible below. No redundant Show code or retry in that error block. Fixed diagnostic enums identify source, parser, layout or SVG-gate failure; trusted UI translates each to a bounded plain line and uses the identical line in fixCanvasPrompt. Raw parser messages/source never become diagnostics/logs. |
| 6 | Both source displays explicitly disable liga/calt and font ligatures. |
| 7 | Save Project control has the empty-string fallback “Pick a project”, border and 48px target. Real JobPicker has an opt-in in-flow mode, 16px search and 48px rows; all existing dropdown-mode sizing/positioning is preserved. Unchosen destination says “Choose a project.” beside visibly disabled Save. Policy fetch/abort/revision/acknowledgement logic is retained. Owner UNKNOWN retains Share with staff, all 21 catalog areas, exact explanation, Untick all and one acknowledgement without row warnings after removing all areas. |
| 8 | Staff audience is read-only catalog-order chips, at most 3 names then +N more. Full title/accessibility name; overflow expands via a 48px touch button. Empty baseline is “🔒 Staff”. |
| 9 | Preview/Code pressed state has card background, ink text and card shadow. |
| 10 | Meta retains “Diagram · Version n of latest · Version latest is ready [Latest]” at every width, truncating the left version part first. Updating/notice text no longer replaces version metadata. |
| 11 | Versions joins only nonempty note/maker text. Time is 2:14 PM today, Nov 5, 2:14 PM otherwise, without seconds/numeric date. |
| 12 | Segment not-found.tsx shows only “This canvas isn't available to this account.” and a paper-theme 44px ‹ Chat link to /panel. Existing page still invokes notFound(); unit test asserts the 404 fallback signal. There is no ancestor loading.tsx; actual HTTP 404/headers remain a coordinator check. |
| 13 | Selected short-landscape popout now shares the sheet's ≥64px left strip and Canvas's 128px right action column. PanelWindow moves its existing Operator · window / Dock back bar into that strip only in this case. Popout has no Close Operator × and no extra strip Threads button; sheet retains its Close Operator ×. Ordinary widths keep the existing horizontal bar. Layout fixture budgets 204px stage even after 80px safe-area reserve at 800×360; actual stage must be measured. |
| 14 | Open canvas card action and fuller Save to project files use rounded border/rule/card button styling. |

Engineering R1 also adds bounded plain state notes (inline and multiline, nested-state scope, HTML/config/resource rejection, 500-character note lines and the existing 400-statement/32KiB ceilings). Existing real flowchart/sequence/state fixtures exercise the emitted bootstrap and independent shared SVG gate. Additional coordinator captures are automatically replayed by canvas-render-bridge.test.mjs once present.

Opaque origin, exact script hashes, one-shot authenticated MessageChannel, no network/CORS, strict Mermaid configuration, source-free renderer URL/document and fail-closed independent reconstruction are preserved. CSP hashes derive from final emitted bytes, including the production SWC-minification test. Print/PNG and L2/L3 remain gated. Server provenance/DB/grant/persistence fixes are the other builder's responsibility.

## Verification

Each file ran by itself with `node --test tests/<file>.test.mjs` (never the full suite). Latest results:

| File | Pass / fail |
| --- | --- |
| canvas-content | 54 / 0 |
| canvas-renderer | 7 / 0 |
| canvas-render-bridge | 24 / 0 |
| canvas-ui | 29 / 0 |
| canvas-routes | 20 / 0 |
| canvas-save-dialog | 27 / 0 |
| ask-panel-ssr | 95 / 0 |
| panel-content-pane | 38 / 0 |

294 passing tests, no skips. The Save integration executes actual dialog/picker effects and handlers with React hook/action/fetch seams: unbound → project row → UNKNOWN/all 21 → Untick all → bound acknowledgement → Save, then project change. This is not browser layout/focus evidence. Real-fixture tests check anchors, node-relative coordinates, text stroke, marker fill/stroke, message lines and shared reconstruction; they do not substitute for browser text bounds.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited **2**: the sole diagnostic is the parallel builder's `lib/db.ts:14`, TS2322, guarded Pool test double is not assignable to pg Pool. That file is outside UI ownership and was left untouched. No UI TypeScript diagnostics. `node --check scripts/qa-capture-mermaid-fixtures.mjs` and scoped `git diff --check` pass. No exit 137.

## Exact coordinator steps

1. From this worktree, capture additional real outputs in ONE memory-capped coordinator browser (never concurrently with the visual production build/browser):

   ```bash
   systemd-run --user --wait --pipe --collect -p MemoryMax=8G -p Restart=no --working-directory=/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be nice -n 19 node scripts/qa-capture-mermaid-fixtures.mjs
   ```

   This uses `/home/joe/ordinem/node_modules/playwright-core/index.mjs` and `/home/joe/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`, the pinned vendored bundle and the emitted bootstrap's own initialize config. It intercepts a synthetic .invalid origin without a server, aborts all other network requests, uses one browser, captures subgraphs, long wrapping labels, sequence notes/loops/alt, state notes and the exact QA 100-node LR chain, then closes browser/context in finally. Raw SVGs go to `tests/fixtures/canvas-mermaid-12.3.0-*.svg`; real raw metrics and emitted-bootstrap results go to `tmp/canvas-mermaid-fixture-report.json`. Check all small cases say rendered. Check the 100-node case draws, or its actual viewBox exceeds 8192 and it reports TOO_COMPLEX. Any different failure needs fixing before release. Retain/commit the generated fixtures; no fabricated browser fixtures were added by this agent.

2. Run `node --test tests/canvas-render-bridge.test.mjs` alone. It automatically includes newly captured real SVGs. Rerun the locked tsc after the server builder fixes lib/db.ts. No install or live build.

3. Use the coordinator's isolated memory-capped production preview with its own SJC_DIST_DIR/side port, according to AGENTS.md (pgrep first; stop every process started). No next dev, no live .next/services/DB. Capture the design judge's complete missing evidence:
   - Sheet from /today at 360×800, 390×844, 820×1180 and 800×360: no chevron, one Close Operator ×, only ‹ Chat pane exit. At 800×360 measure stage ≥200px, vertical selector and 128px right column; portrait phone stage ≥420px with keyboard closed/safe areas.
   - Popout 800×360: window bar in left strip, one vertical selector, no Operator ×, 128px right action column, stage ≥200px. Rotate sheet/popout and confirm selection/version/composer/focus survive; portrait/ordinary 1100/1280 bar/splits stay unchanged.
   - Popout viewports 855/856 give content widths exactly 839/840. At 840 verify 348 / 12 / 480. Also 1000-content split and 1100 compact/fine-pointer zoom, 1280 expanded dock with captured dock width.
   - At 360/820/1280 verify label centers within 2px of boxes, Handover contained, no text outlines, 3 flowchart arrowheads, 2 sequence arrows/labels, correct token colors, state notes, nested subgraphs, long labels, sequence notes/loops/alt. Verify exact syntax diagnostic + Copy code / Ask Claude to fix it and literal --> in both code views. Verify 100-node rendered/complexity outcome against fixture report.
   - Owner UNKNOWN Save at 1280 and 360 (open compact ⋯ first): choose a project, Share with staff/all 21 catalog rows and exact explanation, 48px Untick all; remove all → no per-row warning, one acknowledgement, Tick the line above to save, Save remains visibly disabled until acknowledgement. Change a prebound project and verify policy refresh/ack reset. Capture staff COMPLETE-narrow Save plus ≥4-area overflow chips/touch expansion and empty 🔒 Staff; verify no editable staff audience controls. Retain grant/privacy/policy gates from the server slice.
   - Preview/Code selected styling, bordered Open/Save, pinned older-version meta at every width, Versions empty note/today/older timestamps. Foreign/missing canvas must return actual 404/private-no-store/wrapper-DENY with only the unavailable sentence and ‹ Chat; no metadata.
   - Phone owner/staff ⋯ and Save captures, expanded-dock browser Back and app-nav click (exit once/navigate once), title focus/announcements, nested sheet Escape/Tab/focus return, actual Safari/iOS input zoom and opaque iframe boundaries, no cross-person pixels or console errors. Complete all deferred host captures in the design review, not just popout images.

No browser/HTTP/Safari/device evidence or release approval is claimed by these unit tests.

## Round-2 build fixes (2026-11-05)

Started from `28f57f4c1225adf14e6dd039fc59f0721356d495` on
`t3/in-app-browser-agent-tools`. One implementation agent; no delegation.

| Finding | Change | Security round-2 preservation |
|---|---|---|
| R2-1 / engineering 1 | Save passes its own authenticated Canvas project search through JobPicker.search. Failure and bordered Try again sit below the search row; failed search does not also claim no matches. | The rail's owner-only search is unchanged. New action returns only project kind/name/slug, max 20; current source session, areas, project/folder scope and Projects access are checked server-side. No private folder, contact, money or Canvas metadata is added to responses. |
| R2-2 | projectOnly suppresses FILED and folder tooltips. Inline names use text-body; secondary text, kind header and loading/empty states use text-meta. | Presentation only; folder metadata is never fetched by the Save action. Legacy rail behavior stays available in its original mode. |
| R2-3 | Project toggle uses ▴ when expanded and ▾ when closed; open-state test updated. | No authorization or policy/acknowledgement reset changes. |
| R2-4 | Fuller Save and compact-menu Save are absent for RENDER_FAILED/RENDER_TIMEOUT. Loading/LOAD_TIMEOUT retain disabled Save until an accepted derivative is ready. | Server derivative validation, immutable hashes and Save authorization still determine what can be exported; hiding a button creates no bypass. |
| R2-5 | All listed state-action controls and Untick all use rounded-md border border-rule bg-card px-3, retaining their min heights and semantic colors. | Styling only. Untick all still clears acknowledgement and cannot grant declassification or send/publish anything. |

Verification: canvas-ui **38/38**, canvas-save-dialog **29/29**. The latter uses
controlled hooks for interaction; the added canvas-project-search-db file uses
the real action, signed owner/staff sessions and real website DB identity through
mounted Save/picker → actual policy → actual Save. It covers staff without
Projects, foreign source, folder and immutable project scope, permission loss,
revocation, query bounds/wildcards and minimal response fields. **1/1** passes.
See integration handoff's round-2 verification table for security regression
files, migration replay, scans and TypeScript.

Opaque renderer origin, CSP hashes/resource denial, SVG normalization, private
404s and saved-file audience enforcement are unchanged. No renderer, content
validator, source API, owner-grant or external-delivery logic changed. No browser,
Next dev/build/start, install, live/QA DB or service operation, deployment, or exit
137 occurred; node_modules remains the live symlink, untouched.

Coordinator visual checks remain required: owner UNKNOWN and staff COMPLETE Save
at 1280/360 (click the already-open project row directly), all-21 audience and
Untick-all/acknowledgement states, picker retry below input, toggle arrows and no
FILED, read-only staff chips, syntax/complexity Save absence and bordered state
controls. Repeat the review's widths/sheets/wrappers and generic foreign 404
all-response isolation checks. This handoff does not claim browser acceptance.
