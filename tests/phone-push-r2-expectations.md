# R2 backend adversarial expectations (written before implementation)

1. Portal INSERT blocked, same UUID lease expired and retried, lock released: one post, stable first result.
2. Owner note INSERT blocked with the same overlapping lease reproduction: one note.
3. A stale generation cannot overwrite a terminal action result.
4. Reclaimed pre-mutation generation cannot mutate.
5. Committed decision effects resume once; competing retries do not reapprove.
6. Park $100 email, pull, revise to $900, resubmit, drain old: old cannot approve; new sends once.
7. Old revision cannot decline a resubmitted draft.
8. Old revision cannot pull a resubmitted draft through changes.
9. Content edits without resubmission invalidate the old binding.
10. Delayed old history cannot close the current revision.
11. App-only folded rows stay App-only after settings switch.
12. Failed folded summary is durable and retryable.
13. Successful summary recipients are not retried.
14. Interrupted delegation rolls back constituents with no orphan summary.
15. Summary waits when hourly room is exhausted.
16. Incompatible channel snapshots get separate summaries.
17. Telegram webhook note and ack survive conversation-outbox INSERT failure.
18. Telegram success followed by uncertain delivery never uses fallback transport.
19. Expired session registration receives zero further APNs sends.
20. Expired unregister returns a distinguishable retryable 401.
21. Re-registration renews delivery expiry.
22. Account switch cannot inherit another owner's registration.
23. APNs title-only result and folded summary remain informative.
24. Payment and contract titles name the job, app text excludes transport links.
25. Grant body omits bookkeeping ids, duplicate recipients and grant boilerplate; Telegram stays intact.
26. App expiry uses Central words and app outcomes are status-first.
27. Owner, agent and system authors survive feed/detail shaping.
28. Still-waiting sends carry preview and send category; grant/decision sends use additive categories.
