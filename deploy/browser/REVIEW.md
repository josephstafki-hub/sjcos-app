# Phase 0 C deployment specifications — NOT installed or runnable acceptance

These texts describe the future root deployment. No namespaces, firewall rules,
processes, credentials, filesystems or services are created by this slice. There
is no installer, executable runtime, activation file, patched Playwright or
mitmdump dispatcher here. Units intentionally require missing attestation and
activation prerequisites and have no Install/WantedBy. Never start these specs.

Before an owner-authorized deploy, root must render `@JOE_UID@`, `@BROWSER_UID@` and `@BROWSER_GID@`, implement the
referenced executables, split account-slices.conf into real parent/child units,
and validate all directives and Chromium's namespace sandbox. Do not disable
Chromium's sandbox to make unit restrictions work. Do not reparent/restart live
services without separate deploy authorization. Shared parent must contain every
Joe workload and both new dedicated UIDs; accounting siblings alone is inadequate.

Persistent filesystem quotas: encrypted quarantine 256 MiB, staging 256 MiB,
profiles 64 MiB, audit spool 64 MiB. Mount the 128/200/56 MiB private tmpfs parts
and 128 MiB shm inside the child cgroup; raw state/downloads never reach backups.
Separate gate UID owns its private CA via LoadCredential; trust only in private
Chromium NSS store. No certificate-error bypass. Gate never reads vault/DB keys.

The independent root supervisor reserves 32 MiB outside the 3 GiB child but inside
the 24 GiB common account. Serialize context reservations + queue offers under
`/run/sjcos-browser-supervisor/admit.lock`. Require MemAvailable >=5 GiB and
account usage <=18 GiB for admission; unavailable metrics deny. At child >2.5 GiB
for 10 s pause/evict idle then close; account/host >=21 GiB closes contexts in 5 s.
Never kill another application. Admission limits: two isolated contexts, one per
person, two pages each/four total; FIFO max eight entries, five-minute expiry,
30-second offer; five-minute idle timeout, 60-second no-context browser shutdown.
Heartbeat/presence and five-second final-action freshness are independent guards.

Supervisor fsyncs/renames a root-0600 persistent latch on OOM, signal 9 or exit137.
Write an uncleared running marker before launch. Missing/corrupt state, lost
metrics or stale marker fail closed across reboot; no restart resets it. Only
Joe/root's incident-bound audited reset clears it. Admission stays off pending
attested supervisor, namespaces, independent audit checkpoint and runtime tests.
Validator (384 MiB/50%, one job) and file reader (128 MiB/15%) are later services
inside the SAME 3 GiB child; neither is implemented by these controller/gate specs.

The gate must have two listeners, one per context/task/boot/generation, no proxy
auth. Close all old inbound/upstream sockets BEFORE reuse. Test context listener
isolation, normal upstream certificate/SNI verification, Host/authority/CONNECT
agreement, 401 no-secret/407 denial, and per-request revocation on keepalive.
No CDP host forward, public route, nginx/tunnel configuration or raw CDP relay.
Every target waits for reviewed Playwright sole-owner Fetch/autoattach barrier;
workers and unknown targets close without resume. Guard failure revokes sockets.

`gate-options.conf` documents preallocation and request-hook ordering; it cannot
enforce them. Pinned addon/parser/dispatcher implementation, option verification,
package/hash security checks and a real isolated packet/RSS/backpressure fixture
are release blockers. Pure counters and mock routes cannot satisfy the gate.
All app flags remain false and `SJC_BROWSER_ENABLED=0` overrides activation.
