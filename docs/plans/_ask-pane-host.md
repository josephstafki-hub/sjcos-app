# Ask side-content host — shared contract

> PLAN ONLY · 2026-11-05 · Canvas and Browser adopt this file by reference, verbatim.
> Authority for placement, selection, focus, provenance and migration dependencies. Feature plans define their own content and business actions. No implementation exists yet.

## H1. One host and layout

`components/panel/AskContentPane.tsx` is the sole side-content host. `PanelHost` owns app/dock expansion; `PanelDock` mounts the host; neither feature adds another rail/modal. Workbench keeps its existing `/workbench?s=…` record role and uses the same host selection when displayed beside Chat. It is trusted app content, never nested in an untrusted Canvas frame or Browser image.

| Contract | Normative value |
|---|---|
| Width | ResizeObserver measures the available host **content box**, after outer padding, before the internal gutter; never synthetic width 400 or viewport alone. |
| Split | Content width **≥840 px**; Chat **≥340 px**, pane **≥480 px**, **12 px** splitter/gutter. At exactly 840, allocate 340 + 12 + 488. Clamp desired Chat share 42% to `[340, width−492]`. Existing `Splitter` keyboard/persistence behavior, scoped per person/device; no Queue/Threads columns while side content is open. |
| Narrow | <840: one selected view; Chat stays mounted with draft/scroll preserved, hidden content frames unmount. At 820 iPad portrait this is one full-width pane; landscape can split. |
| Resting dock | Existing default **420 px** (user-adjustable); normal no-pane Queue/Chat thresholds 560/880 remain. Incoming content never expands the dock. |
| Explicit dock open | **Open canvas / Open browser / Inspect** keeps Chat at current dock width (normally ~420), replaces the app view to its right with the selected pane, with **Back to app**. At a 1280 viewport this is ~420 Chat + 12 gutter + remaining app width. It does not resize the stored dock width. If the remaining pane cannot reach 480 or Chat 340, use narrow view. |
| Sheet / phone | Below the app's 1024 desktop breakpoint reuse Operator sheet, expand to `100dvh` with safe areas; restore previous drawer height on return to Chat. Canvas/Browser have **‹ Chat**, no pane ×. |
| Popout | Same measured rules: ≥840 split, otherwise one view; no app expansion. Popout normally opens ≥1100. |
| One pane exit | Narrow **‹ Chat**; split **×**, `aria-label="Close canvas"` / `"Close browser"` / `"Close record"`; dock expanded **Back to app**. No Hide canvas action. Exit restores origin card/control focus; fallback Chat heading. Sheet × closes Operator, never a second Canvas exit. |

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

Extend the existing **one** `Segmented` Operator view control to **Queue · Chat · Canvas · Browser** (Browser only when enabled; Canvas only when enabled or history exists). History icon opens Threads; move popout's narrow Threads segment there, rather than adding a fifth cramped segment. At 360 four equal segments fit without a second row. A dot is the only new indicator; Canvas uses `aria-label="Canvas, new version"`; Browser `"Browser, needs you"` or `"Browser, new activity"`. Clear dot only after the person views the new revision. Arrow-key selection and visible focus apply. Wide layout uses the same selector with Chat remaining alongside the selected pane; Queue switches out of side content and History stays available.

Attention priority is deterministic: current human choice wins, then Browser takeover / pending approval or login, then existing active pane, then arrival. Never replace Browser with Canvas during takeover or an approval; Canvas gets a dot/card. Never replace Canvas an operator explicitly opened with routine Browser activity; Browser **needs you** gets a dot/card, not stolen focus. New Canvas may auto-select only in an already expanded/split host, following the current run, with no human selection/close since turn start, no older-version inspection, composer focus, dialog or approval. In a resting dock/narrow view it is card + dot only. Simultaneous arrivals with no selection: Browser needs-you wins; otherwise keep Chat with both dots. Explicit switching while takeover is active invokes Browser's leave/pause protocol **before** unmount; on failure keep Browser visible and explain, never silently pass control to the agent. Browser plan decides that protocol's exact words and state transitions.

## H3. Back, Escape and focus

Opening side content in the sheet pushes **one** same-origin history entry, preserving current path/query and adding `?canvas=<id>` (or `browser=<id>` / `record=<id>`). IDs are not capabilities. Switching versions/panes replaces that entry; never push per version. `popstate` and iOS edge swipe return to Chat and restore card focus, then a second Back behaves as today. **‹ Chat** consumes this owned entry with `history.back()`; direct links without an owned entry remove the pane query with replace and select Chat. Sheet close consumes/clears its pane entry without a stale re-open on Forward; reopening still requires authorization. Desktop pane selection does not add a history entry.

One overlay coordinator handles Escape innermost first: menu/version/canvas picker → Code sheet → Save dialog → Canvas/Browser back to Chat (or Back to app in dock mode) → Operator sheet. Close only the topmost actual layer, mark handled/stop propagation; the existing PanelHost listener must defer. Browser must handle its takeover leave protocol on Escape as on any pane exit; **Browser plan decides** whether an in-flight exit must wait. No underlying sheet closure while an inner layer is open.

Preserve real Operator sheet chrome: grabber, **Operator**, expand/shrink chevron, sheet ×. While side content is active in narrow mode, chevron and sheet × are disabled with accessible explanation **“Return to Chat to close Operator.”** Only **‹ Chat** exits content; normal shell controls resume in Chat. Modal focus trap includes `iframe`, the pane region (`tabIndex=-1`), all trusted controls, and before/after iframe focus sentinels. Trusted renderer bridge reports boundary Tab/Shift+Tab/Escape to the overlay coordinator over its authenticated MessagePort, and opaque preview content has no interactive focusable elements. Tab from/through iframe cannot reach the app behind the sheet. Browser's local live-view controls participate in the trap; remote focus never means local app focus. Dialog closure returns focus to its opener; pane exit to card; no auto-open moves focus from composer/approval.

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

Canvas Phase 0 implements the shared host once; Browser supplies its registry renderer and consumes this document verbatim. If already implemented in Browser, adopt and reconcile it in place; never implement two hosts. Workbench integration preserves Inspect's app-view navigation/history. The companion Browser plan has not been edited by this document's author; its next revision must replace §6.2 and conflicting provenance/migration text with this contract.

Both `tests/panel-content-pane.test.mjs` and `tests/browser-ui.test.mjs` import proposed `tests/fixtures/ask-pane-host.mjs`, covering content widths **360, 420, 720, 820, 839, 840, 959, 960, 1000, 1280**, 1280 resting dock vs explicit expanded workspace, both arrival orders, takeover switching, focus/escape/history, thread change and no secret persistence. Shared fixture expected results, not independent breakpoint constants in each test. Actual Safari/focus/iframe behavior remains a coordinator release check, not proven by a reducer test.
