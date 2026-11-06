SCORES: design=10 completeness=10

Engineering judge, build round 4, `t3/canvas-phase2-3` at `e5970856`, base main `c922976b`. Reviewed the three prior engineering reviews, round 3 security/design findings, and both commits in `122e850a..HEAD`: `8c52861d` records the reviews; `e5970856` changes only the floor pane and its focused UI tests. The prior server/action/migration/renderer implementations are unchanged. No source or test edits, commit, dependency installation, Next build/start/dev, browser, live/QA database connection, deployment or protected-service operation. This review is the only authored file; concurrently authored round 4 reviews were left untouched.

## Round 3 required fix: verified

**Fixed at `components/panel/canvas/floor/FloorCanvasPane.tsx:43–51`.** The newest known Canvas head is the maximum of the polled response and matching store item. Historical selection renders the existing-newer-version notice and calls `selectCanvasVersion(canvas.id, latestVersion)` through **Latest**. It does not invoke the floor mutation. The notice uses the head's design number only when the store describes that head; otherwise it says **A newer version is ready**. Both the designer-change notice and change-note fallback are suppressed while older. **The floor plan changed. Load latest** remains available for a genuine live-designer difference on the current Canvas head.

The round 3 supplemental reproduction now passes through the real pane, real store selection/loading, authenticated Canvas commands and PostgreSQL: distinct immutable v1/v2 pins, live drawing matching v2, v1 selected. The historical read reports `floor.changed=true`; the head reports `false`. The pane offers **Latest**, no **Load latest**, and navigates to Canvas v2 with a GET. Before/after database comparisons preserve version rows, snapshot rows, request/event counts and live geometry. There is no POST and no misleading already-current notice.

A separate real head edit still posts `floor-latest` with the current Canvas CAS and designer revision, appends one new Canvas version/pin, selects it and preserves historical pins. A restored historical design pin on the current Canvas head correctly offers **Load latest** when it differs from the live designer. Canvas version numbers and design snapshot numbers remain distinct; snapshot comparison/hash behavior was not changed to mask the UI issue.

## REQUIRED fixes

None.

## Ten fresh executed cases

All **10/10 pass**. Executed from stdin without saving source/test files. The component and store are transpiled from their actual source; React hooks, pane registry and browser scheduling are controlled seams. Network calls invoke the real authenticated Canvas commands against the disposable harness database. Polling case 6 executes the pane's actual content effect and scheduled callback with a controlled interval, not a browser.

| # | Expectation and observed result |
| --- | --- |
| 1 | **Original r3 supplemental:** distinct pins, live=v2, v1 selected → head design-number notice and Latest; real store selection plus GET reaches v2; no POST or database mutation. |
| 2 | **Identical geometry:** restoring v1 into Canvas v2 reuses its snapshot; selected v1 still offers Latest because the Canvas version is older, even with `floor.changed=false`. Historical change note is suppressed; navigation writes nothing. |
| 3 | **Live drawing ahead of the existing head:** history first offers Latest without mutation. After navigation, the current head offers Load latest; it appends Canvas v3 and the new pin. |
| 4 | **Polled head newer than the store:** response head v2 beats store head v1; wording is generic rather than using v1's design number. Latest selects/loads v2 despite the stale list and writes nothing. |
| 5 | **Store head advances while history is open:** selected v1 remains selected while the head moves v2→v3. Rerender updates the notice/design number and Latest target to v3; navigation is mutation-free. |
| 6 | **Poll advances the head while the Versions sheet is open:** the real content poll keeps selected v1 and the open sheet, observes head v2 before the list, and supplies generic Latest navigation to v2 without mutation. |
| 7 | **Different numbering systems:** pre-existing designer saves make design numbers differ from Canvas versions. The notice labels the design number; Latest selects the Canvas version, not the design number. |
| 8 | **Unrelated store item:** a different Canvas with head 99/design number 888 cannot influence the selected Canvas's notice or navigation target. |
| 9 | **Actual new drawing change on the head:** one Load latest click posts one request with `base_version=2`, `expected_design_rev=2` and a request ID; creates Canvas v3 and a distinct snapshot; historical v1 remains unchanged and the new head matches live geometry. |
| 10 | **Unchanged versus restored head:** an unchanged current head shows its change note and neither Latest nor Load latest. Restoring an old pin as current Canvas v3 shows Load latest, suppresses its restore-note fallback, and loading live appends v4 while reusing the existing matching designer snapshot. |

Mutation-free cases compare actual persisted Canvas versions, designer snapshots, Canvas request/event counts and live drawing before/after navigation, in addition to checking the absence of POSTs. Each case has its own principal/thread/design fixture to avoid unrelated rate-budget exhaustion.

## Regression verification

**236 existing tests pass across eight individually executed files**, plus the ten fresh cases above. No full-suite command was used.

| File (`tests/*.test.mjs`) | Passed |
| --- | ---: |
| floor-ui | 22 |
| canvas-floor-adapter | 30 |
| canvas-floor-db | 18 |
| canvas-ui | 60 |
| canvas-poll-history | 20 |
| ask-private-query-scan | 11 |
| floor-actions-db | 53 |
| canvas-commands-db | 22 |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited **0**. `git diff --check` passed. No exit 137/resource kill occurred.

These reruns retain the round 3 selected-history publication authorization, denied-source estimate ordering/rollback, designer save/restore and immutable pin lifecycle, duplicate Delete/stale-completion fencing, page readiness, history/CAS/idempotency and private-query protections. The production diff since round 3 is confined to the floor metadata decision/rendering; no new regression was found. This is a focused round 4 rerun, not a claim to have repeated all 28 round 3 files.

All database work used `tests/_harness/testdb.mjs`, explicit harness-minted socket URLs and real test website session identity. Child test processes received explicit database URLs, including every database-login environment variable; no default/live URL was used. Cluster tags `c23-eng-r4-1106-615`, `c23-eng-r4-probes-1106-615` and `c23-eng-r4-regress-1106-615` were each stopped with `stopCluster()` returning **true**; no tagged state file remains. Neither the live cluster nor QA port 5499 was touched.

## Coordinator QA evidence and optional items

Read the single merged `/home/joe/qa-sjcos/abc/shots/c23-r4/summary.txt`: 121 shots, positive control passed, NOT-OPENED/leaks/external/overflow empty. Its four resource errors correspond to the four explicitly checked foreign-object 404 cases. Inspected the supplied `owner-floor-desk1280-selected-v1.png`: **Floor plan v2 is ready Latest**, no designer-change notice. The supplied `owner-floor-desk1280-used-v1.png` shows the restored v1 drawing as current with **Load latest**, consistent with the live designer remaining at its newer drawing. The merged restore result records confirmation and the completed v1 result. These are coordinator artifacts; this reviewer did not start a browser or reproduce the production QA run.

Optional: retain permanent integrated regressions for the fresh cases that combine real store navigation with SQL, especially distinct Canvas/design numbering and a polled head advancing before the store list. Existing round 3 device-specific printing, focus/Escape and WebGL-disposal acceptance checks remain release follow-up, not new required fixes from this patch. No release, feature-flag change or deployment is implied by these scores.
