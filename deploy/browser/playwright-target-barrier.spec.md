# Playwright 1.64.1 SJC target barrier patch specification v1

Static work only; NOT an applied/reviewed executable patch. Core bundle SHA256:
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
