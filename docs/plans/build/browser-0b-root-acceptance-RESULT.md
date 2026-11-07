# Browser Phase 0b — root acceptance result (2026-11-06/07)

**Outcome:** full root acceptance PASSED at commit `14260c43` (branch `t3/browser-0b-acceptance`),
run `final1`, 2026-11-06 23:52–23:57 ET, by the coordinator as root on GCServer.

| Run | Cases | Result | realRuntime | simulated | releaseReady |
|---|---|---|---|---|---|
| network (containment) | 28 | 28/28 passed | true | false | false |
| rss (parser/memory) | 15 | 15/15 passed | true | false | false |

`releaseReady` stays **false** by design: the plan still requires independent review of the
evidence and a signed root attestation. All browser flags remain OFF; nothing is wired into the
live app, routes, global MCP server or runner; nothing was deployed.

## What ran (real, not simulated)

- Pinned runtime in root-owned `/opt/sjcos-browser`: mitmproxy 12.3.1 (hash-locked venv), Unbound 1.26.2,
  playwright-core 1.64.1 with the reviewed target-barrier patch, **Chromium rev 1248 headless shell**
  (156.0.8078.4), NSS certutil. Provisioned by `deploy/browser/provision-acceptance.sh`
  (account `sjcos-browser`, uid 998 / gid 995, nologin); reversible with `unprovision-acceptance.sh`.
- Per run: fresh disposable namespaces (browser / gate / fixture), nftables default-deny inside the
  namespaces only, fixture DNS (Unbound) + TLS origins signed by a per-run CA, a fresh gate
  (as uid 998) and a fresh controller/launcher per case, `tcpdump` ingress capture, cgroup v2 memory
  files, systemd scopes `MemoryMax=3G MemorySwapMax=0 CPUQuota=150% TasksMax=256`.
- Chromium sandbox stays ON. On Ubuntu 24.04 (`kernel.apparmor_restrict_unprivileged_userns=1`) the
  pinned binaries get a userns-only AppArmor profile (`deploy/browser/apparmor-chrome.sh install|remove`,
  `/etc/apparmor.d/sjcos-browser-chrome`), same shape as Ubuntu's stock chrome profile.

## Evidence (private, not committed)

`~/qa-sjcos/browser-acc/final1/browser-0b-network-final1.json` and `browser-0b-rss-final1.json`
(per-case measurements + pcap/event/receipt hashes; artifact dirs alongside under `/tmp/*.json.d`).
Coordinator loop logs: `~/qa-sjcos/browser-acc/a1 … a29, final1`.

## Defects found by the root runs and fixed (each its own commit)

Product (security/runtime) defects:
1. Gate kept a flow + 56 MiB reservation forever when a candidate aborted while parked
   (repeated-cancellation interrupted cleanup; no transport-level 2 s decision bound) — `f1dff854`.
2. Gate released response slots/reservations after `send()` instead of after TCP acknowledgment — `375726a0`.
3. Authority selected the first matching manifest even when its one-use pair was spent → EEXIST → boot
   revoked on identical concurrent requests — `8af395f5` (one-use unchanged; durable claim still enforced).
4. Barrier `fail()` let a revoke failure (crashed gate) escape as an unhandled rejection — `7ce420da`.
5. Patched `doCreateNewPage` read the page before the barrier approved its attach (race) — `abfdc3df`.
6. Gate listener rebinding hit TIME_WAIT between fresh boots (SO_REUSEADDR) — `e62cd565`.
7. Gate case-name allow-list was lowercase-only — `df427d9c`.
8. Full Chrome `--headless=new` spawns an empty `other` target + two `chrome://omnibox` `browser_ui`
   targets per tab and two component-extension service workers; switched to the headless shell and added
   `--disable-component-extensions-with-background-pages` — `f9e7ef24`, `d20a7b19`. Barrier policy unchanged.
9. Profile dir names overflowed Chromium's 108-byte SingletonSocket path — `23b030f0`.

Harness / measurement fixes (reviewers please scrutinize — each changes what a check accepts):
- Kernel link-local IPv6 NDP/MLD (fe80::/10 → ff02::/16|fe80::/10, ICMPv6 NDP/MLD types only) is counted
  as `linkControlPackets`, not private, in the ingress capture and the bypass probe; any other IPv6 is still
  private; during a bypass probe even fixture HTTPS fails — `60f01eac`, `3a43ff22`.
- Crashed-gate check = "no task running as the gate uid remains" (the runner deliberately charges its own
  root supervision to the measured gate cgroup) — `a3b4a914`.
- Capture budget 250k packets / 40 MiB so RSS transfers are captured completely (early tcpdump exit still
  fails) — `0d8aeec0`.
- Fixture origin sends TLS close_notify for the EOF-delimited `unknown-length` body. The gate's refusal of
  a bare TCP close on EOF-delimited bodies is kept (truncation-ambiguous). **Product note:** real servers that
  skip close_notify on such bodies will be refused — `14260c43`.
- Navigation 8 s deadline (Playwright `nullProgress` ignores goto timeouts); worker case built with
  JSON.stringify (the old literal was a SyntaxError that never created a worker); DNS readiness retry;
  `nsenter --net` (ip netns exec hides `/sys/fs/cgroup`); nft rules via file; controller RPC ENOENT;
  barrier reason codes + first failure reason surfaced to diagnostics; gate control returns fixed Refused codes.

## Test sweep at `14260c43`

Node: every `tests/browser-*.test.mjs` passes individually (one timing flake seen once in
`browser-runtime-startup` under load during a concurrent sweep; 3 immediate reruns 18/18).
Python (`/opt/sjcos-browser/py`): transport 108, parser 44, provision 9, root-runner 5 — all OK. `tsc` exit 0.

## Not done

Independent review + signed root attestation (`signed-root-attestation`, `reviewApprovalSha256`), the scoped
service/web RPC catalog, vault fill/profile restore, the Browser pane UI, the owner-grant flow for external
browser actions, and production wiring. Machine state left provisioned for review (undo:
`sudo bash deploy/browser/unprovision-acceptance.sh && sudo bash deploy/browser/apparmor-chrome.sh remove`).
