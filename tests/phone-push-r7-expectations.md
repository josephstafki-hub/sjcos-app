# R7 expectations — written before implementation and execution

Joe's Today rule supersedes R6's Engine gate for shared Today, notification and
popup draft cards. Engine still uses Engine; record Ops uses Today. Decisions
still use decision authority; grants, phone alerts and Telegram stay owner-only.

Fresh cases use real DB users, sessions, webhook POST and domain dispatch, with
fake outbound providers. Race cases hold the target row on connection A, start
the webhook on B, observe B blocked by A through pg_blocking_pids, commit the
account change on C, then release A. All locks are released in finally.

1. Bound Telegram draft Approve refuses deactivation committed during its wait:
   requested draft unchanged, no approved snapshot, no email.
2. The same Approve refuses demotion committed during its wait.
3. Bound Telegram draft Reject refuses deactivation during its wait.
4. The same Reject refuses demotion during its wait.
5. Unmapped legacy Telegram Reject refuses deactivation during its wait.
6. The same legacy Reject refuses demotion during its wait (judge's repro).
7. Telegram decision Approve refuses deactivation during its wait: pending
   decision unchanged, no successful resolution event, no awakened intent/send.
8. The same decision Approve refuses demotion during its wait.
9. Telegram decision Hold refuses deactivation during its wait: no held_until,
   expiry extension or held event.
10. The same Hold refuses demotion during its wait.
11. An active-owner authorization row lock conflicts with non-key role/active
    updates until its transaction ends; a different active owner cannot rescue
    the original principal after deactivation.
12. Today-only staff see shared draft cards in list/poll with displayed binding,
    can Approve/Decline through shared actions and both record Ops surfaces,
    and cannot Approve/Reject through Engine. Approval sends the viewed payload
    once, replay sends nothing, stale binding refuses without effects.
13. Engine-only staff can Approve/Reject through Engine, see no shared draft
    card in list/poll, and cannot Approve/Decline through shared actions or Ops.
    Staff with neither area see no shared draft cards and cannot use any path.
14. Both lead/project Ops approval cards without Today show exactly 'Waiting
    on approval.' and no approval buttons; Today-enabled cards retain controls.

Run each test file individually; phone-push DB files twice on the same migrated
per-file DB, plus the requested approval/Telegram/portal/role checks. Use only
the uniquely tagged disposable test cluster and stop it afterwards. No live DB,
services, phone repository, browser, Next server/build or real send is used.
