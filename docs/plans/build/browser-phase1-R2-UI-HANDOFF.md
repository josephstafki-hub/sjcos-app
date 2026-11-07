# Browser Phase 1 R2 — UI handoff

Owned UI/test paths only; no subagents, push, dependencies, Next commands,
browser/server, live database/service operation or sudo/systemctl. The explicitly
requested Canvas history test used its isolated disposable PostgreSQL harness;
its tagged cluster was stopped. Other builders' files and staged changes were
left alone. Find this slice's commit with:
`git log -1 --format=%H -- docs/plans/build/browser-phase1-R2-UI-HANDOFF.md`.

Read all 25 design findings (including screenshot references), plan Words used,
§6.2/§6.3/§6.5 and Phase 1 card, R1 UI handoff, installed Next client-boundary
guide, and the final SERVER types/handoff. Inspected the existing 320 working and
1280 pre-join Watch screenshots locally. No new screenshot or visual acceptance
is claimed.

## Item → change → regression

Test abbreviations: UI = browser-ui.test.mjs; Owner =
browser-owner-review.test.mjs; Host = panel-content-pane.test.mjs. R2 test names
include their finding numbers. Expectations were added before the main R2
renderer/hook changes: the initial UI run reproduced 19 failures (134 passing).
Additional interaction and host cases were added as the implementation developed;
the small attention-dot class fix preceded its source assertion.

| Item | Change | Test |
|---|---|---|
| 1 | The list selects the task and supplies provenance; only the session's accepted detail revision publishes Browser state. Pane and chat row share this projection, including local disconnect/control/close. Ignore old pause reasons when the task is active; reject older detail revisions. | UI `R2 1 accepted revision…`, `R2 1/2 local disconnect…`, `R2 1 real feed…` run the actual hooks, poll a stale list and verify accepted revision/state. |
| 2 | Human status words, Needs you, control/finishing words; no closed row. | UI `R2 2 human status…`, `R2 1/2…`; actual feed closure. |
| 3 | In use uses person + task_label + job_label; Public pages fallback; exclude own task both on server and locally. Refresh the owner list during polling. | UI `R2 3 In use…`, `R2 In use excludes…`. |
| 4 | Status is a heading with no image, meta with an image, or the one left Watch line. Equal error text does not repeat as an alert. | UI `R2 4 each…`; Owner `R2 4/6/9…` at 360/800/820/1180/1280. |
| 5 | Watching-owner indicator only on the initiator view. | UI `R2 5…`; Owner `R2 5/8/10…`. |
| 6 | Watch split has browserStatus in text-heading, followed directly by actions. No invented Watch sentence, second state/answers column, or staff transcript. | Owner `R2 4/6/9…`; existing C21–C26. |
| 7 | paused_by=owner and paused_by_label are authoritative. Owner sees Agent paused + named person's Continue; staff see named owner paused agent. Local success follows the ACK and is cleared on authoritative updates. | UI `R2 7 paused_by…`; Owner `R2 7…`, C24. |
| 8 | Pause agent only in working/loading AND when pause is advertised. Owner-controlled Done retains fresh/Keep paused. | UI `R2 8…`, `R2 owner-controlled Done…`; Owner `R2 5/8/10…`. |
| 9 | Watch names site_label from trusted status; allowed-origin host fallback. | Owner `R2 4/6/9…`; actual hook consumes status. |
| 10 | Owner Watch heading is person's answers; Type it only with eligible local control. | UI `R2 10-11…`; Owner `R2 5/8/10…`. |
| 11 | No Type it on phones/non-control; plain answers plus desktop takeover explanation; no answers in blank or blocked/review states. | UI `R2 10-11…`; C08 final Close-only. |
| 12 | Service unavailable is blank. Zoom/Pause live view and phone instruction require an authorized image; Resume live view remains after local pause. | UI `R2 12…`, C14, R1 Watch privacy cases. |
| 13 | Portrait actions flex-wrap, buttons retain minimum targets and wrap labels. Browser-only host action row grows to fit, with bounded vertical overflow. | UI `R2 13-14…`; Host `R2 Browser attention…`. Actual 320 geometry remains a recapture check. |
| 14 | Frame status uses whitespace-normal/break-words/line-clamp-2, Browser portrait meta row can grow. Full text remains in the accessible image name. | UI `R2 13-14…`; Host R2 wrapping case. |
| 15 | Starting primary action is Cancel, without takeover/Stop. | UI `R2 15…`. |
| 16 | Remove extra write-card sentence and invented menu sentence. Exact Phase 1 card text/action pair remains. | UI `R2 16…`, C08/C09. |
| 17 | Candidate provenance from suggested_by/label; owner sees Entered by the named person, own view You entered this. Fetch one 20-item page, explicitly Next files, approve current page only; deadline/revision/request-race guards. Over-20 fallback explains the refusal. | UI `R2 17 candidates…`, `R2 17 next candidate page…`, `R2 17 candidate paging…`; existing candidate expiry tests. |
| 18 | Review page addresses is a button in menu/Sites. Approved-address dialog is useful without pending candidates; candidates open real read review. Reload warning is exact. Unknown provenance uses Read this page? | UI `R2 18…`, `R2 18 approved-address…`; R1 reload/navigation. |
| 19 | Who can use Browser lists named people with owner first; saves selected IDs without exposing ID entry. Ineligible entries have a visible reason; unavailable list disables Save. | UI `R2 19 settings…`; settings route retains requireRole(owner). |
| 20 | Browser attention dot shrink-0; Browser tab is scoped for target counting. | Host `R2 Browser attention…`. |
| 21 | Owner busy_with_label gives Browser is busy. {person} is using it. + In use. Staff remain identity-free. | UI `R2 21…`, C10. |
| 22 | Private reconnect/absence/turn-ended/owner-pause use Take over again and no Continue. | UI `R2 22…`; existing private rest/device tests. |
| 23 | Portrait frame box uses 16:10 aspect and available max height instead of expanding through empty space. Landscape idle warning/Keep open move to action column; Answers collapses behind a 44px summary; private badge overlays the image. Owner landscape keeps a single 48/20 header/meta budget. | UI `R2 23…`; Host C29; Owner C27. Real >=200px stage/letterboxing needs coordinator measurement. |
| 24 | Reused inline project-only JobPicker in Sites; prefill from own chat folder (or pending new-chat project); capture project ID before async conversation creation and include it in create. Job appears in In use and Watch header. Existing task job is read-only because final Sites schema lacks project_id. | UI `R2 24 Sites has…`, `R2 24 create carries…`, `R2 24 Sites retains…`; Owner `R2 4/6/9…`. |
| 25 | data-browser-ui scopes feature root/shell/Watch/settings/tab/status row; stable dialog roles/names remain scriptable. Coordinator owns interactive recapture. | UI `R2 25 every confirm…`; Host scope test; Owner responsive tests. |

## SERVER contract consumed and fallbacks

Final alignment: reread `lib/browser/web-types.ts`, Sites request schema in
`lib/browser/web-transport.mjs`, and `browser-phase1-R2-SERVER-HANDOFF.md`.

- In use: `task_label`, `job_label`, `person_label`, `task_id`, `state`,
  `revision`. No task_kind on screen; missing task label → Public pages;
  missing job → omit the suffix. Server excludes caller; UI also filters taskId.
- Detail/join: `paused_by`, `paused_by_label`, `site_label`, `job_label`,
  `busy_with_label`, task + revision and existing reason/controller fields.
  Owner label falls back to identity/Owner; absent pause actor stays generic.
  Null site label falls back to the first trusted allowed-site host, never page
  content; no allowed site → Browser. Missing busy person → Browser is busy.
- Read candidate `suggested_by` is agent/person/page_link; `suggested_by_label`
  supplies the named person in owner review. Older responses fall back to the
  existing candidate source; absent source → Suggestion source unavailable.
  `items`/`next_cursor` are fetched one page at a time with limit=20. Changed
  next-page revision or late request is discarded, deadlines remain original,
  only visible candidates are approved. No automatic navigation/reload/replay.
- Settings consumes exact `people:[{user_id,label,role,eligible,reason_code}]`;
  IDs remain in saved pilot_user_ids, never an editable UUID textarea. Missing
  people → explicit unavailable list and disabled Save. Eligibility refusal has
  a human explanation instead of a raw reason code.
- Create accepts optional `project_id`; it is sent as an ID, separate from
  purpose/origin/read_proposal. JobPicker resolves the project's slug to an ID
  through an authenticated component server action, with Projects access.
  Chat prefill joins only the caller's authorized thread and own folder.
  **Final Sites strict request schema has no project_id**, despite the initial
  brief's intended seam. No unsupported field is sent: existing-task Job is
  visibly read-only (This browser keeps its current job.). This is the explicit
  fallback, not a claimed Sites job-update implementation.
- List snapshot state is no longer an independent status writer. Its metadata
  labels supply provenance; session accepted task revision drives both surfaces.
  Metadata registry holds no pixels, input tokens, viewer proofs or staff chat.

## Validation

All requested test files ran individually (no full suite). Final **362 passed,
0 failed, 0 skipped**, including runtime-name copy lint in Owner C26.

| File | Pass | Fail / skip |
|---|---:|---:|
| browser-ui.test.mjs | 164 | 0 / 0 |
| browser-owner-review.test.mjs | 14 | 0 / 0 |
| panel-content-pane.test.mjs | 41 | 0 / 0 |
| canvas-ui.test.mjs | 60 | 0 / 0 |
| canvas-floor-adapter.test.mjs | 30 | 0 / 0 |
| canvas-integration.test.mjs | 33 | 0 / 0 |
| canvas-poll-history.test.mjs | 20 | 0 / 0 |

History used only the harness under `SJC_TEST_CLUSTER_TAG=browser-p1-r2ui-1107u`,
with DATABASE_URL and SJC_TEST_DATABASE_URL unset. Cluster stopped through
`stopCluster()` (returned true). No exit 137/Killed.

Locked tsc command: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`.
An intermediate aligned UI pass exited **0**. Later shared-worktree pass exited
**2**, solely `qa/browser/runtime-endpoints.ts(31,86): TS2339 Property 'request'
does not exist on type '{}'`. That file belongs to QA and was not edited here.
Final locked rerun exited **0**, with empty diagnostics after the parallel QA
fix landed. Owned diff whitespace check passes.

## Coordinator recapture selectors and measurements

Use `[data-browser-ui]` (including descendants), de-duplicated; count only visible
interactive targets, excluding inert underlying app/Chat and modal background.
Do not count every page button. Rendered assertions do not establish pixel
geometry, Safari keyboard behavior, installed trust or privacy canary acceptance.

Browser confirms/sheets expose role=dialog, aria-modal=true, an exact accessible
name, and visible named buttons. The reused inline JobPicker has role=dialog and
an accessible name; it is nested inside the Sites focus trap, without a second
aria-modal.
Runtime names/destination in the examples must be taken from the seeded fixture.

| Dialog | Accessible name | Main actions |
|---|---|---|
| Sites | This task can use these sites. | Open browser / Add a site; Cancel; Choose job; Review page addresses |
| Job picker | Choose Browser job | Search projects…; named project row; Escape handled by picker/outer host |
| Read addresses | Review page addresses | Next addresses (when cursor exists); Close |
| Public takeover | Take over? After you take over, the agent can't see this page anymore. To let it keep reading, open a fresh browser afterwards. | Take over; Cancel; Don't ask again only owner |
| Fresh | Starts a new browser for this task on the same sites. Pages you signed in to will need signing in again. | Open a fresh browser; Cancel |
| Leave | Pause browser and return to Chat? (or Canvas/app) | Pause and return; Keep browser open |
| Owner pause | Pause Abigail's agent? Abigail will need to tap Continue. | Pause agent; Cancel |
| Replace person | Take over from Abigail? Their control ends. | Take over; Cancel |
| Options | Browser options | Back / Forward / Reload; window labels; Review page addresses; Close |
| Reload | Reload this page? | Reload; Cancel |
| Owner outer layer | Browser | nested section Abigail's browser; ‹ Back |

Read/write/final cards retain their focusable state heading (Read this page?,
This page needs these files, and exact Phase 1 write/final text), with decision
buttons in the shared action slot; they are not additional stacked dialogs.
Done is likewise a focusable state, not a fake dialog: click Done, then select
Open a fresh browser or Keep paused. Zoom remains the existing in-pane local
zoom, without remote input.

Recapture the complete item-25 interaction list at 320/360/820/1180/1280 and
800×360 for owner + staff; include /today 420 dock and 360/820 sheet, not just
/panel. Explicitly click all dialogs, actual control/Keyboard/Done/leave, Sites
errors, guarded options/reload, resource 1/20/21/expired, queue/offer expiry,
disconnect/reconnect/failure, private Show the page→pending→authorized and owner
pause/replace. Keep owner joined during a staff shot. Request /settings/browser
as staff and record refusal.

Measure 320 action wrapping/44px minimum targets, two-line unknown-result status,
portrait aspect/letterbox height, owner header site/job labels, and actual image
viewport >=200px at 800×360 with idle warning and Answers collapsed. Check larger
text, keyboard capture, focus trap/return and same accepted task revision in Chat
and Browser. Shared Canvas/Chat selection/composer/attention behavior still needs
the coordinator's real-device recapture. No Browser geometry/transport visual
verification was performed by this slice.
