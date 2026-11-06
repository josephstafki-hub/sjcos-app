# R3 backend expectations (recorded before implementation/probes)

1. Phone approval paused after effects_running claim sends Original $100 only after a second connection edits content to Unauthorized $9900.
2. Same phone boundary, replacing latest draft receipt sends Original $100 only.
3. Same phone boundary, recipient edited to another address still sends only to the approved recipient.
4. Telegram webhook approval paused after the approval commit sends Original $100 only after a content edit.
5. Same Telegram boundary, replacing receipt sends Original $100 only.
6. Same Telegram boundary, recipient edit cannot retarget the send.
7. Web approveWorkItemById paused after approval commit sends Original $100 only after a content edit.
8. Same web boundary, replacing receipt sends Original $100 only.
9. Same web boundary, recipient edit cannot retarget the send.
10. Phone content edit before approval refuses with zero send and approval still requested.
11. Telegram content edit before approval refuses with zero send and approval still requested.
12. Web content edit before approval refuses with zero send and approval still requested.
13. Phone replacement receipt before approval refuses with zero send.
14. Telegram replacement receipt before approval refuses with zero send.
15. Web replacement receipt before approval refuses with zero send.
16. Two phone approvals dispatch one frozen revision once.
17. Sender without an approved snapshot fails closed; it cannot read a staged draft to send it. An existing card without a binding must be reviewed again, including on web Approve.
18. Narrow agent/worker roles cannot insert, alter, or delete approved snapshots.
19. Held-today outcome uses Central time alone and lowercase am/pm, without date/leading zero.
20. Held-other-day outcome uses Central Mon D at h:mm am/pm, without padded numbers.
21. App expiry uses lowercase am/pm; Telegram's existing date text is unchanged.
22. Stale permission nudge app title names the decision; body uses the app card, with Why, no UUID or Reason; Telegram keeps its existing text and actionable buttons.
23. An internal draft alert starts immediately with its body; email To/Subject retain their blank separator.
24. A failed send can reopen/retry the same approved revision, with durable intent deduplication preserved.

25. Frozen snapshot content rejects accidental owner UPDATE; a later edit cannot rewrite approval evidence.
