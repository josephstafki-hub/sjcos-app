# R1 adversarial expectations (written before implementation)

1. Agent enrollment: INSERT owner device is denied.
2. Worker enrollment: INSERT owner device is denied.
3. Agent reassignment/token replacement is denied.
4. Monitor token SELECT is denied.
5. Staff token collision returns 409 and leaves owner binding intact.
6. Explicit unregister permits a subsequent account transfer.
7. Revoked registering session receives no further push.
8. Deactivated user receives no push.
9. Ack approve injection is refused even with an inherited decision id.
10. Reply changes injection is refused; conversational reply remains allowed.
11. Stale hash refuses approve, changes and hold inside the mutation transaction.
12. Pulled draft cannot approve.
13. Ten identical action requests complete without exhausting the pool.
14. Ten distinct action requests complete without exhausting the pool.
15. Retry after lost response returns the original result.
16. Crash before mutation can resume the same UUID.
17. Crash after mutation returns persisted effect evidence, never repeats a portal post.
18. Crash after provider acceptance needs review, never blindly resends.
19. Telegram success/APNs failure still consumes hourly cap.
20. APNs success/Telegram failure still consumes hourly cap.
21. App-only answer failure is durably queued and sent=false.
22. Phone note → Telegram ack → Telegram follow-up targets the same record.
23. Revised threaded decision, grant and draft have approval actions.
24. Parked then resolved cards drain closed, with no approval buttons.
25. Failed-send reopening restores the current draft card only.
26. Hold shows On hold until …; elapsed hold returns to open.
27. Request changes refresh edits the existing root without a phantom root.
28. Immediate transport blocked while drain runs sends each channel once.
29. APNs sessions reuse; 410 disables one device; failures don't block other devices.
30. GOAWAY/aborted/close/timeout settle, retire the session, and retry only failed devices.

Parity: actual Telegram webhook and phone endpoint on fresh fixtures must yield matching decision/work-item/grant/reply/portal state; only framework/auth and outbound provider boundaries may be faked.
