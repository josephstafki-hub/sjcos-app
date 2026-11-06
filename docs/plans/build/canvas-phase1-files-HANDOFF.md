# Canvas Phase 1 files and exports handoff

Implementation sub-agent, 2026-11-05, assigned worktree/branch. Started from
8e66ed67; the parallel classification builder committed 5216c016 while this
slice was in progress. Its classification module/tests and provenance DB tests
were neither edited nor staged by this implementation. No subagents.

## Item → change

- **0108**: immutable SVG tuples and hashes; separate retained-derivative byte
  counters combined with 0106 source caps (thread/person/global); accepted render
  and save rate windows; immutable audience/save recipes, actor-bound request
  identities, reserved-file IDs, generations and trash association. Adds only
  phase cursors/checkpoints to the **existing 0105 maintenance lease**. Source
  purge clears derivatives/accounting, retaining shells; job files stay intact.
  Schema snapshot follows the existing 0106/0107 convention of referring to the
  ordered ledger rather than creating private tables before prerequisites.
- **Role manifest/guards**: four website-only tables, no narrow grants. All
  trigger functions are SECURITY DEFINER with fixed search_path and revoked
  PUBLIC execution. RLS on files/trash partitions narrow readers before names,
  counts or pagination. A boolean-only executable helper permits that RLS check
  without giving narrow callers the private website-login helper. Inserted
  snapshots must match their reserved recipe. Immutable profile/policy/path/hash
  guards prevent replacement or publication. All existing FK carriers of files
  receive a trigger rejecting Canvas attachment/publication/signature references.
- **SVG/render/download**: strict `{svg}` contract, shared SVG validator on upload
  and every export/save, one accepted hash per renderer/version, equal replay
  without quota growth, different hash → 409. No server renderer/browser. Fixed
  SVG MIME/attachment filename/static CSP/nosniff/private-no-store; source remains
  the existing plain-text selected-version `.mmd` download. Effective exports
  require migration 0108, diagram/export/staff/master flags.
- **Save backend**: authenticated same-origin preflight, acknowledgement and Save
  routes; own source thread, current content provenance, target project and
  current source-area checks. Cross-project bound canvases and lead threads are
  refused. Current parent/version/provenance/classifier/catalog/person/project
  revisions bind policy; stale policy returns 409 and authorized fresh preflight.
  Owner API omission defaults owner_only; explicit staff subsets require exactly
  matching five-minute actor/auth-epoch/version/project/revision/removed-set HMAC
  acknowledgement. Staff must omit audience/ack; their saved areas derive only
  from content. Policy/bytes remain pinned independently of later source access.
- **Publication/recovery**: transaction reserves recipe and durable ID; exclusive
  temp, fsync and atomic no-replace hard link write; a separate fenced transaction
  reauthorizes and publishes file + save + saved event. Live policy conflicts
  preserve old access. Ready replay and every request identity are retained.
  Explicit Save another copy after trash creates a new generation; failed
  unpublished work requires a fresh deliberate request. The authenticated
  maintenance route resumes bounded recipes (max five attempts/backoff), checks
  revocation/flags/policy again after filesystem work, purges expired Canvas trash
  while retaining minimal save provenance, and sweeps only Canvas-owned orphan
  names after durable reference checks. It uses the original lease/fence and
  maintains a durable directory cursor; the caller script starts no renderer.
- **Saved-file boundary**: named human/session or admitted live runner resolver;
  shared snapshots require projects + their saved areas, **not ai or source-thread
  ownership**. Signature-only, portal/client/sub/service delivery denied. Static
  file responses verify immutable blob hash and carry strict Canvas CSP. Human
  and mobile listings filter before metadata; authorized trash lists preserve
  policy. Trash skips only the known save-ledger FK, checks other references,
  retains identity/policy, and restore atomically relinks the original generation.
  New active generation or name collision refuses restore.
- **MCP**: construction-time `canvasFileCall` captures admitted stdio context and
  rejects HTTP/bare/HTTP-ALS before forwarding. Secret internal endpoint repeats
  Claude/MCP/run/person/start/revocation checks and current saved-file policy.
  Bidding/upload list/read/trash/restore merge only authorized Canvas results;
  other ordinary MCP readers explicitly partition Canvas out, with RLS defense.
  No signed URL is minted for a Canvas snapshot.
- **External callers**: portal file routes, newsletter image capability, client
  file lists, bid assembly, mobile related-file readers, enqueue attachment loader
  and delivery attachment loader exclude Canvas. Delivery also rejects stored
  Canvas paths in already queued references. Owner grants cannot bypass these
  restrictions.
- **UI**: lazy Save dialog reuses project-only JobPicker, pinned filename/version;
  Joe sees staff first/preselected and optional Only Joe. Server catalog drives
  all 21 areas and exact labels. Unknown explanation, 48px Untick all, ≤3-only row
  warnings, single exact-set acknowledgement, full accessible removed list,
  expiry/selection/project/revision reset, stale-policy refresh, explicit another
  copy option. Staff gets read-only content chips. Existing Save and Drawing SVG
  controls are enabled only under backend availability and accepted derivative.
  Project Files shows Canvas/audience/version in wrapping metadata, expandable
  area labels, and the non-action “Canvas copies stay internal.” lock in place of
  Publish. Source thread links are never added.

## Verification

Expectations preceded implementation. Every file was run separately/sequentially;
DB files used isolated `SJC_TEST_CLUSTER_TAG=c1files-1105*` clusters, stopped after
success or failure. Final passing counts:

| File | Pass | Fail | Skip |
|---|---:|---:|---:|
| tests/canvas-exports-db.test.mjs | 2 | 0 | 0 |
| tests/canvas-retention-db.test.mjs | 1 | 0 | 0 |
| tests/canvas-save-dialog.test.mjs | 25 | 0 | 0 |
| tests/canvas-routes.test.mjs | 18 | 0 | 0 |
| tests/canvas-ui.test.mjs | 24 | 0 | 0 |
| tests/ask-private-query-scan.test.mjs | 9 | 0 | 0 |
| tests/db-roles-manifest-db.test.mjs | 6 | 0 | 0 |
| tests/db-roles-paths-db.test.mjs | 3 | 0 | 0 |

DB assertions use real website/narrow session identities and signed sessions.
They cover immutable/replayed/conflicting SVG, unknown all-21 preflight,
Untick-all exact-set tokens, altered-set rejection, stale revision and cross-job
refusal, safe owner default, staff omitted-audience/no actor-area inflation,
no-ai job reader, signed/delivery refusal, policy-preserving trash/restore,
new-generation restore conflict, source purge without job-file loss, and a crash
after blob creation resumed by the actual maintenance phase under the lease.
Dialog tests include 22 removal-count boundaries plus filename/empty-baseline
and transport cases; these are pure policy/transport tests, not hydrated-browser
interaction evidence. Route tests execute handlers with controlled command seams.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0.
`git diff --check`: exit 0. Private-query scan: 9/9. Role scan `--diff`: exit 0;
its reported Canvas SELECT/INSERT reachability through shared imported helpers is
**intentionally withheld**, explained in manifest notes, not a reason to grant
agent/worker raw ledger access. Actual role manifest and MCP/worker path tests
pass. Generator command:

```
node scripts/db-roles-sql.mjs ask_canvas_derivatives ask_canvas_file_saves ask_canvas_derivative_usage ask_canvas_file_requests
```

Output is empty: all four are website-only, so no narrow GRANT SQL is generated.

During test development one relative DB import bypassed the test seam and tried
an unconfigured default Postgres connection. Authentication failed before a query
ran; changing to the standard aliased DB seam fixed it. No successful live DB
connection, live data change, service operation, QA database/state access, package
operation, server/browser startup or exit 137 occurred. The live node_modules
symlink was untouched.

## Not done / coordinator acceptance

No deploy, migration of a live database, server/build/start, or visual/browser QA.
PNG and actual Print remain gated. Coordinator must verify the 360px unknown
third frame, all-21 Untick-all/retick/expiry flow, checkbox focus and screen-reader
names, 800×360 shared-host layout, wide Save control, Files chips/lock and actual
SVG/download/CSP behavior in the deployed Next environment. Existing Phase 0
journal-authority/deployment acceptance and other builders' release gates remain
required; passing these focused tests is not acceptance of the whole release.
