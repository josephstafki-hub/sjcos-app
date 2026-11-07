# Browser Phase 1 R5 — UI handoff

Implementation sub-agent on `t3/browser-phase1`; no subagents and no push.
Find this slice's commit with `git log -1 --format=%H --
docs/plans/build/browser-phase1-R5-UI-HANDOFF.md`.
The parallel QA builder's `73044ad7` is this slice's parent; its files were not
edited or staged by this slice. Only the hook, Browser model, Browser UI tests
and this handoff changed.

Read AGENTS.md, both R5 reviews, plan §6.5 and the take-over exit contract,
R4 UI handoff, and the installed Next Server and Client Components guide.
No Next commands, app servers, browsers, live database/service operations,
package installs or exit 137/Killed. Required SQL-bearing tests used their
isolated disposable harnesses, which completed cleanup.

## Item → change → test

UI = `tests/browser-ui.test.mjs`; Owner =
`tests/browser-owner-review.test.mjs`; Pane =
`tests/panel-content-pane.test.mjs`.

| Item | Change | Evidence |
|---|---|---|
| Design 1 / Engineering 1: sticky connection loss | Task/lifecycle-scoped recovery ref records terminal STREAM_STALE, unexpected EOF and transport rejection. Ordinary detail/presence cannot erase it, reopen SSE, restore pixels or enable input. Accepted closed/failed/access/auth outcomes and real pending reviews retain precedence. Explicit Reconnect obtains a new accepted join; successful pause/Stop/take-over/fresh browser and lifecycle departure clear the hold. | UI `R5 sticky loss ...` covers paused public/private × terminal close/EOF/rejection, a detail reply already in flight at loss, and unchanged-revision polls at simulated +6 s and +12 s. It asserts exact loss copy, Reconnect, blank pixels, capture off and no automatic subscription. Explicit reconnect verifies public review/Resume and private Take over again/no Resume, including phone button absence. `R5 disconnected exits via ...` covers Stop, take-over, fresh browser, task replacement, closed, failed, real review, auth and access loss. |
| Design 1: failed pause keeps this person's control | Pause retains the local token while its request is outstanding. On failure, recovery is held and fresh detail is loaded; the token is restored only for the same person-control epoch/context and an unexpired token. Capture/input remain disabled. Successful Try again or Stop completes the pending leave; stronger outcomes still win. Recovery copy is prioritized over private Watch status. | UI `R5 sticky pause failure preserves control and exits via ...` verifies exact Couldn't pause / Try again / Stop browser copy after +6 s and +12 s polls, no other-device copy, retained leave guard, disabled capture/input, and successful retry/Stop/take-over/fresh/task/terminal/review/auth exits. |
| Design 2: pending audit → authorized image | Install the consent join's viewer/claim before publishing authorization. An older join revision may be rejected as metadata without discarding its new credentials. Reload responses are bound to the viewer that requested them. Stream effects track viewer/claim/stream identity, wait for acquisitions, recheck identity after drain, and reject callbacks from departed viewers. A stream refusal stays waiting only when fresh authenticated detail for that same consenting viewer confirms pending audit; real failures retain their refusal behavior. | UI `R5 private audit transition ...` verifies pending → authorized → actual image and current viewer/claim. `R5 consent join reply behind authorized poll ...` holds the join reply while a newer authorized poll arrives, then verifies the current credentials, preserved newer revision and image. `R5 private stream refused ...` covers FORBIDDEN, SERVICE_UNAVAILABLE and STREAM_STALE followed by pending audit and then authorized pixels. Existing R1 audit-gate/invalidation tests and Owner C21/C22 remain green. |
| Design 3: owner busy fallback | A supplied holder label uses `Browser is busy. {person} is using it.` Otherwise the owner uses the same known-position sentence as staff, never a bare busy sentence when position is available. | UI `R5 owner queued uses holder name or known queue position` asserts both branches. QA holder seeding belongs to the separate QA commit. |

The initial 17 expectations were written and run before source edits: 16 failed
(recovery/queue) and the ordinary private transition passed. The delayed
consent-reply expectation and the pending-audit refusal expectation also failed
before their respective fixes. Additional terminal/exit coverage was added
while completing verification. One existing R4 fixture callback referenced its
not-yet-initialized fixture variable during initial stream open; that artificial
transport exception is now removed by emitting bootstrap metadata independent
of that variable. Its queue/session assertions are unchanged.

## Design 2 root cause: UI defect, not a fixture-only diagnosis

The concrete UI race is `show_private`'s former `if (!apply(v)) return` before
installing `viewer.current = v`. An authorized poll with revision 4 can beat a
consent join reply with revision 3. The metadata fence correctly rejects the
older revision, but the old code also discards the consented viewer/claim and
never opens the image stream. The new actual-hook regression reproduces this
ordering and fails with zero streams before the fix. The ordinary ordered
pending → authorized transition already passed before this change.

Separately, a stream open refused before audit completion must be interpreted
using fresh detail rather than permanently replacing the pending screen with a
connection/access error. The three refusal regressions verify that behavior
without allowing frames while pending or hiding a genuine authenticated-detail
failure. There is no automatic consent, control grant or server/audit bypass.

This establishes and fixes UI binding/timing defects. It does not claim the
historical screenshot's specific 503 was reproduced in a browser. The parallel
QA builder's handoff in the fixture doc independently verifies signed audit
release, another poll and repeated private JPEGs on the same viewer/stream.
Recapture at 360/820/1280 at least 11 s after release, with the panel visible;
verify the private label/image and no normal-delay Couldn't connect screen.

## Validation

Single files, sequentially: **450 passed, 0 failed, 0 skipped**.

| File | Pass |
|---|---:|
| browser-ui.test.mjs | 247 |
| browser-owner-review.test.mjs | 18 |
| panel-content-pane.test.mjs | 42 |
| canvas-ui.test.mjs | 60 |
| canvas-floor-adapter.test.mjs | 30 |
| canvas-integration.test.mjs | 33 |
| canvas-poll-history.test.mjs | 20 |

Copy lint: Owner C26 passed, rendering all Browser states and private-audit
variants with Abigail/Mark/Sam and Joe/Alex/Taylor; no gendered third-person
pronouns. Existing exact §6.5 copies remain unchanged.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**, no
diagnostics. Owned `git diff --check`: **exit 0**.
Browser UI SQL uses the existing process-specific `browser-p1-r4-ui-<pid>` tag;
Canvas history used `browser-p1-r5-ui-canvas-history`. DATABASE_URL and
SJC_TEST_DATABASE_URL were unset for those test commands. Both disposable
harnesses finished and stopped.

## Coordinator follow-up / optional items

- Recapture public/private loss and failed pause immediately and again ≥6 s
  later, then each planned recovery. Hook regressions advance time without
  running browsers or waiting on real 5-second timers.
- The QA-owned fixture doc still says at line 244 to capture disconnected
  promptly because polling can replace it. Remove that obsolete instruction;
  replace it with a second capture ≥6 s later proving the copy persists. This
  slice did not edit that file because it belongs to the parallel QA builder.
- Optional ⋯ at 820 was not visually reproduced (browsers prohibited). Existing
  all-dialog title-slot hiding tests pass; no speculative host change was made.
- Optional `Files 1–20 of 21` was skipped: the frozen paged read response has no
  total count, so deriving an exact total requires fetching more pages or a
  contract change. The existing bounded page-of-20 decisions remain intact.
- Stop loading remains deferred because there is no guarded server control.
