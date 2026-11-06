> Historical R5 expectations. Joe's 2026-11-05 decision supersedes the web
> owner-only rules below; current acceptance is in phone-push-r6-expectations.md.

# R5 expectations (recorded before implementation and execution)

All authorization probes use signed session cookies, real session verification,
real DAL/database users, real claims and fake outbound providers. Only Next's
request/cache/navigation adapters are replaced for the CLI harness.

1. Engine Approve: area-enabled staff refused with `Only Joe can approve sends.`;
   revoked owner refused; active owner sends the displayed email once.
2. Engine Reject: staff/revoked owner refused; active owner rejects without email.
3. Project Ops Approve: same authorization matrix as Engine Approve.
4. Project Ops Reject: same matrix as Engine Reject.
5. Lead Ops Approve: same authorization matrix as Engine Approve.
6. Lead Ops Reject: same matrix as Engine Reject.
7. Today/notifications/popup work-item Approve: same matrix as Engine Approve.
8. Today/notifications/popup work-item Decline: same matrix as Engine Reject.
9. Direct decision Approve: staff/revoked owner refused; owner resolves once.
10. Direct decision Reject and Request changes: staff/revoked owner refused;
    owner resolves each outcome once.
11. Popup decision Approve: staff/revoked owner refused; owner resolves once.
12. Popup decision Decline: staff/revoked owner refused; owner resolves once.
13. An owner JWT whose database user was demoted to staff cannot approve via
    Engine, Ops, popup or decision actions. The database role wins.
14. Staff notification polling offers no approval cards; owner polling includes
    the displayed revision. Revoked owner polling returns no data.
15. Owner stale bindings on Engine, Ops and popup all refuse with the exact new
    copy, no frozen snapshot, no state change and no outbound send.

Every unauthorized attempt above must leave the approval row, immutable
snapshots, receipts, decision events, intents and outbound email untouched.

Cleanup acceptance: run every portal-* and phone-push-* test file twice, one at
a time, on the same migrated per-file database (no fresh database between runs).
Portal alerts explicitly enable the app channel, retain app-message assertions,
delete scoped dependent app messages before outbox rows and leave zero cap or
portal fixtures. Cleanup errors must fail the test. Also run all requested
approval, Telegram and database-role regressions and the manifest diff scan.
