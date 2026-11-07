# Round 2 expectations (before implementation)

Fresh adversarial cases must reject: (1) retained kernel-drop stderr with a clean summary;
(2) private UDP in a hash-matching PCAP; (3) bypass capture contradiction;
(4) negative case-local pool; (5) negative queue; (6) case-local over-cap memory;
(7) preallocation case without backpressure; (8) controller-loss case without unknown;
(9) clustered hold timestamps; (10) a long sampling gap; (11) frozen upload without actual buffered response overlap;
(12) unrelated iframe replacing the navigated frame; (13) absent child Fetch interception;
(14) invalid detach session plus unrelated revoke; (15) disabled detach cleanup.

Additionally prove successful complete artifact round trips, exact child subresource digest/consume/write,
post-TLS controller-death refusal before any HTTP plaintext, upload cancellation between TLS records,
and False/None settlement cannot acknowledge durable revoke. Root checks must expose fixed, precise
failure messages and accept offline fakes. Coordinator alone reruns network/RSS in the root topology.
