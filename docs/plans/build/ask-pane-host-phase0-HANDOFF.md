# Ask pane host — Phase 0 UI handoff

2026-11-05. Branch `t3/in-app-browser-agent-tools`. Starting HEAD was `6d4494823daaf4e74d69be2103e8b809b11c03d8`; concurrent plan/review commits are outside this implementation. Only the explicitly owned panel files, new shared test fixtures/test and this handoff are staged.

## Build round 1 panel fixes — 2026-11-05

This section supersedes the earlier validation and release assumptions below. UI starting HEAD: `803a5f6b`. Server/DB/actions are a concurrent builder's work and are not staged in this UI commit. No dependencies were installed: `node_modules` remains the live dependency symlink and was read only.

### Findings → implementation

- Design 1: Chat's tabpanel is a stretching single-cell grid, including a bounded row. The actual `PanelDock` SSR fixture checks 880/900/1100/1280 and the shared H5 width rows, including 840 → 348/12/480 and 1000 → 420/12/568. This catches the former flex child width collapse.
- Design 2–3: two-tab Queue/Chat uses the existing Segmented pill's label font, spacing, 44 px buttons, transition and hover, aligned left. Only three-plus tabs share the horizontal row. Tab semantics/keyboard support remain. The additional popout Threads control exists only with an open pane; normal Chat uses its existing header control.
- Design 4 / engineering 1 UI: `askStatusCopy.ts` owns all five exact fixed-code messages. Rail/list/archive/folder actions, load/new/send/voice, upload, poll/control and run-review paths handle returned codes and legacy throws. Unknown rejected Ask actions fail safely to the paused state without showing a raw cause. Failures clear transcripts, titles, folder context, logs, run cards, queued turns, side-pane claims and attachments; stale responses cannot restore them. A failed admission restores the typed draft exactly once even if the rail fails first. Accepted turns are not restored as unsent drafts after a poll failure. Paused/session/access states disable Send and show Try again or Sign in. THREAD_UNAVAILABLE leaves a fresh New chat; the next typed send can create it, or New chat dismisses that thread-specific notice.
- Design 6 / engineering 3 UI: Delete defaults off until a list capability explicitly enables it. Both thread-menu and archived Delete use the not-ready explanation, and the confirm has the exact 30-day wording. One `crypto.randomUUID()` is generated per confirmed attempt; retries reuse it. The target title disappears immediately; pending/error status and retry controls contain no title. Pending attempts are also masked from subsequent list loads. Clearing the current chat keeps History open so a lost response can be retried.
- Design 7: empty lists read “No chats yet. Only your own chats show here.” Decision 11 / A1.2 means Abigail retains the two legacy chats backed by creator evidence; the obsolete “Abigail starts empty” release instruction must not be used.
- Design 8 / engineering 2: displayed route grounding uses `usePanelPageRoute`, a subscribed `useSyncExternalStore` hook with a stable null server/hydration snapshot. Page effects, bus messages and storage events notify it after hydration. Route chips and starters share that snapshot; send-time context remains a separate getter. No hydration suppression, render-time viewport workaround or initial preference read was added.
- Engineering 5 UI: new `tests/ask-panel-ssr.test.mjs` imports the same host fixture. Actual React `renderToString` compares server markup with storage-present hydration-snapshot markup, including route/thread/model/layout settings. Controlled hook lifecycles exercise real component event/effect code, failure/retry, deletion UUID reuse, ResizeObserver content-box measurements, rendered pane allocation, the single selector and landscape header/grabber suppression in the actual PanelHost. These are DOM-free integrations, not a claim of browser mounting, actual `hydrateRoot`, CSS dimensions, Safari focus or device behavior. The Browser-specific second consumer remains Phase 0b per A1.3.

### Validation for this revision

Expectations preceded the relevant fixes. Initial regression run: 1 pass / 6 failures, including storage-dependent markup, duplicate Threads and the flex wrapper. Additional expectations caught the missing full empty-state sentence and a draft lost when the rail failed during admission; both were fixed. A fixture expectation initially assumed a utility class where AskContentPane uses inline grid styles; it now asserts the actual style contract.

Final single-file invocations (each separately; no DB):

| File | Passed / failed / skipped |
|---|---|
| `tests/ask-panel-ssr.test.mjs` | 42 / 0 / 0 |
| `tests/panel-content-pane.test.mjs` | 37 / 0 / 0 |
| `tests/panel-defects.test.mjs` | 6 / 0 / 0 |
| `tests/panel-run-review.test.mjs` | 1 / 0 / 0 |
| `tests/panel-context.test.mjs` | 1 / 0 / 0 |
| `tests/panel-approval.test.mjs` | 1 / 0 / 0 |

Locked typecheck: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` → **exit 0**. Earlier intermediate checks caught syntax and newly arriving server envelope changes; all owned errors were resolved. `git diff --check` → **exit 0**. No npm operation, DB, service operation, deploy, server, build, browser or subagent was used.

### Server contract and release coordination

The concurrent server implementation now returns typed failure envelopes and success envelopes (`conversation`, `id`, `rail`, `threads`, `jobs`, `grants`, `review`) at the boundaries this UI consumes. The UI also accepts the old successful raw shapes where applicable and maps known legacy thrown codes/copy; no currently called Ask boundary needs an intentional thrown-error-only fallback. Missing legacy list capabilities conservatively disable Delete. Deletion uses the actual two-argument action and `AskDeleteResult`. Search resilience and server-side privacy, admission, recovery and retry authorization evidence belong to the server handoff; this UI does not certify them.

What Joe/coordinator must do before rollout:

1. Follow decision 10 / A1.1: never-enabled deletion with no deletion evidence permits ordinary chats while Delete stays off. Capture this working configuration deliberately; missing authority alone is no longer supposed to pause that configuration. After deletion has ever been enabled/accepted, the full recovery gate applies and remains latched.
2. Before enabling deletion or releasing a previously latched installation, install and verify the independent journal authority environment configuration **and its binding file**, using the server handoff's exact identity, durability and recovery acceptance steps. Verify fresh high-water, journal directory and recovery health. Without those prerequisites in gated mode, the paused message is indefinite; do not describe it as a UI retry that can fix missing infrastructure. Leave `SJC_ASK_THREAD_DELETE_ACCEPTED` off until server acceptance is complete.
3. Tell Abigail before deploy that old chats with consistent creator evidence stay with their creator (including the two legacy chats); the remaining unassigned old chats stay with Joe, ambiguous ones remain quarantined, and new chats are private to the account that starts them. No pronoun-based ownership inference.
4. Use an isolated QA authority for the healthy/deletion-enabled capture and deliberately close the gate for separate paused captures. Seed distinct owner/staff chat titles, test foreign links/search as both, and inspect network/logs for leaked titles and unhandled errors. Do not reuse this UI test fixture as authority/privacy acceptance.

Next visual round (coordinator only): compare ordinary two-tab pill/hover against base at 360/390, tablet 820, landscape 800×360, 420 dock and 1100/1280 popout; check chat width with the rail at 880/900/1100/1280, one visible Threads control in narrow Chat, and four registered labels at 360. Check zero #418/hydration/page errors at every width with populated storage. Capture each fixed-code state, retained draft and disabled Send, sign-in link, private-content clearance, unavailable-thread fresh chat, and recovery. Verify disabled Delete explanation, exact confirm, title-free pending/error/retry after a deliberately lost response. Mount authorized test panes: verify actual 839/840/1000 allocation, one landscape selector/Close with suppressed horizontal header/grabber, stage ≥200, portrait ≥420, rotation/draft/focus/history preservation and real iframe/Safari behavior using the existing capture list below. No new screenshots were produced here.

## Purpose and boundaries

One persistent `PanelDock` owns selection across desktop, drawer/full-screen sheet and orientation changes. `AskContentPane` owns trusted side-content chrome. Features register render slots rather than adding a rail, modal host or another layout reducer. Nothing registers Canvas or Browser in this slice, so neither is advertised. Queue/Chat retain the ordinary 560/880 column thresholds and the default 420 dock. Narrow popout Threads moves to the History icon, as H2 requires; the view selector now has tab semantics.

I chose a **new `AskPaneSplitter.tsx`**, leaving the ordinary `Splitter.tsx` unchanged. Measured content excludes outer padding and includes the 12 px internal divider: 840 → 348/12/480, 1000 → 420/12/568, 1100 popout minus 16 padding → 455.28/12/616.72. Pane compactness is independent of input capability. Splitter Left/Right moves 16 (Shift 64); Home/End uses dynamic bounds; Enter/double-click resets. Popout/sheet commits use `sjcos:ask-pane-layout:v1:<userId>:<deviceId>` and contain only a number. Dock expansion keeps a transient width/reset captured from the dock and never commits to either dock width or pane-width storage.

Explicit desktop selection replaces the app area, leaving its route/component tree mounted. The expanded host has one Back to app exit; narrow sheet/popout has ‹ Chat; split popout has the labelled pane ×. Sheet Close Operator remains separate and working. Phone content forces full height, hides the chevron, and returns to the prior drawer/full-height choice. Short landscape removes horizontal Operator chrome, using one ≥64 px text-sized strip with Close + vertical 48 px tabs, and a feature-owned 128 px action column. Feature title/meta rows are 48/20; normal action row is 56. Shared stage budget is 452 px at 360×800, 496 at 390×844 and 204 at 800×360 with 80 safe-area pixels. Actual device measurements remain unverified.

## Registration contract (exact exported types)

Types live in `askPaneLayout.ts` and `askPaneRegistry.ts`; the registry re-exports PaneRef/PaneSnapshot/PaneMode. `render` is a pure slot factory: return React elements for feature components; do not call hooks directly in the factory. Mount registrations in a client effect and return its unregister cleanup.

```ts
export type PaneRef = { kind: 'canvas' | 'browser' | 'workbench'; id: string };
export type PaneMode = 'sheet' | 'dock' | 'popout';
export type PaneSnapshot = {
  thread_id: string; run_id: string | null; user_id: string;
  label: string; attention: 'none' | 'new' | 'needs_you'; revision: string;
} & (
  | { kind: 'canvas'; id: string; selected_version: number; latest_version: number; followLatest?: boolean }
  | { kind: 'browser'; id: string; task_id: string; status: string; takeover: boolean }
  | { kind: 'workbench'; id: string; subject_id: string }
);
export type AskPaneScope = { userId: string; threadId: string; claimToken: string };
export type AskPaneRenderContext = {
  snapshot: PaneSnapshot; mode: PaneMode; compact: boolean; landscape: boolean;
  paneWidth: number; viewportWidth: number; split: boolean; signal: AbortSignal;
  /** Call ONLY after authenticating a trusted MessagePort boundary message. */
  frameBoundary:(frame:HTMLIFrameElement,direction:'forward'|'backward'|'escape')=>void;
};
export type AskPaneSlots = { title?: ReactNode; meta?: ReactNode; content: ReactNode; actions?: ReactNode };
export type AskPaneLeaveReason='switch'|'exit'|'operator'|'navigation'|'back';
export type AskPaneLeaveGuard=(snapshot:PaneSnapshot,reason:AskPaneLeaveReason)=>Promise<boolean>;
export type AskPaneRegistration = {
  /** Refresh authorization on host activation; publish a NEW claim after Operator closes. */
  onActivate?: () => void;
  render: (context: AskPaneRenderContext) => AskPaneSlots;
  /** Trusted heading/title button only; never the remote frame. */
  focusEntry?: (region: HTMLElement) => void;
} & (
  // Browser cannot register without its own pause/release protocol.
  | {id:'browser';beforeLeave:AskPaneLeaveGuard}
  | {id:'canvas'|'workbench';beforeLeave?:AskPaneLeaveGuard}
);
export type AskPaneMemory=PaneRef & {selected_version?:number;followLatest?:boolean};

export function registerAskPane(registration: AskPaneRegistration): () => void;
export function setAskPaneScope(scope: AskPaneScope | null): void;
export function publishAskPaneSnapshots(scope: AskPaneScope, snapshots: readonly PaneSnapshot[], canFollow?: boolean): boolean;
export function selectAskPane(scope: AskPaneScope, ref: PaneRef, opener?: HTMLElement | null): void;
export function recalledAskPane(scope: AskPaneScope): AskPaneMemory | null;
```

Canvas/Browser builder sequence:

1. Register once (`id: 'canvas'` or `'browser'`). The host adds that tab only while registered. Browser registration requires `beforeLeave` at both the type and runtime boundary. The Workbench extension uses `id: 'workbench'`; until it registers authorized record snapshots, Inspect continues to navigate `/workbench?s=…` in the real app view.
2. The authenticated feature adapter supplies a fresh person/thread/claim via `setAskPaneScope`. No session identity source was invented in this UI-only change. Wire logout/revocation to `setAskPaneScope(null)`; `panelStore` already invalidates scope on thread changes. Each renderer must cancel fetches, dispose ports and clear its own resource handles on `signal.abort` and component unmount. A scope mismatch masks old pixels immediately; stale-claim publication is rejected.
3. Fetch authorized metadata, reading `recalledAskPane(scope)` to restore selected_version/followLatest, then publish. On activation/reopening, `onActivate` must refresh authorization and set a fresh scope before publishing. Closing Operator clears its display claim and metadata; only tab-local sanitized IDs/version/followLatest remain. The host does not restore without authorized snapshots. Snapshot metadata and claim IDs confer no server privileges.
4. Arrivals call only `publishAskPaneSnapshots`. The host never expands a resting dock or closed sheet for an arrival. `canFollow` is true only for the current following turn without older-version inspection; eligible arrivals may select in an already expanded host or a ≥840-content-width popout; host human choice, composer focus and dialogs still prevent selection stealing. Browser needs-you wins otherwise-eligible simultaneous attention; explicit Canvas remains selected and Browser gets a dot. Only an actual person control calls `selectAskPane(scope, ref, event.currentTarget)`; this preserves the opener for return focus. Tabs use the same selection path. Workbench renders as trusted content, never within feature frames.
5. Return title controls (including picker/menu), metadata, stage content and action controls as slots. Do not add another header/title/meta/action row or a pane close button. Host owns the single exit. Canvas fine-pointer zoom/pan and floor hints depend on `paneWidth`/`compact` vs `viewportWidth` independently and remain feature work. Browser uses `focusEntry` for its trusted site/state heading; Canvas defaults to the first trusted title button. No initial focus goes to an iframe. Arrival selection increments no focus request.

Before Browser resolves `beforeLeave` true, its adapter must finish its leave/pause protocol, fence/release control, cancel relevant commands and await acknowledgement. False (or a thrown failure) keeps Browser visible; a rejected protocol must provide its Browser explanation/confirm. The host guards tab switches, exits, app links, native Back and popout re-docking. Mounting never authorizes remote input, acquires control or renews presence. Cross-person owner review/watch UI and its separate server-authorized claim remain Browser work; this slice contains no staff-thread admission path.

## Escape and iframe integration

```ts
export type AskEscapeLayer = {
  scope: AskPaneScope;
  priority: number;
  onEscape: () => void;
  element?: HTMLElement;
};
export function registerAskPaneOverlay(layer: AskEscapeLayer): () => void;
```

Register actual layers only: menu/picker/Add a site 600; Code/About/Save/Delete/Sites review/Saved logins 500; Browser review 400 (Keep paused); Browser leave confirm 300 (keep open). A nested confirm uses its owner's priority + 1. Cleanup on close/unmount. Feature callbacks close only their own layer and restore opener focus. For a portal modal, provide `element` for the shared focus trap. The host consumes a single Escape in capture phase; PanelHost's Operator Escape listener defers. A leave protocol opening a confirm cannot consume the same Escape again.

The sheet trap includes iframe, trusted controls, pane-region fallback and before/after stage sentinels. A trusted renderer bridge may call `context.frameBoundary(frame, 'forward' | 'backward' | 'escape')` **only after authenticating its own MessagePort**; the host checks frame containment and current abort signal. There is deliberately no arbitrary `window.message` handler. Future opaque preview content must remain noninteractive; remote Browser focus is not local app focus. Real iframe/Safari/VoiceOver behavior is not proven by node tests.

## History and focus

`AskPaneHistory` preserves route/query/hash and Next history state. Explicit sheet/expanded-dock entry pushes once, version/pane switches replace, rotation reuses the same instance, and popout selection pushes nothing. Explicit exit sanitizes the forward entry before consuming it; native Back/iOS swipe returns to Chat/app, with blocked Browser Back restored while its leave protocol keeps the pane open. Direct links use replace on exit. App anchor navigation exits/consumes first and routes once; modified clicks, target=_blank and downloads are exempt (also fixed in PanelWindow). Origin control focus returns on pane exit, falling back to the Chat heading. Operator closure restores its opener through the existing sheet trap. Follow announcements are once per visible committed revision: `Canvas updated: Permit steps, version 3` / `Version 3 is ready.`

## Files

- `components/panel/AskContentPane.tsx`: sole content shell, slots, entry focus and frame sentinels.
- `components/panel/AskPaneSplitter.tsx`: accessible bounded host splitter.
- `components/panel/PanelHost.tsx`: one responsive dock/sheet instance, app expansion, safe areas, Operator Close/trap, guarded navigation.
- `components/panel/PanelDock.tsx`: scoped selection reducer, selector, attention, history, feature leave guards, stable Chat and pane allocation.
- `components/panel/PanelWindow.tsx`: guarded popout navigation/re-dock; target/download exemptions.
- `components/panel/panelStore.ts`: synchronous side-content scope invalidation on thread changes.
- `components/panel/askPaneLayout.ts`: pure shared math/policy, keyboard reducer, scoped persistence helpers.
- `components/panel/askPaneRegistry.ts`: typed tab-local registry, metadata claims, sanitized selection memory and overlay registration.
- `components/panel/askPaneHistory.ts`: actual owned-entry browser-history adapter.
- `components/panel/askPaneFocus.ts`: iframe-aware trap and frame boundary traversal.
- `components/panel/askPaneHooks.ts`: ResizeObserver content measurement and viewport subscription.
- `tests/fixtures/ask-pane-host.mjs`: shared H5 pure expected data for both feature tests.
- `tests/panel-content-pane.test.mjs`: pure-policy and actual helper/registry tests.
- This handoff.

## Validation

Expectations were written first; the first node run failed because the implementation module did not yet exist. Final single-file run: `node --test --test-reporter=spec tests/panel-content-pane.test.mjs` — **37 passed, 0 failed, 0 skipped**, exit **0**. Equivalent plain `node --test tests/panel-content-pane.test.mjs` was also run during implementation. Node emits the existing package's typeless-module warning for native TypeScript imports; no package metadata was changed.

TypeScript: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` — exit **0**. `git diff --check` — exit **0**. No full suite, database test, build, dev/start server, browser, service operation or deploy was run. The worktree lacked dependencies; an ignored `node_modules` symlink uses `/home/joe/sjcos-app/node_modules` for documentation/types only. Next's bundled use-client and native History API docs were consulted.

Coverage includes all H5 widths, 390×844/800×360/default-popout fixtures, compact boundaries, 420 dock arrival vs explicit expansion, pointer/keyboard clamps, throwing storage and person/device isolation, one-entry/replacement/consume/direct/popout history, failed leave state retention, scope changes/stale publications, both arrival orders, actual overlay ordering, vertical/horizontal key navigation, follow announcements, sanitized selection memory, Browser guard requirement and focus traversal with an iframe stand-in. Fake Window/focus objects exercise helpers; they do not simulate Safari layout, real iframe event boundaries or Next navigation behavior.

## Not done / release boundary

No DB changes or migrations 0100/0105; no private-thread/journal/recovery acceptance or provenance/admission work; no Canvas renderer, versions/cards/tool integration, Browser process/live view/credentials/approval/control/presence, owner-review feature UI, real frame bridge, floor/zoom controls, business operations or external sends. Feature adapters must supply auth/scoped metadata, leave protocol and revalidation. Those are not replaced by the UI claim API. This handoff is **not** a Browser/privacy rollout approval.

No visual QA or screenshots were taken. Coordinator should mount authorized test registrations in an isolated review harness, use the approved memory-capped production-build workflow, and stop anything it starts. Capture:

- No registrations: ordinary 420 dock, 560 two columns, 880 threads rail, narrow Queue/Chat + popout History; draft/scroll still present when switching views.
- 1280 desktop: arrival only adds dot; explicit selection expands over app at captured dock width; Back to app/native Back restores route, app scroll and opener. Resize with mouse/keyboard; saved ordinary dock width must remain unchanged. App links navigate once after exit; new tabs/downloads retain their intended behavior.
- Exact **content-box** 839 vs 840 and 1000: no split vs 348/12/480 and 420/12/568. At 840 all separator Home/End/Arrow minima keep pane ≥480; dynamic value ARIA matches actual width.
- 360×800 and 390×844 portrait, keyboard closed, all Diagram/Page/Floor placeholders: one selector, Close Operator, no chevron, single ‹ Chat/title/menu row, 20 meta, 56 actions, stage ≥420 with safe areas. Four labels fit; VoiceOver names/dots work. Drawer height returns after ‹ Chat.
- 820×1180: one fuller-width pane; then rotate through tablet landscape/desktop and confirm the same Chat draft/selection, no duplicated selector/history entry or focus jump.
- 800×360 with up to 80 vertical safe-area px: one text-sized ≥64 left strip, Close + four 48 px vertical tabs, no grabber/horizontal header, 128 right actions, 48/20 center rows, stage ≥200. Test Up/Down/Home/End and rotation back to portrait without pane remount/focus loss.
- 1100 popout: actual content about1084, pane about617 and compact; wider-than-about1150 popout can become fuller. Popout × pushes no history; Dock back and internal links run the Browser leave guard. Feature fine-pointer compact floats should remain −/Fit/100%/+ and floor hint follows **screen** width, once implemented.
- Real trusted iframe/opaque preview: Tab/Shift+Tab boundaries, authenticated bridge Escape, no focus behind sheet, nested feature portals and Escape innermost once, Sites review Close affecting only itself, failed/throwing Browser leave and native Back/iOS swipe. Close Operator consumes history; Forward does not reopen; fresh authorization restores only permitted selection.
- Explicit title focus vs arrival/composer focus, version-follow announcements, account/thread switch with delayed responses, denied reopen, reduced motion and iOS safe areas. No unrelated app state or private metadata should appear in storage/bus.
