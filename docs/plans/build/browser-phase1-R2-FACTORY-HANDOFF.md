# Browser Phase 1 R2 — FACTORY

## Expectations recorded before implementation

1. Actual controller public Pause → service IO → factory → gate drains input,
   loading, observations/reads, frames and listener before ACK, without a
   permanent gate fence. Two pause/resume cycles preserve the context but install
   new authority, listener cookies and guards for each committed new run.
2. Pausing during extraction/read, Fetch authorization, frame publication or
   input authorization cannot publish an old result or send old input/Fetch
   after resume. The pause ACK waits for extraction and pending frames.
3. Capture cannot start while paused or finish starting after the pause ACK.
   Resume still requires fresh authorization before and after gate rebind.
4. Stop and private drains retain permanent gate fencing; a new run/listener
   cannot resume a permanently fenced gate.
5. Fake S3: repeated unchanged seq + digest + exact original signed evidence
   returns the same verified ACK/version, including after exporter restart and
   fresh replay envelopes. No second object or highest-head PUT is made.
6. Same-seq different digest, signed time or boot remains CONFLICT; invalid
   signatures refuse before sink access. No stored original/highest bytes are
   changed. Rollback still refuses.

Only factory/exporter paths are owned here. SERVER owns durable checkpoint-head
recovery and real SQL continuation/capability tests. Factory integration uses
actual controller/service/factory/gate code with fake committed task and CDP/root
IO; it does not claim real DB, browser, installed runtime or WORM acceptance.

## Item → change → test

- **ENG 3:** public `stopInputAndCapture` now delegates to the resumable
  `pausePublic` drain, which synchronously fences model output/commands, aborts
  observation/read controllers and clears handles. Loading, extraction, pending
  frames and the old root listener drain before ACK. Private input retains
  `fence`; terminal Stop still destroys the context and permanently fences its
  gate. Failed public drains fail closed with a permanent fence.
- Capture startup is now tracked and epoch-checked across page/session/CDP
  awaits. Pause refuses new capture, waits for an in-flight start, then stops
  its session and removes the frame listener before ACK. This closes a second
  late-capture race discovered while writing the quiescence regression.
- Resume keeps the existing mandatory pre/post `reauthorize` checks: same
  task/kernel/context, public active task, new immutable run, greater listener
  generation/control epoch. Actual controller → service IO → factory → gate
  regressions cover two full Pause/Continue cycles, renewed cookies/guards/read
  authority, old output-ticket refusal, in-flight read/extraction/frame/input/
  Fetch cancellation, usable fresh input/Fetch after resume, delayed capture
  startup, and permanent private/terminal fencing.
- **ENG 4, exporter:** exact original signed-record equality already had the
  correct idempotent behavior and remains strict. Added explicit quiet-head,
  restart, lost-highest-ACK and conflicting signed-time/boot/digest regressions.
  A conflicting digest at the highest sequence now reports **CONFLICT** instead
  of ROLLBACK. An exact replay ACKs the original Object Lock version without
  another object/highest PUT; rollback still refuses.
- The cross-language test now retains fake S3 objects across exporter process
  restarts. Actual JS checkpoint client/outbox → Python exporter → pinned JS
  ACK verification covers a >120s outage, SQL ACK loss (original pending spool
  survives), idempotent replay with zero extra PUTs, committed signed identity,
  repeated quiet minute ticks/explicit checkpoint/shutdown, controller restart
  with a different boot id, and subsequent new-head advancement. This also
  exercises the concurrent SERVER `.committed.json` contract; only hash-named
  spool records count as pending, while the committed identity remains durable.

The expectations above were written before implementation. Initial targeted
runs reproduced `BROWSER_GATE_AUTHORITY_REFUSED` on public control Pause and
the digest conflict's incorrect ROLLBACK result. Exact-evidence idempotence
passed before the change; it was not fixed by weakening the exporter.

## Verification (single files, sequential)

| File | Pass | Fail |
|---|---:|---:|
| tests/browser-production-factory.test.mjs | 62 | 0 |
| tests/browser-installer.test.mjs | 11 | 0 |
| tests/browser-launcher.test.mjs | 16 | 0 |
| tests/browser-playwright-patch.test.mjs | 35 | 0 |
| tests/browser-runtime-boundaries.test.mjs | 18 | 1 |
| tests/browser-root-runner.test.mjs | 17 | 0 |
| tests/browser-root-broker.test.mjs | 8 | 0 |
| tests/browser-checkpoint-exporter.test.mjs | 29 | 0 |
| deploy/browser/checkpoint_exporter_tests.py (direct scenarios) | 28 | 0 |

Node totals: **196 passed, 1 failed, 0 skipped/cancelled**. Python scenarios
also ran directly, individually and sequentially: **28 passed**. Runtime test
16 is the exact source-inventory mismatch after these and concurrent runtime
source changes; it is not waived. Per instruction, no inventory refresh ran.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 2** on
concurrent, outside-owned sources:

- `components/panel/browser/session.ts:25`: TS2339 `source` on `never` (two).
- `lib/browser/web.ts:117`: TS2339 `site_label` missing on unavailable projection.

`git diff --check`: exit 0. No exit137/Killed. No browsers, servers, Next
commands, sudo/systemctl, real network/S3, DB, installer production apply,
dependency installation or writes to installed/live paths. No subagents/push.

## Every root-hashed file changed by this slice

| File | SHA-256 |
|---|---|
| lib/browser/production-browser.mjs | be8f7efb4d6714e2678cc0ed6429dbad62920cceecea50458d231a892d7e0afd |
| deploy/browser/checkpoint-exporter.py | cad78a554f80e6f913f7a65d6c362279a372f54a4eb58934ecbd77d2109d2773 |
| deploy/browser/checkpoint_exporter_tests.py | 517841af518faf22f886e01a8f77e5afe1663bf1104916efe13b08b6fbda4d4d |

Coordinator: refresh both combined root inventories after all builders settle,
review/update the private-source audit digest for production-browser.mjs, rerun
runtime boundaries and the locked TypeScript check after UI/SERVER corrections,
and re-attest candidate bytes. This slice changes no gate wire, units, bootstrap,
Playwright patch/pins, source inventories, SQL, API, UI or SERVER implementation.
Real SQL/capability and browser/private/device/independent WORM acceptance remain
the appropriate SERVER/coordinator gates.

Implementation is the commit containing this handoff (`git log -1 --format=%H
-- docs/plans/build/browser-phase1-R2-FACTORY-HANDOFF.md`), on t3/browser-phase1.
Explicit owned paths only; no push.
