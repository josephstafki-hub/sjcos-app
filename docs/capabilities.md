# Capability status (A18)

`/engine/capabilities` shows four **independent** claims per task (A00–A24)
and per key feature, each needing a dated version and evidence:

| state | means | evidence |
|---|---|---|
| implemented | the code is on a branch with tests | commit, test run |
| deployed | running on the live service | deploy date, build id |
| enabled | switched on for a stated scope | policy/setting + scope |
| proven | observed doing the job on real cases | case ids / dates |

None implies another. Deployed-but-disabled is normal. "Proven" is scoped to
the evidence's own statement, nothing wider.

Rows are seeded by `db/migrations/0018_measurement.sql` (`capability_status`)
and kept in sync with `lib/measure/capabilities.ts CAPABILITIES` by
`ensureCapabilities()`. Only the owner flips a state (`updateCapability`
server action → `setCapabilityState`, which refuses `true` without evidence).

The build ledger in `docs/automation-reliability/STATUS.md` and the per-task
notes in `docs/automation-reliability/status/*.md` are the written record;
this table is the operational one. After a deploy, mark *deployed* with the
build id; after enabling a policy, *enabled* with its key and scope; after
the first real cases, *proven* with their ids.
