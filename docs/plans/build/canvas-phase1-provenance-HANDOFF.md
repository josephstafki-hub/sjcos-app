# Canvas Phase 1 provenance and MCP wiring

This slice implements migration 0107. It does not deploy or accept the entire
Canvas release. Integration/mobile/UI paths owned by the parallel builder were
not edited or staged.

## Item → change

- `0107_ask_context_provenance.sql`: website-only conversation state and hash-only
  input records, revisions, pending/resolved state, tracker/classifier versions,
  epoch/policy hash, and sticky unknown. Existing conversations start unknown.
  New conversations start tracking at creation. Message/steer writes, new run
  epochs, and interaction response transitions are tracked by SECURITY DEFINER
  triggers with `search_path=public,pg_temp`; all PUBLIC execution is revoked.
  Canvas versions retain revision/manifest hash with no FK to these tables.
- `conversationProvenance({client,threadId})` now reads actual manifests inside
  the caller's transaction. No epoch, unknown history, incompatible version or
  unresolved input means `complete:false,areas:null`. Actor permissions never
  classify data. Completed input refs/hashes enter Canvas versions, not text.
- `ask-context-inputs.mjs` supplies begin/complete, epoch admission, canonical
  readers, attachment generation pinning, question normalization and the closed
  transport. All persistence takes the same conversation row lock as Canvas.
  Filesystem work occurs between committed begin and completion transactions.
  Transport/persistence gaps withhold results, poison the adapter and attempt to
  leave an unresolved durable failure marker. There is no fallback to delivery.
- Operating docs use a checked-in manifest of 14 approved root Markdown documents
  under `docs/automation-reliability`; credentials inventory and arbitrary paths
  are excluded. IDs, versions, exact source/output hashes and query hashes are
  tracked. Root/path/descriptor checks reject symlinks, hard links, non-files,
  replacement/hash mismatch and aliases. Reads have fixed allocation and stable
  fstat checks; source/output are bounded to 256 KiB, search/list to 20 results.
- Business attachments use server-issued IDs/generation hashes instead of native
  paths, including unseen earlier turns. Reads reauthorize the same owned live
  thread and pinned message generation. Source size is checked before bounded
  allocation (25 MiB). Ordinary uploads lack a sensitivity envelope and make
  completeness unknown immediately when ingested, even before reading. Text is
  delivered as bounded MCP data; binary/PDF/image extraction is refused with a
  fixed tracked error, without an external extraction process or native fallback.
- Both sjcos/interact question servers use `trackedInteractions`: pending before
  create/wait, synchronous completion before delivery. Website answers lock the
  thread before the interaction, validate options against stored payload and
  reconstruct question/choice text. A DB trigger records response hash and sticky
  unknown in the same transaction as `answered`. Free text/permission denial
  notes are unknown; fixed picks, expiry and dismissal add no areas. Completion
  validates current runner identity and exact output and is idempotent.
- Business profiles disallow Read/Glob/Grep/NotebookRead in both runners, remove
  docs `--add-dir`, use an explicit native ToolSearch list and deny forbidden
  names in interact before auto-allow. Panel business additionally requires
  strict MCP, safe mode, empty settings sources, disabled hooks/commands/Chrome,
  a scratch cwd, and no inherited NODE_OPTIONS. Pre-spawn checks inspect CLI help
  capabilities and hash the binary, runner and effective argv into the epoch
  policy. Resumed/older sessions remain unknown. Each actual prompt is independently
  ingested so a direct startClaudeRun caller cannot bypass message tracking.
  Operator behavior remains available and always unknown. Unattended web research
  retains only its explicit WebSearch/WebFetch exception and cannot admit Canvas.
- `sjcos-mcp.mjs` constructs one `createCanvasCall` with actual transport/HTTP ALS
  and a dedicated secret-authenticated forwarder (no principalPayload fields),
  then registers Canvas tools once. Every actual tool passes a synchronous
  begin/complete wrapper. Canvas mutations finalize only their own context input
  before command entry; concurrent data/question calls remain blockers.
- Classification is exhaustive: **285 actual registrations / 285 classified**,
  checked at construction and by a test against the real server registration.
  Broad business tools conservatively classify every result/scope/error as full
  C (21 areas). Canonical readers and Canvas bookkeeping add no areas; reader and
  question gates independently ingest delivered data. Unknown tools/variants are
  incomplete/full-C. This does not claim narrow classifications for broad tools.
- The internal provenance route accepts only the closed runner tuple and strict
  action shapes behind the service bearer, limits streamed JSON, rejects encoded
  bodies, and returns fixed private/no-store JSON. HTTP and bare-stdio callers
  cannot establish panel input provenance through claimed tags.

## Validation

All DB files ran separately with `SJC_TEST_CLUSTER_TAG=c1prov-<timestamp>` and an
EXIT trap stopping the disposable cluster, also stopping it between files. Real
`session_user` identities exercise the website and three narrow logins. No live
DB, QA state, real model, browser, app server, install, deployment, service action
or subagent was used. No exit 137 occurred.

| File | Pass | Fail / skip |
| --- | ---: | ---: |
| canvas-provenance-db.test.mjs | 4 | 0 / 0 |
| canvas-input-gates-db.test.mjs | 25 | 0 / 0 |
| agent-profile.test.mjs | 13 | 0 / 0 |
| canvas-commands-db.test.mjs | 21 | 0 / 0 |
| canvas-mcp.test.mjs | 40 | 0 / 0 |
| db-roles-manifest-db.test.mjs | 6 | 0 / 0 |
| db-roles-paths-db.test.mjs | 3 | 0 / 0 |
| browser-run-profile.test.mjs | 14 | 0 / 0 |
| ask-private-query-scan.test.mjs | 8 | 0 / 0 |

The new files include over 20 fresh counterexamples, actual stdio MCP tool calls,
real secret-route/wrapper integration, a successful staff Canvas version with
complete empty-area provenance, pending input blocking, fixed and free-text
question paths, real thread-lock contention, rollback/pending preservation,
legacy/resume/operator/steer/upload history, real narrow-role denials, fake CLI
runs through BOTH real runner constructions, and exact hashes/policy admission.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0.
`git diff --check`: passed.
`node scripts/db-roles-sql.mjs ask_context_provenance ask_context_inputs` produced
one newline (no grants). The matching note is pasted into 0107 and both tables
are explicitly website-only in the role manifest.

`node scripts/db-roles-scan.mjs --diff`: exit 0. The static trace follows the new
shared module into website-only provenance and existing Canvas/journal helpers;
those intentionally withheld writes are not a reason to widen narrow grants.
Other existing differences are owner-only settings, authority/user/revocation
writes, credentials and private retention. Actual role-path/manifest tests pass.
The private-query census includes both 0107 tables and reviewed source/query
hashes; final inventory: 505 audit entries, 986 SQL fragments, 219 files, zero violations.

## Remaining release limits

- No deployment/migration of live or QA databases, browser/visual acceptance,
  merge, PR, release-flag enablement, or real Claude/model run.
- Ordinary arbitrary prompts, page context, steers, uploads and free-text answers
  deliberately remain unknown absent a trusted classification envelope. Only the
  three fixed instruction templates in the trigger/runner attest empty prompt
  sensitivity. Broader instruction/template support needs an explicit trusted
  policy; a keyword heuristic or actor-area inheritance must not be substituted.
- Narrow per-result classifications for broad business tools and binary/PDF/image
  attachment extraction are not implemented. Full-C/unknown or fixed refusal is
  the implemented conservative behavior, respectively.
- CLI runtime/auth behavior with real model sessions, platform-specific managed
  settings and upgraded binaries still require coordinator acceptance. The
  pre-spawn policy rejects known managed customization files for completeness.
- 0108 saved-file/export/render boundaries, 0109 floor integration, and the
  parallel UI/poll/mobile slice are separate work. No Phase 1 release acceptance
  is claimed by this handoff.
