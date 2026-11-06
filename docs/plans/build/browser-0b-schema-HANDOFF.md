# Browser Phase 0b database/vault slice

Expectations recorded before implementation/test execution:

- Agent, worker and readonly actual session logins cannot read any Browser ciphertext or metadata, forge task identity/areas, share logins, approve or consume actions, clear private file provenance, or execute guarded functions (including via forged GUCs).
- The website login acting for staff cannot approve a company step, even a zero-dollar payment or a row claiming needs_owner=false. Only a live owner sid matching the approver can approve; broad Express/wildcard grants cannot cover it.
- Review content and original task/run/person cannot change after insertion. Terminal/consumed actions cannot reopen; one execution record/action and one owner grant/action. Revoking the review sid stales undispatched approval without erasing consumed history.
- Named staff login access never exposes passwords; revision/share/account revocation invalidates saved profiles and dependent contexts.
- Every envelope fails for wrong purpose, artifact, owner/person, origin, revision, nonce/tag, wrap revision/key. No key or durable counter means failure; rewrap preserves ciphertext and data AAD and requires a CAS at persistence.
- Handoff pointers cannot cross handoffs; effects cannot be relabelled/replayed across attempts. File/task/artifact/project provenance is immutable.
- Audit is append only, contiguous and head-CAS bound. Independent signed checkpoint metadata must be retained; SQL alone does not prove a sink acknowledgment/signature authentic.
- Additive 0100–0104 upgrade works without Canvas/0105. Nothing enables flags, provisions services, or touches production.

## Implemented

Worktree `/home/joe/.t3/worktrees/sjcos-app/t3-452e4341`, branch
`t3/browser-0b-schema`, based on `7987df57023b6ee9e2fd3fd6251fbe35686dcafb`.
The branch already existed at the required HEAD when this implementation began.
`node_modules` is a symlink to `/home/joe/sjcos-app/node_modules`; no package
manager installation or dependency mutation ran.

- **0101_browser_vault_handoffs.sql:** saved logins, named staff grants (owner sid
  required), per-person/site-chain encrypted profiles, durable wrapping counters,
  handoffs/attempts/fixed outcomes. Composite deferred attempt pointers preserve
  handoff identity. Profile and dependent-context revocation fence runs/viewers,
  close the context and queue profile purge. Safe website metadata projection
  returns id/label/origin/revision only. Missing/expired/exhausted wrap counters
  refuse reservations. Login/profile ciphertext can be purged without deleting
  retained identity. No keys, raw passwords, usernames or cookies in SQL columns.
- **0102_browser_actions_audit.sql:** actions, encrypted review/quarantine artifact
  metadata, immutable human review records, one execution/action, cross-attempt
  logical effects and human-only reconciliations, notification delivery ledger,
  transactional content-free audit outbox. Original task/run/person/snapshot and
  approval/token/grant bindings are immutable. Staff cannot review a company
  step; kind/category checks cannot downgrade pay/sign/submit/upload/save_page.
  A company approval requires a fresh active owner sid, exact review, exact
  action/run/snapshot/revision/amount/currency/payee grant, one use, and bounded
  expiry. Wildcard/general/unbound grants fail. Consuming requires chained
  approval/consume records, a matching command and one grant use; executing and
  unknown actions cannot reopen. Session, context, user-access and grant changes
  stale undispatched cards. Audit appends use contiguous expected head + digest
  CAS; checkpoints retain installation/boot, service signature and independent
  sink signature metadata. SQL does not hold signing/HMAC keys or authenticate
  a purported external acknowledgment by itself.
- **0103_browser_file_provenance.sql:** immutable project/task/artifact/download/
  reserved-file save ledger, sanitizer provenance and publish/tombstone metadata;
  files private/source/envelope/hash columns. Private file RLS is RESTRICTIVE and
  composes with Canvas's partition. Narrow callers cannot read/clear private
  files. Ordinary narrow file writes continue working. A ready ledger requires
  matching source, hash, project, validated artifact and publish evidence.
- **0104_browser_rollout_catalog.sql:** generic permit runbook version and exact
  13-name browser wrapper catalog; no city-specific records or actual tool
  registration. All six flag defaults are false, existing settings are preserved.
  New retained Browser relations reject TRUNCATE. All new tables have no narrow
  table grants; migration comments record the generator's empty output.

`db/schema.sql` includes the same replay-safe SQL as the four migrations. Fresh
snapshot + full ledger, real 0100–0104 without Canvas, and adding lower reserved
Browser migrations to an existing 0100+0105–0109 Canvas installation all pass.
The additive schema does not require conversation ownership DDL from 0105;
actual handoff admission refuses a destination without proven owner ownership.

Envelope metadata is stored as the normative versioned JSON envelope (base64
ciphertext/nonces/tags/wrapped DEK), rather than redundant parallel bytea fields.
Shape checks plus record-specific binding guards protect storage; the crypto
library performs full strict envelope/AAD authentication. This preserves the
single normative envelope across login/profile/request/image/file artifacts.

## Vault and audit primitives

`lib/browser/vault.mjs` provides strict JCS for the no-float binding domain,
independent AES-256-GCM data and DEK-wrapping encryptions (32-byte random DEK,
12-byte fresh random nonces, 16-byte tags), separate purpose KEKs, authenticated
wrap revision/key ID/data-AAD hash, and rewrap without changing data AAD or
credential/content revision. All eight plan purposes have exact binding shapes.
Keys must be separate across purposes/versions. Generic failures contain only
`BROWSER_VAULT_UNAVAILABLE`, never a provider error, key, buffer or plaintext.

The credential loader accepts only an absolute protected regular file outside
the repository; it rejects symlinks, insecure containing directories, world
readability and group/world writes. Root/service ownership and 0640-or-stricter
file permissions are required. There is no raw-key environment or development
fallback. The trusted future service bootstrap supplies its *verified actual*
DB identity, not a model/request identity: controller can encrypt/decrypt;
reader can decrypt saved_file only. Agent/worker/readonly/website identities
are denied by the factory. These arguments are not themselves authentication;
no network/RPC endpoint exposes this primitive.

`reserveWrap(purpose,key_id)` is mandatory and must **commit before returning**
`{count,activated_at}`. `browser_schema_reserve_wrap` is the private website-side
SQL CAS primitive; a future scoped service adapter must authorize it, without
sharing SQL credentials/keys with the CLI. Do not wrap counter reservation in a
transaction that later rolls back after encryption. Both crypto and SQL refuse
2^24-wrap exhaustion, missing counters and 90-day-old encryption versions.

For rotation install new independent active KEKs, keep old versions decrypt_only,
reserve each new wrap, call rewrap with expected wrap revision, then persist
with **both content revision and old wrap revision CAS**. Tests perform real
Postgres persistence and stale-CAS rejection. A failed CAS/interruption keeps the
old envelope valid; a failed authentication never produces a new envelope. Keep
old keys until live rows and backup retention have expired; no key deletion or
rotation deployment was performed. Restore keeps Browser disabled, requires
independent checkpoint reconciliation and fresh counter/key provisioning before
new encryptions; DB-restored counters alone are not an anti-rollback authority.

`lib/browser/vault-audit.mjs` authenticates the typed content-free chain with
SHA-256/HMAC and verifies service Ed25519 checkpoints plus independently signed
sink acknowledgments against **externally supplied expected highest sequence,
installation ID and trusted keys**. It detects modified/missing middle rows,
tail truncation/old DB restores, wrong keys/installation/acknowledgments, and
requires an acknowledged retained boundary. The SQL writer must explicitly
allocate `head.seq+1` under its CAS protocol; sequence-object gaps after aborted
inserts are never treated as valid audit gaps. No actual independent sink,
exporter, signing credentials or acknowledgment transport is provisioned here.

## Verification

All DB files ran individually with `SJC_TEST_CLUSTER_TAG=b0bschema-<unix-seconds>`
and an EXIT trap running `node scripts/test-db.mjs stop`. Every created cluster
was stopped/removed. No live/QA DB, services, browsers, Next server/build,
package installation or subagent was used. No exit 137 occurred.

| File | Final pass / fail |
|---|---:|
| tests/browser-roles-db.test.mjs | 7 / 0 |
| tests/browser-schema-db.test.mjs | 24 / 0 |
| tests/browser-vault.test.mjs | 69 / 0 |
| tests/browser-vault-audit.test.mjs | 12 / 0 |
| tests/db-roles-manifest-db.test.mjs | 6 / 0 |
| tests/db-roles-paths-db.test.mjs | 3 / 0 |
| tests/ask-private-query-scan.test.mjs | 9 / 0 |

Role tests use actual session_user/current_user as agent/worker/readonly and a
closed test-only sjcos_browser identity. They deny private SELECT/I/U/D/TRUNCATE,
forged owner GUCs, task identity/areas changes, review/consume/share, private-file
tag clearing and direct private-function calls. The staff web identity is a
real staff user + live sid under the trusted website login; it cannot approve
company actions or delegate access. A website fixture successfully consumes a
genuine exact owner review once; **this is not a service-runtime consume API
acceptance claim**. The service identity has no executable command catalog yet.

Failures found and fixed during implementation: a forged-run grant fixture hit
an existing Ask guard before Browser validation (now tests an unbound run);
PL/pgSQL alias/row-type mistakes in shared triggers; and a CHECK constraint's
private function ACL blocking ordinary MCP file saves (validation now occurs
inside the Browser trigger). Tests were rerun individually after fixes.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
`git diff --check`: **exit 0**.
`node scripts/db-roles-sql.mjs <all 17 new tables>`: **exit 0, empty output**,
recorded in each owning migration. Manifest DB parity passes.
`node scripts/db-roles-scan.mjs --diff`: **exit 0**, no new Browser write/read
path in either narrow import graph. Existing unannotated agent differences
remain `ai_conversations UPDATE`, `dev_agent_runs UPDATE`, `run_steers UPDATE`;
these are inherited reachable code and unchanged non-Browser manifest entries,
not newly granted operations. All other printed differences carry existing
withheld-policy notes. No privilege was widened to silence the scan.

Joe explicitly authorized changing **only five file audit entries** in
`tests/fixtures/ask-private-query-allowlist.json`: these four migrations and
`db/schema.sql`. They are classified trusted-background: owner-run schema SQL,
not request-time private readers. Hash/source entries were updated; a comparison
against HEAD verifies every other entry/source is unchanged. **This allowlist
file needs a merge when this branch joins the Canvas branch**; recompute only the
merged schema's audited hash after reviewing the combined SQL. Do not discard
Canvas/runtime audit entries.

## Not done / integration gates

- This is the disabled DATABASE + VAULT slice, **not acceptance of all Browser
  Phase 0b**. No namespace/proxy/Playwright/runtime/CLI implementation or files
  owned by the other builder were touched.
- Dedicated browser/reader role bootstrap/generator/resolver integration and the
  full §9.2 scoped service/web RPC catalog are not implemented here. Only private
  schema guards, safe website metadata and wrap-counter helpers exist. No
  `browser_read_secret`, arbitrary decrypt endpoint, model approval endpoint or
  service direct-table grant was added. Runtime must not expose raw website SQL
  or call crypto using a request-supplied sessionIdentity to bridge this gap.
- Real viewer/attendance/current-rights proofs, gate-held request matching,
  one-use web preparation/decrypt proofs, arm/click dispatch, classification,
  strict public snapshot/field-mapping JSON schemas and service boot/capability
  fencing belong in that scoped integration before enabling any feature. Table
  guards/constraints are additional checks, not a replacement for the catalog.
- No UI, login form, actual vault fill/profile restore, file save/serve/decrypt,
  validator/malware scanner, file reader census, or cleanup/retention dispatcher
  was enabled. Profile purge intent/tombstone fields exist; external unlink and
  scheduled encrypted-payload purge still need the bounded maintenance adapter.
- Owner-grant application/MCP/Telegram decision readers still need the coordinated
  external_browser_* action integration from §7. An approved generic grant alone
  cannot approve/consume these database rows, but no application review flow is
  shipped here.
- Independent sink/exporter provisioning, root-owned key installation, escrow,
  backup exclusions, loss/restore drills and coordinator-owned runtime/packet/RSS
  evidence remain release blockers. Crypto fixture signatures are not proof of
  independently administered durability.
- The preexisting `tests/canvas-rollout-db.test.mjs` case named "combined Browser
  matrix blocked" still expects 0101–0104 to be missing. It is outside this
  slice's ownership and needs a coordinator update to the now-real combined
  success expectation. This slice's real Browser-only and Canvas-first upgrade
  tests cover the newly available migration matrix; no full-suite pass is claimed.
- No deploy or visual verification. Preserve additive data on rollback; leave
  all six flags off and service dispatch unavailable until combined acceptance.
