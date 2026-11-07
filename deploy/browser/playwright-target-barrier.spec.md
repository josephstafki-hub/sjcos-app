# Playwright 1.64.1 SJC target barrier patch specification v1

Executable candidate now lives in `playwright-patch/` (implementation notes below).
Not installed, reviewed or accepted. Upstream core bundle SHA256:
`829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d`.
Source: local cached exact package, never mutate live node_modules (1.61.1).
`playwright-resume-census.json` inventories every debugger-resume string and
Target.setAutoAttach/Fetch.enable/Fetch.disable occurrence with line+source hash.
Runtime preflight compares exact bundle and census; unknown additions block.

Apply only in an isolated runtime tree. Playwright remains sole autoattach owner.
No external raw CDP owner, route/auth handler, inspector, extensions, DevTools or
reconnection to existing browser targets. Start empty nondefault contexts only.

Required transformations by exact upstream location:

1. CRSession.detach (36391): never resume while detaching an unguarded target.
   Close target through parent Target.closeTarget first; revoke listener and
   wait close acknowledgment. Detach is not an escape hatch for unknown types.
2. FrameSession._initialize (39015 / 39059): register recursive attachment
   handlers before setAutoAttach; remove resume from concurrent promises2.
   Await lib/browser/target-barrier.guardTarget on SAME Playwright session before
   initialization that can execute page JS and before awaited single resume.
   Install request-stage Fetch and authRequired (CancelAuth), await Fetch.enable.
   Existing navigation-commit wait must follow resume, avoiding deadlock.
3. FrameSession nested worker (39236–39237): reject dedicated/shared/service
   workers at attachment before Runtime.enable/network/init/console handlers.
   Close without resume or detach-to-resume. OOPIF path recursively uses #2.
4. CRServiceWorker constructor resume (39642) AND crash-reload callback (39645):
   deny/close service worker at root dispatch before construction; retain a hard
   error here too. Never resume restored/reloaded/crashed worker.
5. CRBrowser.connect (39776/39783) and _onAttachedToTarget (39846): require
   callback before autoattach; no persistent/default context path, no
   PW_CHROMIUM_ATTACH_TO_OTHER fallback, no DevTools branch. Await guarded root
   attachment for page/popup before CRPage constructs FrameSession; iframe
   attachments guard recursively. Unknown context/type closes with no resume.
6. CRDevTools.install (44326) and Chromium.connectToTransport worker helper
   (44603): forbidden entry points for this runtime; fail before attaching or
   Runtime.enable. They must not retain reachable unguarded resume calls.
7. CRNetworkManager._updateProtocolRequestInterception (37470/37472): patched
   mode refuses route(), httpCredentials, Fetch.disable or replacement handlers;
   only controller-owned guarded session callbacks may continue/fail. No
   implicit disabling when Playwright computes user interception=false.
8. CDP reconnect _connectOverCDPImpl (44526), transport-disconnect/detach, crash,
   popup opener, frame target swap, child reattach and existing startup target:
   fail task/revoke listener; fresh boot/context only after explicit restart.
   No reconnect callback or Inspector.targetReloadedAfterCrash resumes old work.

Patch must import/install callback through private internal options (not model
argv/evaluate). guardTarget is the callback algorithm; target type/context/tab
count/listener generation checked at both entry and resume. Allowed page/iframe
only, at most 2 tabs/context; unknown and workers close. 2s timeout, exception,
Fetch detach or close failure revokes listener BEFORE another request decision.
Every asynchronous continuation rechecks liveness. The gate remains independent
of Fetch and refuses without exact decisions even on existing keepalives.

Before activation: produce actual patch SHA, resulting bundle SHA, reviewer
approval and signed real revision1248 event/packet evidence. Re-run census over
patched tree: every resume must be guarded or unreachable denial. Metadata and
this spec cannot satisfy that runtime gate; pins retain null result digests.

## Implemented candidate (2026-11-06; no acceptance claim)

`playwright-patch/apply.mjs` now verifies the upstream hash AND every original
census row before any transformation. `target-barrier.patch.json` is an ordered
exact-text patch (each operation records its expected match count and replaces
only its first occurrence); `runtime.js` is embedded verbatim into the bundle.
`playwrightPatchSha256` hashes UTF-8 patch JSON + NUL + UTF-8 runtime.js. The
result bundle hash and exhaustive after census are in `playwright-patch/result.json`.
The result is isolated-runtime-only: ordinary Chromium APIs cannot opt around
it. Private `core.sjcBrowser.connect(parent,transport,options)` requires
`options.__sjcBarrier` and a fresh empty nonpersistent boot. Public CDP reconnect,
DevTools, workers and extension relay autoattach fail. No env/argv enables it.

All seven upstream resume calls are removed, not merely hidden behind a toggle.
The only executable resume lives in the separately source-hashed root-installed
`lib/browser/target-barrier.mjs`: prepare (Fetch + recursive handlers + autoattach
ACK), initialization, guarded single resume, then navigation-commit wait. The
original 2s guard deadline remains active across initialization. Both binding
and every asynchronous continuation must still be live. Unknown startup targets,
workers, detach/dispose/crash/reload, duplicate reattach and context loss revoke
the whole boot. A listener cannot be used for two contexts; context slots and
per-context tab slots reserve synchronously before asynchronous callbacks.
Root/page and recursive OOPIF sessions are Playwright's own sessions. Playwright
network Fetch listeners/toggles are removed; route/auth interception refuses.
Controller request callbacks must consult their supplied liveness function on
every continuation; authRequired is always CancelAuth in the patch itself.

The in-process trusted policy supplies `bindTarget`, `validateBinding`,
`registerFetch(session,binding,isLive)`, and boot-wide `revokeListener()`; it must
perform the independent gate/controller/read-manifest verification. The launcher
supplies guardTarget and shuts down Chromium on revocation. The controller
adapter is NOT implemented by this patch. Syntax, string census, AST command
census and executable module/helper tests do not replace real revision1248
packet/event acceptance or independent review. Flags remain OFF.
