SCORES engineering: design=9 completeness=9
SCORES security: design=10 completeness=9

Engineering and Security judge, Canvas Phase 1 build round 3. Reviewed implementation
`e417b3b9`, specifically `43ffc8a9` and renumber `93c49fb7`, against both round-2
reviews. Concurrent commit `81589161` adds only the design review. No source was edited.
Both round-2 engineering defects are fixed. No new backend defect or demonstrated
security regression was found. Engineering remains below 10 because the known
owner audience checklist is squeezed into an unusable strip. Security completeness
remains 9: coordinator reports 95 regression shots with zero leaks, console errors
or overflow, but this reviewer did not independently inspect production DOM/all
response captures, and the corrected audience interaction still needs coordinator QA.

## REQUIRED fixes

**Engineering — R3-1: finish the Save audience layout, as specified by the design judge.**
`components/panel/CanvasSaveDialog.tsx:38,45,46,52`. This is the same defect as
`docs/plans/reviews/build-c1-r3-design.md` R3-1, not an additional backend issue.
At :38 replace `flex max-h-[65dvh] flex-col gap-3 overflow-auto py-3` with
`flex flex-col gap-3 pt-3`, allowing the existing CanvasOverlay body scroller to
handle the dialog. At :46 replace the checklist container with
`role="group" aria-label="Required access areas"` and
`className="max-h-[min(20rem,38dvh)] shrink-0 overflow-y-auto overscroll-contain rounded-md border border-rule bg-card px-3"`.
Make row labels `flex min-h-12 w-full cursor-pointer items-center gap-3`, give
checkboxes `size-5 shrink-0 accent-ink`, warning paragraphs
`pb-2 pl-8 text-meta text-ink-2`, and Keep buttons
`min-h-11 rounded-md border border-rule bg-paper px-3`. At :45 add
`shrink-0 self-start` to Untick all. At :52 replace the action-row class with
`sticky bottom-0 z-10 flex items-center justify-end gap-4 border-t border-rule bg-paper py-2`.
Extend the owner unknown-context dialog test to assert the nonshrinking bounded
checklist/group, 21 minimum-48px labels, absence of the inner 65dvh scroller, and
sticky action row. Coordinator must verify pointer/keyboard checkbox operation,
full row heights, acknowledgement gating and visible Save at desktop and 360px,
following the design review's capture checklist. The present hook tests do not
compute flex geometry; their passing results cannot certify this layout.

**Security — REQUIRED fixes: None.** The checklist problem is a usability defect;
server baseline, owner acknowledgement and staff restrictions still enforce the
saved audience. No evidence of an authorization bypass was found.

## Round-2 engineering closure

1. **Authorized staff project search: fixed.**
   `lib/actions/canvas-projects.ts:7` delegates to
   `lib/canvas-exports.ts:34`; `CanvasSaveDialog.tsx:20,42` supplies that action
   through JobPicker's explicit search seam. The owner-only rail action is
   unchanged. The real signed-session test executes the actual action and SQL
   as `sjcos_test_website`, for both owner and staff, then mounts the actual
   dialog/picker handlers through selection → policy → audience → Save.
   Staff receive readonly chips, and the test writes a real immutable saved
   copy in a temporary upload directory. Current DB permissions, source ownership,
   revocation and source/folder bindings are checked, rather than trusting the
   cookie's role or a client-only filter. Picker failures are fixed typed results
   with an explicit retry and no misleading empty-result claim.
2. **Fix/Change control envelopes: fixed.**
   `db/migrations/0109_canvas_control_envelopes.sql:5` replaces the helper
   additively; the previously applied 0107 SQL/checksum is unchanged. All four
   current diagnostics, default Fix, Simplify and composer-trimmed Change are
   recognized. The updated provenance test uses the actual UI helpers followed
   by `.trim()`, inserts the message, checks the exact byte hash and inherited
   references/areas, admits a tracked continuation, updates the actual canvas,
   renders it and Saves as staff. This seven-control integration passes.
   Arbitrary appended facts, edited diagnostics, foreign thread/title/version
   references, edited message rows, attachments and page context remain closed.
   SQL and UI still carry parallel wording rather than a single generated contract;
   the real-helper integration now detects drift, so this is not a remaining blocker.

## Migration ordering and security

Inspected `db/migrate.mjs:32,53,68-99` and main
`b061de03c01f95cae8204b112d6d207d624e9dd4`'s actual
`0110_phone_lines.sql` / `0111_sms_threads_per_line.sql` via Git only.
Numbers are identity keys, not a high-water mark: the runner sorts available
files, detects duplicate IDs, verifies checksums for matching ledger IDs, and
applies every absent ID in its own transaction. An existing maximum ID of 111
therefore does not skip 109. 0109 only replaces the Canvas helper; it neither
uses nor modifies the phone/SMS objects. Its prerequisites are installed first
by the existing 0100/0105/0106/0107/0108 sequence. No migration-number collision
with the checked main tree remains. Floor integration must use the later free
number documented by the coordinator.

Independent disposable-DB probe:

- Started from the pre-feature schema and the exact local migrations below 100.
  Executed the exact main 0110 and 0111 SQL, recording their actual SHA-256 values
  in transactions. Then invoked the real `migrate({url})`, not the subset apply
  helper, to install 0100 and 0105–0109 below those already-recorded IDs.
- Asserted every Canvas ledger name/checksum, the unchanged complete 0110/0111
  rows, the new function definition and an empty second-run pending/mismatch set.
- Also simulated an existing 0100/0105–0108 install with a missing 0109 ledger
  entry and the old 0107 helper, retaining 0110/0111. Real `migrate()` applied
  **only 0109**, installed the current diagnostics and retained the later rows.
- Verified `prosecdef=true`, `search_path=public, pg_temp`, and actual session
  authorization denial (`42501`) for agent, worker and readonly identities.

Thus 0109 is safe to apply below already-applied main 0110/0111 in the exercised
upgrade states. The local checkout does not contain the two main phone migration
files; its runner preserves, but does not checksum-verify, ledger IDs absent from
the checkout. This probe establishes additive Canvas ordering, not integration of
unrelated main application changes. It makes no claim about the live ledger or
whether an intermediate, formerly numbered Canvas 0110 was ever deployed; no live
DB was consulted.

The replacement remains `SECURITY DEFINER SET search_path=public,pg_temp`, with
PUBLIC EXECUTE revoked. CREATE OR REPLACE preserves existing ownership/ACLs; no
new tables, triggers, grants or role-manifest entries are needed. The real-role
rollout test and independent probe both deny narrow execution. Same-thread live
canvas/unpurged-version lookups, baseline union and original prompt hashing remain.
Unknown text is not accepted as a diagnostic or arbitrary Change instruction.

## Project-search security audit

`canvasFileTransaction` (`lib/ask-canvases.ts:427`) verifies the current signed
principal and DB permissions, feature/export flags, owned live source and thread,
version and complete staff provenance, under the existing journal/transaction
fences. `destinationScope` (`lib/canvas-exports.ts:28`) adds Projects access and
rejects lead-backed sources. Conversation and folder lookup have explicit owner
predicates. Bound project ID and owned-folder project slug are both SQL filters
before ordering/LIMIT; conflicting bindings produce no rows.

The action accepts at most 120 characters, parameterizes SQL and escapes `%`, `_`
and backslash as literals. It returns at most 20 `{kind,slug,name}` rows, with
stable ordering and no totals, cursors, emails, prices, leads, vendor/sub rows or
folder metadata. Failures pass through the existing AskResult normalizer, never
exception causes or record details. Missing and foreign sources yield the same
fixed failure in the exercised cases. A query matching only an excluded project
returns the same empty shape as no match; no excluded count is returned.

There is **no per-project staff ACL** in the current project-detail/file route
model: `app/api/projects/[slug]/route.ts:12` and ordinary file routes check the
Projects area. File-level Canvas audience and restricted sub-document rules can
hide files; they do not revoke the project itself. `lib/files.ts:82` may omit a
folder when it has no visible files, but that is not a project-opening ban.
Accordingly, this review exercised narrower destination access using the real
source and owned-folder restrictions, rather than inventing an unsupported ACL.
Unbound Projects-authorized staff can search ordinary project names. A future
per-project ACL would need to be added to this query too.

No count/existence leak beyond those authorized project names or SQL-scoped
results was demonstrated. There is no constant-time claim: ordinary SQL execution
and shared journal locking have variable latency. No exact count or timing oracle
for excluded names is intentionally exposed, and the ordinary Projects reader
already authorizes those project names. This is acceptable for the current model.

## Twenty fresh adversarial cases

Ran as an inline review-only program against real signed sessions, actual action,
actual SQL helper/triggers, a website session identity and an isolated tagged
cluster. No source/test file was added. Expectations preceded execution; all 20
passed.

| # | Case and expected result | Result |
|---|---|---|
| 1 | ai/money staff without Projects gets no project names | Pass |
| 2 | Project-bound staff source returns only its matching destination | Pass |
| 3 | Owned-folder staff query matching only an excluded project is empty | Pass |
| 4 | Conflicting source/folder bindings return no names | Pass |
| 5 | Percent, underscore and backslash search literally | Pass |
| 6 | SQL-injection-shaped term returns empty fixed success | Pass |
| 7 | Foreign owner source and random source have the same bounded refusal | Pass |
| 8 | Owner with 24 matches gets only 20 minimal rows | Pass |
| 9 | Overlong/non-string terms, fractional version and malformed ID fail closed | Pass |
| 10 | Signed owner role cannot override the staff DB role/missing Projects | Pass |
| 11 | Real quoted-title Fix inherits money and exact bytes/record hash | Pass |
| 12 | Fix with appended invoice facts becomes unknown | Pass |
| 13 | Trimmed Change with appended invoice facts becomes unknown | Pass |
| 14 | Altered diagnostic becomes unknown | Pass |
| 15 | Same title with nonexistent version becomes unknown | Pass |
| 16 | Another thread cannot borrow a matching canvas control | Pass |
| 17 | Zero-width suffix is not a canonical control | Pass |
| 18 | Editing a known message to another canonical control stays incomplete | Pass |
| 19 | Canonical control plus attachment stays incomplete | Pass |
| 20 | Canonical control plus page context stays incomplete | Pass |

## Regression and verification record

Every runnable test file touched by these commits ran alone; both changed fixtures
were exercised by those files. Additional security regression files also ran alone.
All files ran sequentially, with `SJC_TEST_CLUSTER_TAG=c1r3-<timestamp>` and cleanup.

| File under tests/ | Passed |
|---|---:|
| canvas-project-search-db.test.mjs | 1 |
| canvas-provenance-db.test.mjs | 5 |
| canvas-rollout-db.test.mjs | 7 |
| canvas-save-dialog.test.mjs | 29 |
| canvas-ui.test.mjs | 38 |
| ask-private-query-scan.test.mjs | 9 |
| db-roles-manifest-db.test.mjs | 6 |
| db-roles-paths-db.test.mjs | 3 |
| test-db-guard.test.mjs | 23 |
| canvas-classification.test.mjs | 8 |
| canvas-content.test.mjs | 54 |
| canvas-renderer.test.mjs | 7 |
| canvas-render-bridge.test.mjs | 29 |
| canvas-routes.test.mjs | 20 |
| canvas-input-gates-db.test.mjs | 25 |
| canvas-exports-db.test.mjs | 2 |
| canvas-commands-db.test.mjs | 21 |

**287 passed; zero failed/skipped.** The 20 fresh cases and migration-order probe
are additional. `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited 0,
once. `node scripts/db-roles-scan.mjs --diff` exited 0; listed withheld private/owner
privileges remain intentional. `git diff --check` passed before writing this report.

The get_project classification/historical-copy regression, actual file resolver,
guarded-pg runtime census and hostile connection checks, SVG gates/normalization,
opaque-origin renderer/CSP route tests and narrow-role private Ask denial all pass.
The wider api-auth hasAccess extraction preserves owner/staff/other-role behavior.
No raw private-read grant or weaker owner acknowledgement was added. No round-2
security finding regressed in the inspected changes and executed tests.

All four disposable clusters used by this review were stopped (first test batch,
20-case probe, migration probe, regression batch). No Next command, browser,
application server, package install, live/QA database access, protected deployment
state, service change or deploy was performed. No exit 137 occurred. Only this
report is staged/committed. Coordinator retains the visual checks above.
