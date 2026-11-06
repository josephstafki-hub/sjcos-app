# R10 expectations (written before implementation and execution)

Use the real approval/Telegram transactions and isolated PostgreSQL; fake only outbound transports. Run files sequentially, and run phone-push DB files twice on the same per-file database.

1. Telegram crash immediately after its callback transaction commits: approval, frozen draft and pending dispatch are all durable; identical redelivery is harmless; sweep emails the frozen body exactly once.
2. Callable web approval crash immediately after actual COMMIT: the same atomic evidence survives; retap refuses reapproval; sweep completes once.
3. Portal approval interrupted after COMMIT: sweep posts the frozen body once and marks dispatch done; repeat sweep posts nothing.
4. Crash after the provider accepted, before dispatch completion: expire the lease and sweep; no second email; durable done or needs_review evidence and a visible work-item warning if uncertain.
5. Crash after provider acceptance but before saving provider outcome: expired send and approval claims are held for review/reconciliation, never resent.
6. Two concurrent sweeps competing for one pending snapshot: only one dispatch and one email.
7. Stall the winning sweep at the email provider: another sweep and independent Profile/work-item writes complete; approval is already committed.
8. Force pre-COMMIT failure after snapshot/checkpoint insertion: neither approval nor snapshot/checkpoint survives and no transport runs; retry works.
9. Edit draft knowledge/recipient after approval COMMIT: recovered dispatch uses only frozen approved inputs.
10. Interrupted non-email approval: sweep records completion without inventing a send, retaining the no-email notice.
11. Worker role can sweep an already-approved draft; agent/worker still cannot insert or change frozen approval evidence or create pending approved work.
12. Missing decision (well-formed random UUID): real webhook commits NULL audit FK and done source event, emits the missing-target toast after COMMIT; replay adds no domain effect.
13. Deleted decision card: real webhook commits NULL audit FK and emits the refusal; replay is harmless.
14. Missing decision with no active owner, and owner deactivated while waiting for target lock: NULL audit FK commits and the inactive-owner refusal is delivered after COMMIT.
15. Phone interrupted approval retains its existing terminal needs_review recovery, matching-area staff web authorization remains unchanged, and existing Telegram reply text/order remains covered by R9 regressions.
