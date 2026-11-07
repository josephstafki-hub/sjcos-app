# Browser Phase 1 R4b — Earlier view UI handoff

UI slice on `t3/browser-phase1`; find its commit with
`git log -1 --format=%H -- docs/plans/build/browser-phase1-R4b-UI-HANDOFF.md`.
No push, subagents, dependency install, Next commands, browsers, live database
or service operations. The requested browser-ui file uses its existing tagged,
disposable SQL harness and stops that cluster in its finally block.

## Root cause and change

The renderer already had the exact `Earlier view` text and image name. Its
previous regression injected `state: loading` directly, bypassing the session.
The session always derived `working` for an active agent task, losing navigation
loading intent. The pane now consumes optional `navigation.loading === true`
as presentation metadata, retaining the shown frame while loading. The exact
image name is `Live view of city.example. Loading city.example….`.

An accepted replacement frame completes the loading episode. Repeated polls
with the same loading flag cannot label that replacement as an earlier frame;
a non-loading update or new document resets the completion marker. Pending
reviews, reason states and actual control retain their existing priority.
Without a frame, loading shows plain loading and no Earlier view.

Privacy (including privacy_mode), context-generation changes and stream
rotation clear retained pixels. Late callbacks from aborted or reauthenticated
streams cannot restore them; a changed stream binding rejects frames from the
previous binding. Loading metadata provides no control authority.

## Server integration dependency — coordinator action required

This UI slice alone does **not** make the installed QA fixture render Earlier
view end to end at source HEAD bf21b4d3. Read-only inspection found:

- `scripts/qa-browser-fake-controller.mjs` supplies `loading` in its navigation
  hook and in `read_state.navigation` after the first earlier_view frame.
- `lib/browser/website-bridge.mjs` `navigationProjection` returns only generation,
  document/read revisions and target IDs, dropping `loading`.
- `lib/browser/web-types.ts` BrowserStatus.navigation has no loading field.
- The frozen SSE state schema and website state payload have no navigation
  loading field either. The hook's state handler reloads detail, so exposing
  the flag in authenticated detail is sufficient for the current polling path.

SERVER must expose the boolean loading flag through the authenticated detail
navigation projection and reflect it in its shared type. This slice uses a
pane-local optional type extension; no lib/API/QA/script files were changed.
Do not claim fixture screenshot acceptance until that producer path is wired.
No fallback guesses loading from frame age or absence.

## Expectations first and validation

Seven new hook expectations initially failed before implementation. A separate
stream-generation case and late old-stream callback assertions then exposed
three remaining rotation failures, fixed before the final full run.

Eight new R4b cases cover retained-frame loading and exact image name;
replacement frame and repeated loading poll; initial plain loading; privacy
boolean; privacy mode; context generation; reauthentication rotation; changed
stream ID; and changed stream generation. Boundary cases also replay a late
old-stream frame and require zero pixels.

Requested files ran one at a time:

| File | Passed | Failed / skipped |
|---|---:|---:|
| browser-ui.test.mjs | 217 | 0 / 0 |
| browser-owner-review.test.mjs | 18 | 0 / 0 |
| panel-content-pane.test.mjs | 42 | 0 / 0 |

Total: **277 passed, 0 failed, 0 skipped**.
`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
Owned `git diff --check`: **exit 0**.

## Coordinator visual check

After the SERVER dependency above is resolved, recapture `--state earlier_view`
using the existing QA fixture instructions. Confirm the retained image remains
visible with exact text `Earlier view` and the image name above; then deliver a
replacement frame and confirm Earlier view disappears. Check privacy changes,
context replacement and rotation reveal no previous pixels. No visual check was
run by this implementation sub-agent.
