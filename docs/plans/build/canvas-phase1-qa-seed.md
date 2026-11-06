# Canvas Phase 1 QA seed

Run from the repository root with the existing Node 22 runtime (native TypeScript
stripping and registerHooks). No install, Next server, browser, or model is needed:

```sh
node scripts/qa-seed-canvas.mjs "$QA_DATABASE_URL" > /tmp/canvas-qa-states.json
```

The positional URL is mandatory. Before loading any fixtures or constructing pg,
the script requires a PostgreSQL URL whose decoded database name matches
`sjcos_qa_[a-z0-9_]+`. It never reads DATABASE_URL or `.env.local` for its target.
Use only a disposable, migrated QA database. Do not use the live database or the
coordinator's `sjcos_qa_abc` database to validate this script.

The URL's login must be the existing website table owner (owner of dev_agent_runs),
or a QA administrator able to SET SESSION AUTHORIZATION to that owner. This
reuses the real website-session identity pattern from canvas-commands-db.test.mjs
without transferring object ownership or changing grants. Existing Joe and Abigail
accounts are preserved. Missing accounts receive inert fixture identities at the
requested UUIDs; Abigail needs active staff access with ai/projects permissions.

The script uses appHooks from tests/phase0a-fixtures.mjs for native TS imports,
alias resolution, and the app DB seam. All canvas creation and updates call
lib/ask-canvases.ts canvasInternal with persisted, trusted panel run contexts.
Direct SQL creates only supporting users, threads, runs, project/folder fixtures
and feature settings; it never inserts canvas or canvas-version records.

It enables diagram, staff, export, and source flags in the target QA DB. The side
build must also have SJC_CANVAS_ENABLED=1. No model or outbound provider is called.
The journal/deployment state is temporary and private to this process; inherited
live deletion-authority configuration is removed. An existing deletion-enabled
restore fails closed: use a fresh QA DB with its migrations, rather than clearing
its deletion latch. Runs are marked done after their canvas commands finish.

Each invocation adds fresh fixtures, not an idempotent reset. A failure can leave
partial fixtures; discard the disposable QA DB or rerun to create a fresh set.

Output is a JSON object keyed by named states: joe_flow_v1/v2/v3,
joe_sequence, joe_render_error, joe_large, joe_unknown_operator, and matching
abigail entries ending in abigail_complete_narrow. Each canvas state has threadId,
canvasId, version, and relative panel/wrapper URLs. History entries share a canvas
ID and have actual change notes on versions 2 and 3. Both users get one new private
thread. joe_empty_project adds projectId, projectSlug, folderId and navigation URLs:
a Joe-owned project chat folder with no chats, plus an empty folder row in Files.
On /files select the named QA project in the rail.

Joe's operator epoch is UNKNOWN (21 baseline content areas). Abigail's COMPLETE
epoch records only the synthetic empty list_project_files result using the real
beginInput/completeInput recorder and audited classifier (zero content areas).
No broad tool is called and actor permissions are never substituted for provenance.
These two dedicated states exercise the owner and staff Save-dialog paths.

Coordinator visual checks: switch accounts; open both private threads; select
history v1/v2/v3 and compare notes; preview sequence; confirm the render-error
canvas offers the error and source view (lowercase `end` is a Mermaid reserved
word accepted as an identifier by the bounded source validator); pan/zoom the
100-node, 99-edge valid flowchart; capture the two Save dialogs after rendering
prepares the SVG; select the empty project/folder. No visual verification is
performed by this script.

Implementation validation used SJC_TEST_CLUSTER_TAG=c1guard-<timestamp>, the
harness-created sjcos_qa_seedtest DB, and the real migrated schema. The seed
succeeded; database inspection confirmed seven versions per person, Joe UNKNOWN
with 21 areas and Abigail COMPLETE with zero areas. The disposable cluster was
stopped after verification.
