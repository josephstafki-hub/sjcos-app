# Round 1 regression expectations (written before implementation)

No root, browser or server runs by the builder. Fakes must exercise the same root validation functions.

1. Read expiry during consume journal refuses receipt and burns claim.
2. Write expiry during consume journal preserves unknown and refuses receipt.
3. Read expiry during checkpoint refuses receipt.
4. Write expiry during checkpoint refuses receipt.
5. Read expiry during verification refuses receipt.
6. Write expiry during verification refuses receipt.
7. Read/write expiry during final checkpoint journal refuses receipt.
8. Signed expiry caps decision and later connect/TLS admission.
9. Capture with kernel drops refuses even exit zero.
10. Capture with missing statistics refuses.
11. Capture with SIGKILL/nonzero final status refuses.
12. Early packet-budget exit refuses even complete statistics.
13. Truncated PCAP records refuse.
14. Header-only successful framing cannot pass RSS.
15. Zero-byte slow readers cannot pass RSS.
16. A transient two-slot maximum cannot prove a sustained 112MiB window.
17. Earlier retry or invalid unknown outcome survives reduction and fails evidence.
18. Fake measurement, diagnostic, nonzero retention and contradictory aggregates refuse.
19. Missing write digest, duplicate origin, wrong target or absent child barrier refuse.
20. Paused stdout that drains after exit parses only after close, with bounded error cleanup.
21. Policy/guard/gate failure fences synchronously and kills browser even when revoke fails.
22. Abrupt controller loss closes active gate sockets independently of controller callbacks.
23. Loss/detach acceptance has no explicit pre-fault revoke and verifies browser disappearance before cleanup.
24. Malformed IPv6 length, extension chain, ICMP length/checksum/hop-limit cannot be exempted as link control.
25. Valid NDP/MLD needs captured protocol structure and fixture interface/direction provenance; raw unattributable IPv6 is private.

Coordinator must rerun full root network and RSS acceptance; old final1 is historical evidence only.
