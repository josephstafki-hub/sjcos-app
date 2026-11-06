# Phone alerts R9 expectations (written before implementation/tests)

Use the real secret-authenticated Telegram webhook, SQL transactions and owner
authorization, replacing only outbound transports. A promise gate, not a sleep,
pauses each selected Telegram call. While it is paused, an independent connection
with `lock_timeout='1500ms'` must finish the Profile name/initials update and lock
the target. Domain state and durable update/source-event evidence must already
be visible to that connection. Release every gate even on assertion failure.

1. Hold, stalled `editMessageText`: held_until and the hold event are committed;
   Profile and target updates succeed before release. Same-update replay is
   harmless while the original edit remains pending. Preserve the exact toast
   and card text, including `(held 4h)`.
2. Hold, stalled `answerCallbackQuery`: the same committed state/lock freedom
   holds even before the card edit starts.
3. First decision Approve, stalled toast and then card edit: approved event and
   update/source-event outcomes are committed; Profile/target writes succeed;
   replay creates no second approval or effects. Keep `Approved ✓` text.
4. Already-approved decision, new-update Approve: its replay toast and card edit
   run after commit, cannot retain account/target locks, and cannot re-approve.
5. Draft Reject: rejected state is committed before either toast or card edit;
   Profile/target writes succeed; duplicate delivery never changes it or sends.
6. Draft Approve: immutable displayed email snapshot and approval commit, and
   exactly one fake email send, precede the stalled toast/card edit. Profile and
   target writes succeed; duplicate delivery never sends a second email.
7. Request changes: both the exact toast and sendMessage prompt are post-commit;
   decision stays pending until an actual text reply; Profile/target writes
   succeed during either stall. A duplicate cannot issue a second prompt.
8. A text Request changes reply pulls the decision and commits its owner note,
   agent handoff and update evidence before the sendMessage acknowledgment;
   Profile/target writes succeed while that acknowledgment stalls. Duplicate
   updates add no notes, handoffs or acknowledgments.
9. Refused/stale callbacks (stale hash, inactive owner, resolved Changes/Hold)
   commit refusal and replay evidence before their stalled toasts; preserve
   exact visible text and domain state, and release Profile/target locks.
10. Force a transaction failure after Hold mutates but before update evidence
    finishes: domain mutation, source event and dedupe row all roll back, and
    no toast/card edit/prompt is sent. Retrying that update succeeds once.

All callback transports must be absent from the transactional handler's deps;
it returns ordered reply instructions. Keep target → same active owner FOR SHARE
checks, durable dedupe, persisted-before-acting behavior, and post-commit sends.
Use INACTIVE_OWNER for the optional inconsistent message-help literal too.
