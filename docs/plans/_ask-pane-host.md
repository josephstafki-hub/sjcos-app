# Ask side-content host — shared contract

> PLAN ONLY · 2026-11-05 · Canvas and Browser adopt this file by reference, verbatim.
> Authority for placement, selection, focus, provenance and migration dependencies. Feature plans define their own content and business actions. No implementation exists yet.

## H1. One host and layout

`components/panel/AskContentPane.tsx` is the sole side-content host. `PanelHost` owns app/dock expansion; `PanelDock` mounts the host; neither feature adds another rail/modal. Workbench keeps its existing `/workbench?s=…` record role and uses the same host selection when displayed beside Chat. It is trusted app content, never nested in an untrusted Canvas frame or Browser image.

| Contract | Normative value |
|---|---|
| Width | ResizeObserver measures the available host **content box**, after outer padding, before the internal gutter; never synthetic width 400 or viewport alone. |
| Split | Content width **≥840 px**; Chat **≥340 px**, pane **≥480 px**, **12 px** splitter/gutter. Default Chat width is `clamp(0.42 × width, 340, width−492)` in CSS px; at exactly 840 this is **348 + 12 + 480**, at 1000 **420 + 12 + 568**. Persisted Chat width uses the same clamp. Build the accessible host splitter and separate persistence specified below; no Queue/Threads columns while side content is open. |
| Narrow | <840: one selected view; Chat stays mounted with draft/scroll preserved, hidden content frames unmount. At 820 iPad portrait this is one full-width pane; landscape can split. |
| Resting dock | Existing default **420 px** (user-adjustable); normal no-pane Queue/Chat thresholds 560/880 remain. Incoming content never expands the dock. |
| Explicit dock open | **Open canvas / Open browser / Inspect** keeps Chat at current dock width (normally ~420), replaces the app view to its right with the selected pane, with **Back to app**. At a 1280 viewport this is ~420 Chat + 12 gutter + remaining app width. It does not resize the stored dock width. If the remaining pane cannot reach 480 or Chat 340, use narrow view. |
| Sheet / phone | Below the app's 1024 desktop breakpoint reuse Operator sheet, expand to `100dvh` with safe areas; restore previous drawer height on return to Chat. Canvas/Browser have **‹ Chat**, no pane ×. Hide the sheet chevron while content is open; keep the sheet **×** working to close Operator, consume the owned pane history entry and remember authorized selection for reopen (H3). |
| Popout | Same measured rules: ≥840 split, otherwise one view; no app expansion. Popout normally opens ≥1100. |
| One pane exit | Narrow **‹ Chat**; split **×**, `aria-label="Close canvas"` / `"Close browser"` / `"Close record"`; dock expanded **Back to app**. No Hide canvas action. Exit restores origin card/control focus; fallback Chat heading. Sheet × closes Operator, never a second Canvas exit. |

**Splitter implementation required:** existing `components/panel/Splitter.tsx:7` clamps the dock to 320–1000 and `:53` renders a pointer-only separator; it has no keyboard support. Extend it with explicit host bounds or add `AskPaneSplitter.tsx`, retaining the ordinary dock behavior. The host separator is focusable (`tabIndex=0`, `role="separator"`, vertical, `aria-controls`, `aria-valuemin/max/now`, label **Resize Chat and pane**). Left/Right changes Chat by 16 px (Shift: 64), Home/End selects dynamic min/max, Enter or double-click resets to the clamped 42% default. Pointer and keyboard use the same clamp and commit on key-up/drag end; no side-content split below 840. Persist committed width in **`sjcos:ask-pane-layout:v1:<userId>:<deviceId>`**, separate from existing unscoped `sjcos:panel:state:v1` (`panelStore.ts:89`); deviceId is a non-secret local ID. No cross-person reuse or dock `layout.width` writes. The explicit expanded dock keeps its current dock width if it fits; otherwise H1 narrow fallback applies. While expanded, its separator uses transient bounds 340..(available workspace−492) so pane remains ≥480. Home/End and arrow increments use those bounds; Enter/double-click resets to the originally captured dock width, clamped to these bounds, never the 42% popout default. Exiting restores that original dock width. It does not apply the popout's 42% default or write the stored dock width.

## H2. Interface, selection and attention

The following are **proposed exported types**, not current code:

```ts
type PaneRef = {kind:'canvas'|'browser'|'workbench'; id:string};
type PaneSnapshot = {
  thread_id:string; run_id:string|null; user_id:string;
  label:string; attention:'none'|'new'|'needs_you'; revision:string;
} & (
  | {kind:'canvas'; id:string; selected_version:number; latest_version:number}
  | {kind:'browser'; id:string; task_id:string; status:string; takeover:boolean}
  | {kind:'workbench'; id:string; subject_id:string}
);
type AskContentPaneProps = {
  contentWidth:number; mode:'sheet'|'dock'|'popout'; threadId:string; userId:string;
  snapshots:readonly PaneSnapshot[]; selected:PaneRef|null;
  onSelect:(ref:PaneRef|null, cause:'person'|'arrival'|'back')=>void;
  onExit:()=>void; renderPane:(snapshot:PaneSnapshot)=>React.ReactNode;
};
```

Browser `status` enum, presence renewal, device/control authorization, release/pause on leaving, reconnection and expiry: **Browser plan decides**. Shared host only consumes `takeover`/attention; mounting a pane cannot authorize a command or claim presence. Workbench refs to global records still require current record permissions and local originating thread/user; null run is valid for a person opening Inspect. Snapshots are server-authorized metadata, never credentials or proof of permission.

One reducer owned by `PanelDock` holds selection **per authenticated person, tab and thread**. Features submit snapshots/attention, not imperative `open()` calls. Store only IDs/version/followLatest/layout, never titles/source/frames/control tokens in localStorage or the panel bus. Thread/user switch clears private pixels synchronously, cancels requests/ports and drops selection unless that tab has an authorized selection for the destination. Late responses carry a thread/user/claim token and cannot reopen the old pane. All reads reauthorize.

Extend the existing **one** `Segmented` Operator view control to **Queue · Chat · Canvas · Browser** (Browser only when enabled; Canvas only when enabled or history exists). History icon opens Threads; move popout's narrow Threads segment there, rather than adding a fifth cramped segment. At 360 the four labels fit without wrapping; add `flex-1 min-w-0` to the narrow variant so the four segments share the row. A dot is the only new indicator; Canvas uses `aria-label="Canvas, new version"`; Browser `"Browser, needs you"` or `"Browser, new activity"`. Clear dot only after the person views the new revision. Implement `role="tablist"`/`tab`, `aria-selected`, roving tabIndex, Left/Right/Home/End selection and visible focus; this is new work, replacing today’s `role="group"`/`aria-pressed` buttons. Switching away still runs the Browser leave guard before selection commits. Wide layout uses the same selector with Chat remaining alongside the selected pane; Queue switches out of side content and History stays available.

Attention priority is deterministic: current human choice wins, then Browser takeover / pending approval or login, then existing active pane, then arrival. Never replace Browser with Canvas during takeover or an approval; Canvas gets a dot/card. Never replace Canvas an operator explicitly opened with routine Browser activity; Browser **needs you** gets a dot/card, not stolen focus. New Canvas may auto-select only in an already expanded/split host, following the current run, with no human selection/close since turn start, no older-version inspection, composer focus, dialog or approval. In a resting dock/narrow view it is card + dot only. Simultaneous arrivals with no selection: Browser needs-you wins; otherwise keep Chat with both dots. Explicit switching while takeover is active invokes Browser's leave/pause protocol **before** unmount; on failure keep Browser visible and explain, never silently pass control to the agent. Browser plan decides that protocol's exact words and state transitions.

## H3. Back, Escape and focus

Opening side content in the **sheet or explicitly expanding the dock over the app** pushes **one** same-origin history entry, preserving current path/query, app scroll and origin focus and adding `?canvas=<id>` (or `browser=<id>` / `record=<id>`). IDs are not capabilities. Switching versions/panes replaces that entry; never push per version. `popstate` and iOS edge swipe return to Chat in a sheet or perform **Back to app** in the expanded dock; a second Back behaves as today. **‹ Chat / Back to app** consumes the owned entry with `history.back()`; a direct link without one removes the pane query with replace and restores its underlying app route (e.g. Today). **Back to app restores the app view (route, scroll) and focus; the dock width never changes.** Clicking any app navigation link (sidebar, tab bar, record link) while dock-expanded first completes Back to app, consumes its entry and clears the pane (unviewed activity dot stays), then navigates exactly once. Browser's leave protocol must succeed first. Split-in-popout selection adds **no** entry; its pane × returns to Chat.

Sheet × closes **Operator**, not just Canvas/Browser: after any Browser leave guard succeeds it consumes/clears its pane entry without stale reopen on Forward, and remembers IDs/version/followLatest per H2. Reopening Operator restores the remembered selection only after fresh authorization; denied selection falls back to Chat. Hide the sheet chevron while content forces `100dvh`; normal chevron resumes in Chat. Do not render disabled chevron/× controls or an inaccessible disabled-button explanation. The working sheet × has `aria-label="Close Operator"`; Canvas itself still has only ‹ Chat in a sheet. Grabber stays decorative. The 360 Canvas keeps one 48 px row **‹ Chat · title picker · ⋯**, a 20 px meta row and a 56 px bottom bar (§3.1 of Canvas); no additional Canvas header/toolbar rows in phone content mode. Operator header and the single selector remain above it.

One overlay coordinator handles Escape **innermost actual layer first**, not a cascade through absent layers:

1. Canvas menu/version/canvas picker or Browser **Add a site**.
2. Canvas **Code / About this diagram / Save to project files / Delete canvas** sheets or confirm, and Browser **Sites review / Saved logins / Save to project files** sheets. Browser plan decides any browser-only nested confirms and their exact cancel behavior; each must register above its owning sheet.
3. Browser **review sheet**: Escape = **Keep paused**; do not approve, send or resume.
4. Browser **Pause browser and return to Chat?** confirm: Escape keeps Browser open; Browser plan decides exact state transitions and other browser-only confirms.
5. Canvas/Browser → Chat (or Back to app). Browser invokes its leave/pause protocol before exit; Browser plan decides in-flight waits. If leaving opens the confirm, that becomes the top layer and the same Escape cannot dismiss it.
6. Operator sheet.

Close only the topmost layer, mark handled/stop propagation; existing PanelHost Escape listener must defer. **Sites review’s Close closes only that sheet**, never Browser or Operator. Sheet Close buttons do not conflict with the “‹ Chat, no pane ×” rule. No underlying sheet closes while an inner layer is open. A cross-person owner Browser review/watch is a separate top host layer over Joe’s own selection, never admission to a staff chat; one owned entry, header **‹ Back · Abigail’s browser · Larson bath**, no view selector. Escape = Keep paused, return restores Joe’s own thread untouched; Browser plan decides review/watch payload, device/presence and confirm details.

On explicit Canvas entry focus the **pane title button** (e.g. **Permit steps ▾**), never the iframe. Arrival auto-selection moves **no focus**. Once-per-commit polite announcement with follow-latest on: **Canvas updated: Permit steps, version 3**; with follow off: **Version 3 is ready.** Composer hint **About: Permit steps · Version 2** has a 44 px ×, `aria-label="Remove canvas from message"`. Browser plan decides its entry target and announcements.

Modal focus trap includes `iframe`, pane region (`tabIndex=-1`), trusted controls and before/after iframe sentinels. Trusted bridge reports boundary Tab/Shift+Tab/Escape over authenticated MessagePort; opaque preview content has no interactive focusable elements. Tab cannot reach the app behind the sheet. Browser local controls participate in the trap; remote focus never means local app focus. Dialog closure returns focus to its opener; pane exit to card/control, fallback Chat heading. No auto-open moves focus from composer/approval.

## H4. One server provenance contract

Persist **`dev_agent_runs.launch_source` only**, not `interaction_surface`. Values: `legacy`, `panel_web`, `panel_mobile`, `panel_voice`, `telegram`, `background`. Common fields are existing UUID `conversation_id` (UI `thread_id`), `principal_user_id` (UI `user_id`), `id` (UI `run_id`), `profile`, trusted `created_at`; add nullable `continuation_of_run_id` UUID RESTRICT. Snapshot aliases above map to these once on the server, not separate writable identities.

One proposed server-only `admitAskRun` in `lib/ask-run-admission.ts` validates session/bearer active person, revocation/auth time, `ai`, owned undeleted thread and resume session before inserting a run. Server route selects source, never prompt/tool args or X-SJC headers. Owner's operator and staff's business profiles keep their current restrictions. Generic `startClaudeRun` callers default background; a named user or conversation alone does not make a panel run.

| Caller | Source / v1 eligibility |
|---|---|
| Authenticated web typed Ask | `panel_web`; Canvas yes; Browser requires its admission/presence gates. |
| Authenticated mobile Operator bearer request | `panel_mobile`; Canvas yes with web fallback; Browser plan decides supported mobile surface/presence. |
| Session/bearer voice Ask delegation | `panel_voice` only through same admission after thread check; Canvas yes; Browser plan decides device/presence gate. TTS/phone calls alone are not Ask. |
| Telegram verified owner | `telegram`; neither Canvas nor Browser, even with a conversation. |
| Worker/cron/business/orchestrator retry | `background`; neither feature. It can retain business subject refs without impersonating a panel launch. |
| Continuation | Parent source retained only for continuation of the same still-active admitted human turn, same principal/thread and fresh revocation check. Terminal-run autonomous retries/new turns default background; new human turn readmits. Record parent; never relabel a background run panel. |
| Existing rows | `legacy`; no retrospective panel admission. |

Per-run stdio MCP gets actual runner-derived tags, not model input; feature plans define transport authentication. HTTP claimed identities cannot establish this launch provenance. No task presence/security token in URL/local state or provenance fields. Browser plan decides its task capability and device authorization independently of these identity fields.

## H5. Migration and implementation ownership

Browser reserves **0100–0104**; Canvas **0105–0109**. Browser **0100** owns canonical `launch_source`, parent relation and protected run identity/launch guards; its app code must use `admitAskRun`. Canvas **0105 / Phase 0** owns thread ownership/privacy, tombstones and thread guards; it consumes 0100, adds thread-dependent admission checks and updates the shared admission helper, never adds another provenance column. Browser tables 0100–0104 must be additive and apply before 0105 without referencing the new owner column at migration time. Apply numbered migrations with both features off, then deploy admission code only after 0105. **Browser panel access (owner and staff) and Canvas Phase 1 depend on 0105 privacy acceptance.** Browser cannot claim independent rollout from that prerequisite. Neither renderer nor Browser process/flags depends on the other's renderer; this is schema/authentication dependency, not a request to enable Canvas first.

Canvas Phase 0 implements the shared host once; Browser supplies its registry renderer and consumes this document verbatim. If already implemented in Browser, adopt and reconcile it in place; never implement two hosts. Workbench integration preserves Inspect's app-view navigation/history. Browser adopts this file in §6.2 (at `89b1bd6e`, including H1–H5); its next revision consumes these corrections. No Browser-plan edits are made by the Canvas author.

Both `tests/panel-content-pane.test.mjs` and `tests/browser-ui.test.mjs` import proposed `tests/fixtures/ask-pane-host.mjs`, covering content widths **360, 420, 720, 820, 839, 840, 959, 960, 1000, 1280**, 1280 resting dock vs explicit expanded workspace, both arrival orders, takeover switching, focus/escape/history, thread change and no secret persistence. Shared fixture expected results, not independent breakpoint constants in each test: at 840 **348/12/480**, at 1000 **420/12/568**; keyboard/pointer minima, Arrow/Shift/Home/End/reset, per-person/device layout isolation and no dock-width writes; desktop expansion then browser Back restores app route/scroll/focus; app-link click exits then navigates once; split-popout selection does not push history; sheet × closes Operator, consumes the entry and reopens the authorized selection with chevron hidden; nested Browser sheets/confirms consume Escape in the listed order, Sites review Close affects only itself; Canvas title focus and both follow announcements. Actual Safari/focus/iframe behavior remains a coordinator release check, not proven by a reducer test.

## Appendix — Round-2 fixes

| Judge item | Host section changed |
|---|---|
| Canvas design 1 | H3: compact phone rows alongside Operator chrome; Canvas §3.1 owns stage budget. |
| Canvas design 4 | H1/H3: hide chevron, working Close Operator, history and remembered selection. |
| Canvas design 8 | H3/H5: expanded-dock history/Back and exit-before-app-navigation fixtures. |
| Canvas design 9 | H3/H5: title focus, follow-dependent announcement and removable composer hint. |
| Canvas engineering 1 | H1/H2/H5: deterministic 348/12/480 split, new keyboard separator/persistence and shared fixtures. |
| Browser design 8 (host parts) | H1/H2/H3: dock remains left, selector/chrome contract, Back to app restores view/focus without width writes; Browser draws its frames. |
| Browser design 11 (host part) | H5: Browser adopted H1–H5 in §6.2 at 89b1bd6e; removed obsolete claim. |
| Browser design 12 (host parts) | H3/H5: Browser sheets/confirms in Escape order; Sites review Close closes only the sheet; Browser-only details remain Browser plan decides. |
