# R8 expectations — written before implementation and execution

Use real bearer authentication, account reads, transactions and phone endpoint;
only outbound providers are fake. Hold the target lock on connection A, start
an action on B, prove B waits using pg_blocking_pids, commit the account change
on C with a two-second lock timeout, release A, then inspect result and evidence.
A different active owner must never substitute for the authenticated owner.

1. Approve after deactivation refuses decision, bridged grant and email draft.
2. Approve after demotion refuses those same three targets.
3. Decline after deactivation refuses a draft; decisions still disallow Decline.
4. Decline after demotion refuses a draft; decisions still disallow Decline.
5. Changes after deactivation refuses decision, grant and draft, without a note,
   trigger, resolution event, pulled draft, grant change or send.
6. Changes after demotion refuses those same three targets and effects.
7. Hold after deactivation refuses decision and grant, preserving expiry, hold
   fields and held events.
8. Hold after demotion refuses those same two targets and effects.
9. Reply after deactivation refuses decision/grant/draft cards, inherited
   conversational acknowledgments, and portal threads (including acknowledgments).
10. Reply after demotion refuses those same targets and effects.

All refusals say 'No active owner account. Nothing was changed.', have an
unauthorized outcome, and preserve domain rows, snapshots, receipts, successful
events, intents, notes, triggers, portal messages/activity and outbound effects.
The action UUID may durably record the refusal; it must not checkpoint effects.
After restoring the owner, retrying that UUID returns its original refusal.
A new UUID for the same verb succeeds and performs its intended mutation once.

Lock order: action claim when present, target (decision/work item; transaction
advisory lock for a portal channel), then the same owner's FOR SHARE row lock.
Reply-only child alerts must lock the inherited domain target as well. Portal
channels have no universal row (DM/project/lead); use a channel advisory lock,
shared by Telegram and phone. Never acquire an owner lock before a target wait.

Run this file before the fix to demonstrate the failures, then after the fix.
Run each requested test file separately; phone-push DB files twice on the same
per-file DB, no schema reset between repeats. Use only a uniquely tagged test
cluster, stop it afterwards. No live database, real sends, browser or app server.

Additional expectations, written before adding and executing these tests:

11. Pause the actual phone approval after its real owner FOR SHARE succeeds:
    a concurrent active/role update must block until approval commits. The
    already-authorized approval succeeds once, then the account update completes.
12. Phone and Telegram approvals waiting on the same decision or draft settle
    without deadlock, in either arrival order, with one resolution/snapshot/send.
