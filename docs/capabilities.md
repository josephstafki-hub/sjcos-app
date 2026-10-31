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

## Keeping it current (2026-10-31)

Filled by hand, the ledger went stale: a month after the October 2 deploy it
still read 0 of 37 deployed, enabled or proven. `deployed`, `enabled` and
`proven` are now derived from the live system by
`lib/measure/capability-checks.ts` and written by
`scripts/refresh-capabilities.mjs`. Run it from the live checkout after every
deploy (a dry run first):

    cd ~/sjcos-app && node scripts/refresh-capabilities.mjs           # what would change
    cd ~/sjcos-app && node scripts/refresh-capabilities.mjs --apply   # write it

- **deployed**: the live checkout contains the automation build (PR #44) and a
  production build exists. Version = build id + commit.
- **enabled**: the capability's switch, which is an active policy, a running timer, or a
  configured login/key. Capabilities with no switch read "on whenever deployed".
  A switch that is verifiably off turns `enabled` off.
- **proven**: real cases of the capability's *outcome*, with a count and a sample id.
  Fixture rows (`zz-*`) are excluded. A check that can't run makes no claim, and
  nothing is ever un-proven automatically.

Capabilities with no automatic proof (A07a, A08a/b, A09b, A14, A15, A17–A19, A21,
the measurement and procedure features) stay owner claims on
`/engine/capabilities`, with their own evidence.

