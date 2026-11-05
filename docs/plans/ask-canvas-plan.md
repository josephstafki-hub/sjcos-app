# Ask-panel canvas — implementation plan

> PLAN ONLY · 2026-11-05 · verified source baseline `c00af55d` (round-1 source unchanged), branch `t3/in-app-browser-agent-tools`.
> Owner of this document: canvas design agent. No source implementation or deployment is authorized by this document.
> Request and settled decisions: `docs/plans/_context-agent-browser-canvas.md`.
> Companion: `docs/plans/agent-browser-plan.md`. This plan reserves **0105–0109**; browser owns **0100–0104**. Shared host/provenance authority: `docs/plans/_ask-pane-host.md` (H1–H5). Browser panel access and Canvas both depend on Canvas 0105 privacy acceptance; Canvas 0105 consumes Browser 0100 launch guards. Renderer/process flags remain separate.

## 1. Problem, outcome, and decisions

Joe's words:

> “how feasable is in app browser use when using the web version? id like to be able
> to interact with the browser to fill out account info etc when needed. Id use this
> so the agent can pull permits and perform other functions. I'd like to have the
> other features of the claude and chatGPT apps as well like the canvas where it can
> draw diagrams etc”

After the feasibility answer: **“okay build both and use the council of sub agents like ive had other sessions do.”** This is the canvas part. A diagram should be something Joe can see, ask to change, compare with its previous version, and keep on the job. A code fence in a reply does not do that.

Success example: Joe asks “Draw the permit steps for the Larson bath.” A diagram card appears in the conversation, a pane opens beside Chat when there is room, and “Put the inspection before closeout” produces Version 2 without destroying Version 1. **Save to project files** saves the version Joe is looking at to the named job, internally. Nothing is emailed, published to the portal, submitted, or approved by viewing or saving it.

| Decision | Chosen behavior and reason |
|---|---|
| Name | **Canvas**, Joe's own comparison with Claude/ChatGPT. “Diagram”, “Page”, and “Floor plan” identify what's inside it. No “artifact”, “work product”, or “visual workspace” in the UI. |
| Placement | Canvas is a pane beside Chat in a sufficiently wide Ask panel; otherwise a full-width tab. Keep Workbench's existing job-record role. Browser and Canvas share the panel's pane selector, never nest inside each other. |
| L1 | Mermaid diagrams, rendered only on the user's device in a script-capable **trusted renderer iframe**, strict configuration, opaque origin, zero network after its initial document load. Source never becomes script. |
| L2 | Agent-written HTML with inline SVG, **static only**. No agent JavaScript, external libraries, external fonts, remote images, forms, or links. This is enough for diagrams, illustrated explanations, tables, and mockups. Interactive generated apps are out of v1. |
| L3 | Show the existing floor designer inline, initially read-only, using its own components and saved design versions. **Edit floor plan** opens the existing designer. No new CAD store or drawing tool. |
| Delivery | `show_canvas`, `update_canvas`, `get_canvas`, `list_canvases` on **sjcos MCP**, calling an authenticated internal app adapter; not interact MCP. Whole versions only, no partial HTML or token streaming. |
| Access | Joe plus staff with `ai`; each person sees only their own source threads/canvases, and must also retain every recorded area required by that canvas. Saving/floor plans additionally require `projects`. No unattended canvas creation in v1. |
| Saving | Explicit internal project-file snapshot, immutable by canvas/version/project identity; source canvas remains private. Saving makes that snapshot available to authorized project-file readers. Show that before saving. |
| Smallest release | L1 + persistence/history + safe SVG/source downloads + project saving. L2 and L3 have separate gates and phases. |

### Words used

| On screen | Meaning / justification |
|---|---|
| Canvas | The pane and the things made in it; Joe used this word. |
| Queue · Chat · Canvas · Browser | Panel views; Browser only appears when its feature is enabled. |
| Diagram · Page · Floor plan | Plain type labels; never L1/L2/L3. |
| Open canvas · ‹ Chat · Back to app | Enter/leave the focused canvas. |
| Version 2 of 3 · Previous version · Next version · Latest | Browse immutable history. Browsing does not change the current version. |
| Use this version | Create a new latest version from the one shown; never rewrite history. |
| Preview · Code · Copy code | The exact diagram/page text, shown as escaped text. Floor plans instead offer **Open floor plan**. |
| Save to project files · Project · Save | Internal snapshot, with a named destination. |
| Download · Picture (PNG) · Drawing (SVG) · Page (HTML) · Diagram code (.mmd) | Only available formats for the selected type. |
| Print / Save PDF | Opens the trusted print view and the device's print dialog. No server PDF renderer. |
| Made by Claude · Version 2 · Saved to Larson bath | Provenance, revision, and actual destination; not a safety certification. |

## 2. Verified repo map and gaps

Anchors below were checked against real source at `c00af55d`; implementation targets elsewhere are proposals. Relative panel filenames mean `components/panel/`.

| Existing piece | Verified location | Use / gap |
|---|---|---|
| Layout | `components/panel/PanelDock.tsx:14`, `:20`, `:75`; `components/panel/panelStore.ts:72` | 560/880 thresholds; default 420; no Workbench column. Inspect opens app `/workbench`. |
| Shell | `components/panel/PanelHost.tsx:143`, `:229`, `:266` | Operator aside; 66dvh drawer and synthetic width 400 need host integration. |
| Popout | `components/panel/PanelWindow.tsx:96` | Same-origin anchor capture currently ignores target/download; exempt new-tab/print/download controls. |
| Transcript/review | `components/panel/PanelChat.tsx:603`, `:617`, `:623`; `components/panel/RunReview.tsx:7` | Card between reply and RunReview; approvals stay trusted siblings. AssistantMarkdown remains text-only. |
| Poll/reload | `components/panel/useAgentChat.ts`; `lib/actions/dev-agents.ts` | Two-second run polling, claim tokens, distinct live/done/error branches; all need metadata, plus idle thread feed. |
| Run identity | `lib/dev-agents.ts:646`; `scripts/run-claude-agent.mjs:829`, `:927`, `:975`; `lib/authority/run-profile.mjs:53` | Session-derived identity/profile; runner reloads row; sjcos stdio inherits run/user/profile/start/thread tags. No transport authenticity from HTTP headers. |
| MCP | `mcp/sjcos-mcp.mjs:153`, `:195`, `:218`, `:3060`, `:3146` | principalRef accepts HTTP ALS header identity; principalPayload lacks conversation; internalCall adds CRON_SECRET. Concrete changes in §5.2. Interact is question plumbing, not Canvas. |
| Files | `lib/upload-store.ts:85`, `:102`; `app/api/files/[id]/route.ts`; `mcp/bidding-tools.mjs` | storeBuffer public, persistBlob private/nontransactional; generic route signed bypass and MCP direct same-name save need canvas policy handling. |
| File lifecycle | `lib/file-trash.ts:24`, `:68`, `:105` | Generic FK scan would query private save ledger; restore reinserts files without relinking saves. §8.4 replaces those paths. |
| HTML precedent | `lib/file-serve.ts:108` | Existing sandbox allows remote image/font resources; Canvas needs tighter profile. |
| Headers | `proxy.ts:190`; `next.config.ts` | API excluded by matcher; Next config has no CSP/headers rules. Wrapper rules must actually be added. |
| Floor | `mcp/floor-tools.mjs:550`; `lib/actions/plan-designs.ts:183`; `app/(os)/floor/[id]/page.tsx:25`; `db/schema.sql:3264` | Loader sends inspector data; independent MAX+1 snapshot writers; existing unique design/number; bigint version IDs; referenced deletions need guards. |
| Identity | `lib/dal.ts:32`, `:70`; `lib/api-auth.ts:13`, `:61` | Current DB permissions/revocation; mobile bearer parallel. Previous plan's API auth 87–106 and proxy 228–233 did not exist. |
| Privacy | `lib/actions/ai-chat.ts:67`, `:410`; `lib/ai-chat.ts:65`, `:129`, `:246`, `:271`; `db/schema.sql:2535` | Area-only actions, unscoped thread/model reads; physical delete cascades messages/runs. Phase 0 is mandatory. |
| Mobile | `lib/mobile-rpc/operator-reads.ts`; `/home/joe/sjcos-mobile/src/lib/api/operator.ts` | Optional card metadata plus plain fallback for shipped native clients; no token in URL. |

Next docs: worktree has no `node_modules`. Read installed **16.2.9** docs at `/home/joe/sjcos-app/node_modules/next/dist/docs/`: `01-app/01-getting-started/15-route-handlers.md`, `02-guides/lazy-loading.md`, `02-guides/content-security-policy.md`, `03-api-reference/05-config/01-next-config-js/headers.md`. Route `params` are awaited; raw route handlers do not use layouts; GET is not cached by default, and canvas additionally sets explicit `no-store`. `ssr:false` must live in a Client Component.

Reference bar: `origin/t3/sjcos-workflow-plans:docs/plans/in-home-consult-plan.md`, and its round-1 design/engineering reviews. Apply their concrete lessons: one vocabulary, wireframes matching actual access and layout, no invented upload helper, transaction/idempotency contracts, no per-process “global” locks, named adversarial tests, no promises that depend on unsigned/unspecified staff identity.

## 3. Shared panel layout contract

Adopt **[the shared Ask host contract](_ask-pane-host.md) H1–H5 verbatim by reference**. It is authoritative over earlier Canvas and Browser drafts: `AskContentPane.tsx`, split at **840 measured content px**, Chat ≥340 / pane ≥480 / gutter 12. Canvas owns Phase 0 integration; Browser adopts the same file. Workbench remains the existing trusted record view. Selection, arrival priority, iframe focus, Escape, one-entry phone history and provenance are not duplicated here.

### 3.1 Responsive wireframes and exits

**360 × 800 — Operator sheet; Chat → full-screen Canvas.** Sheet ×/chevron are normal in Chat; disabled while Canvas is active (H3), leaving only **‹ Chat** as the content exit. Grabber remains decorative.

```text
┌──────────── grabber ──────────┐   ┌─────────── grabber ───────────┐
│ Operator              ⌃   × │   │ Operator           ⌄(off) ×(off)│
│ Queue  Chat  Canvas• Browser │   │ Queue  Chat  Canvas  Browser │
│ Claude ▾    History    New   │   │ ‹ Chat                      │
│ You: Draw permit steps      │   │ Permit steps ▾           ⋯  │
│ Claude: Here are the steps. │   │ Diagram · Version 2 of 2    │
│ Workflow  Permit steps      │   │ Preview · Code              │
│ Diagram · Version 2         │   │ About this diagram ▸        │
│ Steps through inspection…  │   │ [‹] [Versions ▾] [›]        │
│ [Open canvas]               │   │        diagram              │
│ [Message Claude…]    Send   │   │ [−] [Fit] [100%] [+]        │
└─────────────────────────────┘   │ [Save to project files]     │
                                  │ [Ask for a change]          │
                                  └─────────────────────────────┘
```

**820 × 1180 — iPad portrait Operator sheet / 820 popout.** One full-width pane, same segmented control (not two tab rows). Sheet chrome shown; a popout uses its existing window shell instead.

```text
┌───────────────────── grabber ──────────────────────┐
│ Operator                              ⌄(off) ×(off)│
│ Queue       Chat       Canvas•       Browser       │
│ ‹ Chat                                              │
│ Permit steps ▾     Diagram · Version 2 of 3       ⋯ │
│ Preview · Code       About this diagram ▸           │
│ [‹] [Versions ▾] [›]  Version 3 is ready [Latest]    │
│                   preview                           │
│ [−] [Fit] [100%] [+]       [Save to project files]  │
│ [Ask for a change]                                  │
└────────────────────────────────────────────────────┘
```

**1280 × 900 — popout ≥1100, split.** Queue/Threads rails collapse; History is in Chat header. One pane ×, no Back/Hide action.

```text
┌ Operator                 Queue · Chat · Canvas · Browser ┐
│ Claude ▾  History  New      │ Permit steps ▾       ×      │
│ You: Move inspection       │ Diagram · Version 2 of 3  ⋯  │
│ before closeout            │ Preview · Code               │
│                            │ About this diagram ▸         │
│ [Canvas Version 3 card]     │ Version 3 is ready [Latest]   │
│                            │       diagram                │
│ [Message…]          Send   │ [−] Fit 100% [+]  Save        │
└────────────────────────────┴──────────────────────────────┘
```

**1280 × 900 — dock ~420 + Canvas expanded over app.** Explicit card open expands; arrival alone leaves app intact with dot/card. Back to app restores prior route/scroll and card focus.

```text
┌ Operator (~420) ───────────┬ app view replaced by Canvas ───────┐
│ Queue · Chat · Canvas•     │ Back to app                         │
│ Claude ▾ History New       │ Permit steps ▾   Diagram · Version 2│
│ Reply + canvas card        │ Preview · Code       Versions ▾  ⋯ │
│                           │           diagram                  │
│ [Message…]           Send │ [−] Fit 100% [+]  Save              │
└───────────────────────────┴────────────────────────────────────┘
```

Phone/tablet footer **Ask for a change** is 48 px. It returns to Chat (consumes pane history entry), focuses composer with **“About: Permit steps · Version 2”** context hint, and sends nothing. The referenced IDs/version travel in trusted composer context, not visible UUID text. On return to Canvas the selected version remains. The empty-state example similarly fills/focuses Chat without sending.

### 3.2 Readability, focus and zoom

Existing light paper theme only; app has no dark theme. Both renderer documents explicitly set `color-scheme: light` and background to resolved `--card`. Trusted chrome uses `font-serif text-heading` (17 px) titles, `text-subheading` (14 px) meta, current `--text-body` (13 px) body; project search is **16 px** to prevent iOS input zoom. No blanket 16 px body claim. Touch controls ≥48 px, card Open ≥44 px. Use current paper/card/ink/ai/flag tokens, visible focus and reduced-motion preferences.

Mermaid uses `theme:'base'` with resolved token values: node fill `--card`, stroke `--ink-3`, text `--ink`, accent edges `--ai`; system fonts because font-src is none. Parent sends a fixed trusted token palette, never model CSS. **About this diagram** disclosure under title exposes mandatory summary. Iframe has title `{title}, diagram, version {n}` and parent `aria-describedby` summary ID; SVG role=img plus escaped title/desc inside frame. Announce **“Canvas updated: Permit steps, version 3”** once per commit, not per poll.

Diagram stage: default **Fit**, zoom **25–400%**, **100%** button; focused stage + / − / 0 zoom/fit, arrows pan. Touch pinch affects only diagram (`touch-action:none` on stage), double-tap fits; browser page zoom remains available outside stage. Pan/zoom buttons work without gestures. Code toggle displays selected-version text escaped, with Copy code; on narrow widths Code may open as a sheet in H3 layer ordering. No source execution. Iframe/sentinels and modal Tab boundary are explicitly H3, including Escape forwarded only by trusted bridge.

## 4. Complete UI/state contract

“Joe” below means the person using their private chat, including staff. Tool-time rejections do not create versions/cards; only the explicit failure event below has a human transcript presence.

| Audience / state | Exact words and controls | Behavior |
|---|---|---|
| Joe · empty | **No canvas yet. Ask for a diagram, a page, or a floor plan.** | Example fills composer and switches to Chat; no send. |
| Joe · loading | **Loading canvas…** / **Opening diagram…** / **Opening page…** / **Opening floor plan…** | Cancel on thread change. After 10 s: **This is taking a while. [Try again] [Code]**; renderer has separate 3 s budget. |
| Joe · creating/updating | **Claude is making a canvas…** / **Claude is updating this canvas…** | Only actual tool activity; current working version stays visible. |
| Joe · success | **Diagram · Version {n} of {count}** / **Page · Version {n} of {count}** | Floor uses its sole design number (§7). No safety/approval badge. |
| Joe · newer commit | **Version 3 is ready [Latest]** | Follow latest defaults **on** when opening newest; successful complete versions replace it without focus change. Selecting older turns follow off. Latest turns it back on. Reduced-motion skips transition. |
| Joe · syntax error | **Couldn't draw this diagram. Its code is below. [Copy code] [Ask Claude to fix it]** | Escaped code + bounded plain diagnostic; no Try again for deterministic syntax error. Prefill `Fix the "Permit steps" diagram (version 2). The error was: …` then focus Chat, no send. |
| Joe · renderer timeout/complexity | **This diagram is too complex to show here. [Code] [Ask Claude to simplify it]** | Destroy frame, keep prior working version. Try again only for transient timeout/load failure; never automatic loops. |
| Claude · tool size/grammar/kind rejection | `CONTENT_TOO_LARGE` / `UNSAFE_CONTENT` / `UNSUPPORTED_KIND` with bounded limits/rule | No version, no preview, no human control promising a smaller version exists. Model revises or falls back to text. |
| Joe · agent gives up after rejection | **Claude couldn't make this canvas (too big). It's still in the chat as text.** | Fixed reason **too big / not supported / not allowed**; trusted runner terminal fallback event, grouped with reply, not model-invented card. Runner instructs text fallback and appends line; never echoes rejected content itself. |
| Joe · accepted page no longer displayable | **Claude's page couldn't be shown. [Ask Claude to try again]** | Show Code; repair notices are log-only. Keep last working version. |
| Joe · network/offline | **Couldn't load canvas. [Try again]** / **You're offline. Reconnect to load or save this canvas.** | Existing validated view may stay until auth/revocation; no persistent offline cache. Disable server actions. |
| Joe · expired | **Sign in to open this canvas. [Sign in]** | Clear frame/code; URL contains ID only. |
| Joe · unavailable | **This canvas isn't available to this account. [‹ Chat]** | Same 404 for missing/denied/deleted/revoked; no title/owner. Known deletion event in own authorized thread displays generic deleted card. |
| Joe · disabled | **Canvas is turned off. Your saved project files are still available.** | Master denies source/preview; generic cards only; availability arrives even with no events. |
| Both · version conflict | **A newer version was saved. [Latest]** / `VERSION_CONFLICT` | No overwrite; human restore reconfirms latest base. |
| Joe · saving / saved | **Saving to Larson bath…** / **Saved to Larson bath files. [Open file]** | Capture selected version, disable repeat; replay same policy returns same file and **Already saved to Larson bath files.** Card adds **Saved to Larson bath**. |
| Joe · save failure / policy conflict | **Couldn't save to project files. [Try again]** / **This version is already saved with different access. [Open file] [Cancel]** | Same ID on retry; never silently change access. Link only if current viewer can read saved file. |
| Joe · project gate | **Project access is needed to save this canvas.** / **Choose a project.** | Explain beside disabled Save; never infer destination from route. |
| Joe · copy | **Code copied.** / **Couldn't copy. Select the code and copy it.** | Preserve selection. |
| Joe · download / print | **Couldn't prepare the file. [Try again]** / **Printing didn't open. [Open print view]** | Cancellation is not successful print. |
| Joe · floor missing/stale | **This floor plan isn't available. [Open project]** / **The floor plan changed. [Load latest]** | No stale editing. |
| Both · quota | **This chat has reached its canvas limit. Save what you need, or start a new chat.** / `QUOTA_EXCEEDED` | Preserve history; tool gets precise cap/retry time. |

### 4.1 Canvas picker, versions and cards

Header title **Permit steps ▾** opens **Canvases in this chat**, ≤20 canvases, 56 px rows: type icon, title, **Version n**, time, current tick. Canvas segment opens last canvas viewed in this tab/thread, else newest; without a selection it shows this list, or empty state. Example:

```text
┌ Canvases in this chat ─────────────────────────┐
│ Workflow   Permit steps   Version 3   2:14 PM ✓ │
│ FileText   Permit notes   Version 1   1:48 PM   │
│ LayoutGrid Kitchen layout Floor plan · v5      │
└───────────────────────────────────────────────┘
```

Version history: number, **change_note**, maker and time, e.g. **Version 3 · Moved inspection before closeout · Claude · 2:14 PM**. Show note under title on non-latest version; summary remains text alternative. Phone/iPad list is bottom sheet, 56 px rows, 20 per page. Previous/Next aria-label **Previous version / Next version**; disabled **No earlier version / No newer version**. Comparison means reviewing the notes and stepping between full snapshots; no unpromised pixel diff. **Use this version** confirms **Make Version 1 the latest? Your newer versions will stay. [Use this version] [Cancel]**, appends Version 4 with restored_from=1. Floor list uses only design v numbers (§7).

Card anatomy: `Workflow` (Diagram), `FileText` (Page), `LayoutGrid` (Floor plan), serif title, **Diagram · Version 2**, one-line clamped summary, 44 px **Open canvas**. Accessible name **Open canvas: Permit steps, diagram, version 2**. In a wide pane already showing it, button **Showing**, disabled; older-version card may still explicitly open its version. Failed run retains **Canvas saved before the run stopped.** Deleted card **This canvas was deleted.** Card is between matching reply bubble and RunReview; while running it sits beside activity, never inside Markdown. RunReview Changes: **Made canvas "Permit steps" · Version 2**, **Saved to Larson bath files** only from committed events. Group stable run/canvas cards per §5.4; a stopped/no-reply run retains a standalone timestamped card. Human actions get standalone actor/time cards.

### 4.2 Final Save dialog, per audience

**Joe saving own canvas:** title **Save to project files**; **Canvas: Permit steps · Version 2**; **Project** uses existing `JobPicker` filtered to accessible projects, 16 px search; filename `Permit steps (v2).html`. Radio **Share with staff (default, Joe decision 9)** / **Only Joe**. With Share selected the sentence reads **Staff with these areas can read this copy.**; with Only Joe it reads **Only Joe can read this copy.** Share shows the required-area checklist with effective requirements including money areas pre-ticked; only Joe may explicitly confirm a weaker audience restriction as an audited sharing decision (§8.4). Copy **Staff with these areas can read this copy.** Always **It won't appear on the client portal.** Buttons **Save / Cancel**.

**Staff:** same fields, no audience control, **Joe and staff with {areas} can read this copy.** Areas use current effective policy, sorted catalog names (e.g. Money, Bidding), not model labels alone. Canvas stays private to chat's person. Project folder may preselect but must be visible/confirmed; cross-project choice does not refile thread. Lead thread: **Leads can't hold canvas copies yet. Pick a project, or download it.** No project creation in dialog.

```text
360 Joe (full sheet)                  1280 Joe (centered dialog, ~480)
┌ Save to project files ─────┐        ┌ Save to project files ───────────────┐
│ Canvas: Permit steps      │        │ Canvas: Permit steps · Version 2     │
│ Version 2                 │        │ Project [Larson bath ▾]              │
│ Project [Larson bath ▾]   │        │ Filename [Permit steps (v2).html]    │
│ [Permit steps (v2).html]  │        │ ◉ Share with staff    ○ Only Joe     │
│ ○ Only Joe                │        │ Staff with these areas can read this copy.         │
│ ◉ Share with staff        │        │ It won't appear on the client portal.│
│ Staff with these areas can read this copy.│       │                    [Cancel] [Save]  │
│ It won't appear on the    │        └────────────────────────────────────┘
│ client portal.            │
│ [Cancel]          [Save]  │        Staff variant, both widths:
└──────────────────────────┘        same fields; audience radios replaced by
                                   Joe and staff with Money, Bidding can
                                   read this copy. Portal sentence unchanged.
```

## 5. Agent contract, registration, identity, and polling

### 5.1 Tool names and exact input contract v1

Implement Zod strict objects/discriminated unions, no coercion and no unknown keys. UUID means validated UUID string; all byte sizes are UTF-8, not JavaScript string length. Tools accept **no user ID, role, run ID, conversation ID, arbitrary URL, file path, or CSP option**. Trusted transport binds those separately.

Common content union, called `content` below:

- `{kind:"diagram", source:string}`: 1–32,768 bytes; supported first statement `flowchart`, `graph`, `sequenceDiagram`, or `stateDiagram-v2`. Reject frontmatter/config/init directives, `click`, links, image/icon registrations, custom layout loading, raw HTML labels, and unsupported diagram types. Token-aware checks, not a blanket substring ban on words inside labels. Structural limits in §6.
- `{kind:"page", source:string}`: 1–262,144 bytes, accepted static HTML/SVG grammar in §6. Standalone SVG is allowed as the body of a page; it is not an XML document with external entities.
- `{kind:"floor_plan", design_id:decimal bigint string, expected_design_rev:nonnegative integer}`: actual bigint ID/rev, not an iframe URL. Derive project/lead from design. No source/ops in this tool.

| Tool | Exact schema | Result |
|---|---|---|
| `show_canvas` | `{request_id:UUID,title:string(1..80 chars),summary:string(1..500 chars),required_areas:PermissionKey[0..all,unique],project_slug?:string(1..120),content:Content}` | Create canvas + version 1, bind to current run's thread/principal. `required_areas` records sensitivity, never grants access; server adds `projects` for project/floor refs. |
| `update_canvas` | `{request_id:UUID,canvas_id:UUID,base_version:int>=1,title?:string(1..80),summary:string(1..500),change_note?:string(1..120),required_areas?:PermissionKey[],content?:Content,restore_version?:int>=1}` | `change_note` required for content update, optional for restore (server fallback “Restored Version n”). Exactly one of `content` or `restore_version`. Kind/project/principal/thread cannot change. Areas may only expand. Append full version; restore copies previous accepted payload, rechecks current sanitizer and permissions. Floor `restore_version` rejected. |
| `get_canvas` | `{canvas_id:UUID,version?:int>=1,include_source?:boolean=false}` | Authorized metadata, version, summary, content kind, project/design ref. Source only on explicit request, treated as untrusted data; no preview tokens/HTML rendered in tool results. |
| `list_canvases` | `{cursor?:string(1..256),limit?:int(1..20)=20}` | Current thread only, most recently updated first; cursor opaque/bound to thread. No across-user search. |

Mutation success envelope: `{ok:true,canvas:CanvasMeta,selected:VersionMeta,changed:boolean,card:{canvas_id,run_id,version},href:"/panel/canvas/<id>?v=<n>",availability:Availability}` (§5.5). Read/list use the exact §5.5 shapes. Exact read/list/source response types are in §5.5; mutations return no source. A replay with the same `(thread_id,request_id)` and request hash returns the original committed version IDs even after a newer update exists, subject to current authorization/availability and stricter-policy response checks. Same key/different hash fails. Equal source with a **new** request ID still makes a version: every successful update is a version. Creation limit failures do not consume an idempotency key.

Errors: MCP `isError:true`, text JSON `{ok:false,code,message,retryable,details?}`. Internal/browser HTTP use matching codes:

| Code | HTTP | Meaning / recovery |
|---|---|---|
| `CANVAS_DISABLED` | 503 | Flag/gate off; retry only after enabled. |
| `AUTH_REQUIRED` | 401 | No active verified person. |
| `CANVAS_UNAVAILABLE` | 404 | Missing, wrong thread/user/project/area, deleted, or denied version; indistinguishable outwardly. |
| `RUN_CONTEXT_REQUIRED` | 403 | No matching live panel run/thread/principal, or unattended invocation. |
| `INVALID_INPUT` | 400 | Shape/title/union/cursor invalid, with field names only. |
| `UNSUPPORTED_KIND` | 422 | Type/diagram family not supported; disabled supported kind uses CANVAS_DISABLED. |
| `UNSAFE_CONTENT` | 422 | Forbidden static syntax/config/link/CSS; `details.rule` is a fixed enum. |
| `CONTENT_TOO_LARGE` | 413 | `details:{max_bytes,received_bytes}`. |
| `TOO_COMPLEX` | 422 | Node/edge/depth/element/path limit; counts only. |
| `VERSION_CONFLICT` | 409 | Base stale; authorized `details.latest_version`. Read/decide/retry; never auto-overwrite. |
| `DESIGN_CHANGED` | 409 | Floor rev no longer matches; fetch existing design and deliberately update. |
| `IDEMPOTENCY_CONFLICT` | 409 | New request ID required for different work. |
| `QUOTA_EXCEEDED` | 429 | Per-thread/run/user cap; limits/retry-after if temporary. |
| `RENDER_FAILED` / `RENDER_TIMEOUT` | client only | Source still saved; no false server render-success state. |
| `EXPORT_NOT_READY` | 409 | No validated SVG for this version yet; open/render it first. |
| `SAVE_FAILED` / `INTERNAL_ERROR` | 500 | Safe message/correlation ID, no source/SQL/stack/secrets; retry same request ID. |

### 5.2 Where tools run

### Trusted stdio admission (required, not an assumption about headers)

The real runner loads run/user at `scripts/run-claude-agent.mjs:829`, constrains profile at `:843`, creates a **per-run** sjcos Node stdio process in MCP config at `:927`, and passes `SJC_RUN_ID`, `SJC_CONVERSATION_ID`, `SJC_PRINCIPAL_USER_ID`, `SJC_RUN_PROFILE`, `SJC_RUN_STARTED_S` via Claude child env at `:975`. Staff child env is minimal, but sjcos itself reads `.env.local` for its DB/CRON secret. Those tags already exist; no model-supplied identity argument is needed. Current `principalPayload` does **not** carry the conversation, so Canvas must reload it by run ID; do not invent a current session object containing it.

Change `buildServer` to accept a **private construction-time** `transportKind:'stdio'|'http'` from actual bootstrap at `mcp/sjcos-mcp.mjs:3060`; HTTP session creation must pass http explicitly. It cannot come from MCP params/headers/ALS principal fields. Register the four tools exactly once with `registerCanvasTools(server,{json,canvasCall})`. On HTTP, discovery may list them as unavailable, but **canvasCall rejects RUN_CONTEXT_REQUIRED before principalPayload/internalCall**, even with a valid MCP_HTTP_TOKEN and exact real active panel user/run/profile headers. Defense in depth: guard rejects when HTTP ALS is present, even in a misconstructed stdio server. HTTP never falls back to stdio env. Runner config explicitly sets `MCP_HTTP_PORT=0` for its sjcos child so inherited HTTP service env cannot change transport. Bare stdio without admitted env/run also fails. Tests must spy that no internal fetch occurs for HTTP rejection.

For stdio, capture env tags once at process startup in a private closure (not tool-call payload). Reload the run/conversation/user, derive thread from `run.conversation_id`, require all five identity tags and compare user/profile/start/thread to DB values (start seconds use the runner's same extract(epoch)::bigint derivation), and require `launch_source` one of panel_web/panel_mobile/panel_voice, pending/running status, undeleted owned thread, correct named active person, current areas and session revocation after trusted DB run start. Role/profile/ownership come from DB, not env claims. Cross-thread resume cannot enter this closure. No “latest thread” fallback.

The closure forwards to `POST /api/internal/canvas` with strict `{action,input,context:{run_id,principal_user_id,run_profile,run_started_s,transport:'runner_stdio'}}`, created after validating tool input and **outside** any input spread. Tool schemas cannot accept context/action overrides. Internal call uses constant-time CRON_SECRET bearer validation; only this closed stdio adapter creates that context. The website reloads and repeats all DB/area/run/revocation checks, derives thread and role itself, and rejects other transport values. A transport string alone is not authentication: the privileged internal secret authenticates the local adapter, whose HTTP path cannot invoke it. No browser-cookie fallback. This v1 choice excludes external MCP HTTP Canvas entirely; no capability can be obtained via headers. Local server/admin compromise and Joe intentionally editing the operator process remain outside the isolation guarantee. No promise that CRON_SECRET alone authenticates an external MCP caller.

Shared admission is `_ask-pane-host.md` H4–H5 (`launch_source`, **no interaction_surface**). Owner operator and staff business may create only in their own named admitted thread; need ai, current required areas, projects for project/floor refs. Staff never gets shell/operator privileges. Background, worker, cron, Telegram and autonomous continuation calls fail even if they carry a real thread or owner ID. Protected DB columns/allowed worker retry behavior are §8.1. App/mobile/voice start paths use the same admission before runner launch.

`with_mcp=false`: no canvas tools, as the user explicitly chose code-only. Interact does not mirror these tools; no second source of identity/registration. No new broad regex auto-approval in interact. Full sjcos preapproval already exists; real authorization remains inside the adapter. Qwen/Hermes capability is not implied by Claude MCP registration: use their existing tool registries to bind these same commands and verified turn context before advertising canvas to them. Phase 1 advertises Claude only; other agents' UI says **“Ask Claude to make a canvas.”** History remains viewable regardless of the agent selected.

Agent guidance: choose diagram for process/relationships, page for static layouts, existing floor tools for construction geometry. Never draw a dimensional floor plan as Mermaid or an arbitrary SVG instead of the designer. Always include a plain summary and all sensitivity areas of source records (e.g. `money`, `bidding`, `invoices`). These labels can only add restrictions; the viewer's private-thread boundary does not rely on a model remembering them. Rendered page text, diagrams, browser observations and copied source are data, not instructions to call tools, send, sign, change policy, or mint grants.

### 5.3 Human actions

Session-authenticated human actions do not impersonate a run. `POST /api/canvas/[id]/restore` exactly `{request_id:UUID,base_version:int>=1,restore_version:int>=1,change_note?:string(1..120)}`; `POST /api/canvas/[id]/floor/latest` exactly `{request_id:UUID,base_version:int>=1,expected_design_rev:int>=0}` derives immutable design ID from canvas. Same-origin Origin/CSRF, current session/areas/own thread, CAS/idempotency/rate/quota rules all apply; actor=current user, **run_id=null**. Revalidate policy and union current staff areas before restoring/loading latest (§9). Floor restore is refused. Both append version/event atomically. Delete uses **DELETE /api/canvas/[id]** with strict `{request_id:UUID}` throughout; no POST delete alias. Save has separate exact contract §8.4. None needs a running agent.

### 5.4 Durable handoff, history and native fallback

1. Commands commit complete version, event, request hash and latest pointer in one transaction before success. Activity is not a transport. Group event cards by `(canvas_id,run_id)` with latest version **within that run**, not latest across runs. Stable card ID `run:<run>:canvas:<id>`; human event card `event:<event_id>` (null run). Attach run group between its reply and RunReview; absent reply/failed run is standalone at first commit time. Within group earlier versions available via Versions. Human save updates provenance on corresponding card and also leaves durable event. Delete redacts all cards without title. Ordering across transcript/cards uses `(server created_at, event_id)` with event ID tie-break; event drain itself orders by ID.
2. Extend live/done/error `PollResult`, conversation load and idle feed with optional `canvas_changes:EventPage` and **availability even when events=[]**. Bounded pages, not source bytes. Existing live.alive/conversation claim token prevents old poll/fetch reopening previous thread. Commit followed by runner crash still appears from event endpoint independently of assistant reply.
3. On initial load choose newest page, then drain forward to its terminal cursor; backward pages load older card groups alongside transcript. Group upserts merge versions by stable identity; a group split across pages never duplicates. After terminal run response continue GET after=cursor until has_more=false, even if >20 events or runner errored. Human events appear through same idle feed. No terminal unbounded payload or MCP list-as-history substitute.
4. Active refresh 2 s, visible idle/standalone 30 s, on focus immediately; pause hidden, unmount frames on hide, reauthorize before redisplay. Availability changes close frame/source without needing a new event. User/thread switch or logout clears immediately. Follow latest only after complete commit. Pointer state `{conversationId,canvasId,selectedVersion,followLatest,activePane}` scoped to person/tab; no source/title/capability or private bus mirror.
5. Mobile uses `lib/mobile-rpc/operator-reads.ts` shared authorized event command, exposed as `operator.canvasEvents` with same cursor fields and response, and matching optional metadata on operator conversation/poll. Until native cards ship, the **mobile API adapter** (not saved shared transcript) appends once per canvas/run group to returned reply body: **Canvas: Permit steps · Version 2 — open it in the web app.** For no-reply failed run, append to its returned error/fallback body. Old clients see this plain line, new clients may suppress when rendering optional cards. Card ⋯ offers **Open in Safari**, authenticated web wrapper URL, web login required, no bearer token in URL. Mobile repo change is a later explicit handoff, not assumed in this worktree.
6. Rejection fallback: runner records bounded rejection reason for latest failed canvas attempt per run. Subsequent successful create clears it; if it gives up, persist `rejected` event with no canvas/version ID and fixed reason (`too big|not supported|not allowed`) plus text fallback reply. No rejected source is stored. Reload/history/mobile can show §4 copy even when no canvas was created.

### 5.5 Exact reads, cursor and capability contract

Types here are **wire proposals**. UUIDs strings; bigint IDs serialized decimal strings; times ISO8601. Every success `{ok:true,...}`; every error `{ok:false,code,message,retryable,details?}` with §5.1 status mapping. No raw source in metadata.

- `Availability={revision:string,master:boolean,diagrams:boolean,pages:boolean,floor:boolean,exports:boolean,staff:boolean,source:boolean}` is effective for current person, not raw settings. `master=false` → generic cards only, no titles/code; kind false → authorized metadata/code only if source incident policy allows; exports false → disable creation/download/save; staff false for staff → same as master off. Revoked session 401 clears everything; loss of thread/required area is generic 404. On master/staff-off, object get/list/version reads return 503 CANVAS_DISABLED (no title), while event feed/poll still return Availability plus redacted events so mounted clients close; kind-off metadata allowed only under effective source policy. Cards may carry availability before any metadata is delivered.
- `CanvasMeta={id,thread_id,user_id,created_run_id,kind,project_slug:null|string,lead_slug:null|string,latest_version:int,created_at,updated_at}`. `VersionMeta={version:int,title,summary,change_note,actor:{id,name},run_id:null|UUID,created_at,restored_from_version:null|int,design:null|{id:decimalString,snapshot_id:decimalString,number:int,rev:int}}`. Metadata text lengths use §8.2 caps.
- `GET /api/canvas/[id]?version=n` returns `{ok:true,canvas:CanvasMeta,selected:VersionMeta,availability,capabilities:{preview:boolean,code:boolean,download_formats:string[],save:boolean,restore:boolean,load_latest:boolean},preview:null|{mode:'diagram_renderer'|'static_page'|'floor',href:string|null,renderer_version:string}}`. Default latest; specified old version is never replaced with latest. href is an ordinary authenticated same-origin route, **not bearer/signed capability**. Renderer bootstrap response contains no source; floor loader independently authorizes.
- `GET /api/canvas/[id]/versions?before=n&limit=1..20` returns `{ok:true,versions:VersionMeta[],next_before:int|null,availability}` descending version order, strictly `<before`, default newest. Previous/Next use known version numbers/this pagination.
- `GET /api/canvas/[id]/versions/[version]/code` returns `{ok:true,canvas_id,version,kind,code:string,sha256:string,untrusted:true,availability}` for diagram/page only; exact stored source for **selected** version, ≤256 KiB. Source disabled → 503 CANVAS_DISABLED; floor → 422 UNSUPPORTED_KIND. Explicit MCP get include_source=true adds this same code object, quoted untrusted. MCP get otherwise returns same metadata/capabilities; no preview credentials or raw preview HTML in tool output.
- `GET /api/threads/[id]/canvases?cursor=<opaque>&limit=1..20` returns `{ok:true,canvases:{canvas:CanvasMeta,latest:VersionMeta}[],next_cursor:string|null,availability}` newest `(updated_at,id)` first; thread-bound cursor. MCP `list_canvases` calls this command with the same max-20 limit; no cross-thread search. Canvas picker max 20 items.
- **Event feed** `GET /api/threads/[id]/canvas-events?after=<cursor>&limit=1..20` OR `before=<cursor>`, never both. Neither = newest page returned ascending for display. `EventPage={events:CanvasEvent[],cursor:string,next_before:string|null,has_more:boolean,availability}`. Forward `after` exclusively > ID, ascending, cursor last scanned ID; backward exclusively < ID, fetch descending but return ascending, next_before oldest scanned; cursor remains forward high-water. Empty forward page echoes input high-water. Newest page has cursor=current high-water; before controls older history. `has_more` describes requested direction. Max **16 KiB serialized metadata page**; stop before next row would exceed; event fields capped to ensure one fits. No gaps from byte truncation. Cursor encodes version/thread/person/direction/high-water or boundary with server HMAC, ≤256 chars; wrong thread/person/direction/malformed → 400 INVALID_INPUT without existence leak. Auth before cursor diagnostics. Reauthorize each page. Deleted event redacts IDs/titles as appropriate; retention may remove purged entries, so scanning uses retained IDs and advances safely.
- `CanvasEvent` discriminated union: `{id,thread_id,run_id:null|UUID,actor_user_id,at,kind:'created'|'updated'|'restored'|'floor_latest',canvas_id,version:VersionMeta}`; `saved` adds canvas_id/version/file_id/project_name/effective_policy (only if file readable); `deleted` has canvas_id only; `rejected` has run_id + fixed reason, canvas_id=null. All events include `group_id:string` as stable group ID and no source. Joins resolve metadata **after** access checks; deleted content never returns stale version metadata. Add redacted union `{id,thread_id,run_id,actor_user_id,at,group_id,kind:'unavailable',canvas_id:null|UUID}` for master/staff-off or revoked-object history: no title/version/source or underlying reason. Same EventPage used by run poll/history/mobile, no duplicate definition.

Add errors: `RENDERER_HASH_CONFLICT` 409 (different accepted derivative hash, preserve original), `SAVE_POLICY_CONFLICT` 409 (existing generation policy differs, preserve copy), `FILE_RESTORE_CONFLICT` 409 (active replacement generation), `CANVAS_DISABLED` 503 for master/kind/export gate with safe fixed gate name, `CANVAS_UNAVAILABLE` 404 for denied/deleted object. Code/preview/render/save/download apply the same flags; no auth redirect rendering full app into frame. Per-canvas metadata reads ≤16 KiB, versions pages ≤16 KiB, code response ≤1.6 MiB serialized JSON (source itself ≤256 KiB; JSON escaping counted); all private/no-store, no CORS. Raw previews/render/download return fixed MIME/headers (§6), errors keep those security headers. GET/list wrap canonical shared command responses; no ambiguous “appropriate shapes”.

## 6. Rendering and exports

### 6.1 Library and client cost — measured, not a guessed entrypoint size

`package.json` currently has no Mermaid, markdown-HTML, browser screenshot, or canvas-export library. It already has `sanitize-html`, `htmlparser2`, `sharp`, `pdfkit`, and Next/React. Use those installed packages for validation/storage where appropriate. Do not add html2canvas, a browser runner, or a second SVG drawing framework.

Pin **`mermaid: "12.3.0"`**, without a caret, plus the lockfile. Verified 2026-11-05 with `npm view mermaid version dist.unpackedSize dist.tarball` and by streaming the official npm tarball through Python tar/gzip without installing anything:

| File | Uncompressed bytes | Gzip bytes (mtime=0) | Loading decision |
|---|---:|---:|---|
| `dist/mermaid.min.js` | 5,537,838 | 1,580,013 | Standalone browser bundle, zero `import(` occurrences; selected for a closed network renderer. |
| `dist/mermaid.esm.min.mjs` | 30,936 | 11,574 | **Not** the total library: 37 dynamic imports. Do not advertise 11 KB as the cost. |
| Entire npm package | 123,623,192 unpacked | Not a client payload | Build/server installation cost only. |

Use the standalone bundle in a dedicated raw renderer document, loaded **on demand on the client when a diagram opens**. It adds zero Mermaid bytes to Chat's initial JS and renders nothing on the server. `next/dynamic(() => import('./CanvasPane'),{ssr:false})` in a Client Component loads the small pane host; Mermaid itself is not a parent-document import. The raw renderer route inlines a verified local standalone bundle plus the fixed bridge with exact build-time CSP SHA-256 hashes. Packaging asserts that neither trusted script contains a literal HTML script-end token; any necessary reviewed serialization happens before hashing. Canvas source is never interpolated into either script. No CDN, runtime module imports, runtime package fetch, eval, wasm or dynamic plugin loader. Validate the bundle actually works under this CSP in the coordinator's release check. A failure is a release blocker, not grounds to add `unsafe-eval` or network access.

Implementation copies the pinned distribution into a server-only renderer asset at build/package time, verifies its package integrity/hash and includes it in Next output tracing (raw fs assets are not automatically guaranteed in standalone packaging). Cache only these **public code bytes** in server process memory, once; never cache private preview responses. Budget ≤1.7 MiB gzip library + bridge per cold diagram opening, zero renderer bytes when Canvas stays closed. Compression must be verified on the deployed route; raw fallback is 5.54 MB, not a fictional gzip saving. One selected renderer at a time; version navigation replaces it. No package install/build occurs as part of drafting this plan.

Primary references: [Mermaid securityLevel](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html), [secure config keys](https://mermaid.js.org/config/schema-docs/config-properties-secure.html), [Mermaid config schema](https://mermaid.js.org/config/schema-docs/config), and [npm package metadata](https://registry.npmjs.org/mermaid/12.3.0). Strict mode encodes labels and disables clicks; it is one layer, not the isolation boundary.

### 6.2 Level 1: diagram pipeline

1. Server enforces UTF-8/input/family limits and rejects author configuration, raw HTML, click/link/image/icon directives, author style/classDef/linkStyle directives and extra resources before storing the whole source. Use a lexer-aware validator with quoted-label fixtures. Allow ordinary graph/sequence/state relationships, plain labels and comments. Block YAML frontmatter and `%%{...}%%` directives at every position, including mixed-case/whitespace forms.
2. On user opening it, create an iframe `sandbox="allow-scripts"`, **without `allow-same-origin`**, loading `/api/canvas/renderer`. This document contains only trusted code and no canvas data in its URL/HTML. It has the script-enabled CSP below. Do not give it app credentials/tokens.
3. Parent and fixed bridge establish a fresh MessageChannel. Initial ready/handshake validates `event.source === currentFrame.contentWindow`, expected `event.origin === 'null'`, renderer instance ID and random 128-bit channel nonce. Null origin is expected and is **not** sufficient authentication by itself. Transfer a port to that exact frame; subsequent messages use the port, bounded schemas, sequence/version IDs and timeouts. Parent never accepts arbitrary global `message` commands. Cleanup closes ports and removes frame on switch, logout, hidden pane, timeout or disposal.
4. Send only selected source/title/summary over the channel. Bridge invokes `mermaid.initialize` with `startOnLoad:false`, `securityLevel:'strict'`, `htmlLabels:false`, fixed token theme/system font (§3.2), `suppressErrorRendering:true`, `maxTextSize:32768`, `maxEdges:200`. The `secure` set includes these keys plus theme, themeCSS, fontFamily, layout and htmlLabels. Never apply source frontmatter/config or `bindFunctions`. No registration of custom icons/diagrams from source. Renderer preflight caps **100 nodes, 200 edges, nesting 12**; sequence/state equivalents cap participants/states at 100 and statements at 400. Server lexical ceilings are an early rejection; client parser/model counts must pass too.
5. Render into the isolated iframe DOM only. Strict output plus a restrictive SVG sanitizer before display rejects foreignObject, event handlers, scripts, external references, anchors and URL-bearing CSS. Rebuild allowed SVG nodes/attributes from parsed data, not string replacement. Keep only local fragment references to IDs existing in that SVG, with a per-render ID prefix. To retain appearance after dropping Mermaid stylesheet blocks, translate the fixed theme/classes into allowlisted SVG presentation attributes; author CSS never reaches the export. Golden fixtures compare labels, arrows, colors and text bounds before/after sanitation. No SVG ever enters `AssistantMarkdown` or the application DOM through `dangerouslySetInnerHTML`.
6. Parent watchdog gives rendering 3 s after receipt of source, then destroys the frame on timeout. This bounds recovery attempts; an iframe is **not guaranteed a separate CPU process**, so it is not a hard browser memory/CPU limit. Small input/graph limits are primary protection against UI hangs. No renderer on the server and no Chromium process. If acceptance fixtures still stall phones, lower limits; don't claim the timeout can preempt a blocked browser thread.
7. Bridge returns `{type:'rendered',canvas_id,version,instance_id,svg,width,height}` or fixed-code error only. SVG output ≤512 KiB, ≤10,000 elements, ≤100,000 aggregate path points/commands, depth ≤32, finite viewBox dimensions ≤8192. Parent treats the message as untrusted: validate schema and submit the SVG to the server export validator. Client success means preview available, not changed business records. Per-version SVG derivative is optional and immutable-by-hash once accepted; see §8.

### 6.3 Level 2: static HTML/SVG with no outbound channel

Preview route: **`GET /api/canvas/[id]/versions/[version]/preview`**, with normal user session auth and all canvas checks. It returns a complete HTTP document made from validated source plus fixed trusted viewport/measurement bridge. The bridge can report ready, document height, load error and trusted focus/Escape boundary events (shared H3), and receive print-layout instructions over its dedicated port; it cannot fetch, navigate, call app APIs, read cookies, execute source, forward clicks or request business actions. This fixed code is the only script permitted by hash. Agent JavaScript remains rejected. No interactive app runtime/CDN allowed.

A true opaque origin is produced by **both** iframe `sandbox="allow-scripts"` (trusted bridge only) and HTTP CSP `sandbox allow-scripts`; omit all other sandbox privileges. In particular never combine `allow-scripts` with `allow-same-origin` for an app-origin document. The initial same-origin authenticated GET naturally carries the user's cookie to the server for authorization; the resulting document has **no cookie/storage/app-origin access** and cannot send another credentialed request. Do not falsely promise the initial HTTP request is cookieless. It does not set or renew cookies. Do not use a bearer preview URL or a public signed-file URL as a shortcut.

**No `srcdoc`, data-URL or blob-URL HTML preview.** `srcdoc` inherits the parent CSP; a new route response supplies an independently enforced CSP without loosening the app policy. HTTP sandbox is needed even when someone opens the raw preview URL directly. [MDN sandbox directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) explains why a meta tag or Report-Only policy is insufficient.

Server allowlist (`lib/canvas-content.mjs`, plain Node/shared with tests):

- Parse HTML with installed `htmlparser2`, depth/element caps **32 / 5,000**. Allow document body content only: headings, p, div, span, section, article, header, footer, main, aside, ul/ol/li, dl/dt/dd, table/thead/tbody/tr/th/td/caption, pre/code, blockquote, strong/em/b/i, br/hr and inline SVG subset. Extract/escape title; ignore author doctype/head in favor of trusted wrapper. No XML declaration, entities/DOCTYPE subsets or base element.
- Reject script, link, style elements/stylesheet blocks, meta (including refresh), iframe/frame, object/embed, form/input/button/textarea/select, a/area, audio/video/source/track, img/image, foreignObject, use, animation/SMIL, filter/feImage, external SVG resources and all `on*` attributes. No custom elements. Inline SVG allows shape/text/group/defs/linearGradient/radialGradient/stop/clipPath/marker elements, fixed drawing attributes, local IDs; only `url(#local-id)` for permitted fill/clip/marker references after verified ID resolution. No external href/xlink:href of any scheme. Root SVG dimensions/viewBox finite and capped at 8192; path command and coordinate budgets match L1.
- Inline `style` only, using installed sanitize-html's `allowedStyles` with **anchored, per-property finite grammars**, backed by a validator. Allowed layout: static/relative positioning only, display block/inline/inline-block/flex/grid, flex wrap/direction/alignment, bounded gap/padding/margin, finite row/column counts, width/max-width/min-width/height/max-height, border width/style/color/radius, overflow auto/hidden, font family from a system-font enum, font size/weight/style, line height, text alignment/decoration, white-space and safe colors. Lengths are finite 0..8192px, 0..100%, 0..64rem; negatives only for SVG coordinates, not layout. No absolute/fixed/sticky/z-index overlays, viewport units, enormous repeat(), CSS variables, escaped identifiers, comments in declarations, calc/var/env/attr, custom properties, @rules, url except validated SVG local drawing attrs, image-set, cursor resources, imports, binding/behavior, transitions or animations. Reject unsupported properties/values instead of silently breaking the design. No style text copied unsanitized from source.
- Global attributes only `style`, bounded plain `title`, `role` from a small accessibility enum, `aria-label`, table spans ≤20, and validated SVG attributes. No arbitrary `data-*`, name/id DOM-clobbering hooks on HTML, tabindex/autofocus/contenteditable, download/ping/srcset/action/formaction/target. SVG IDs are rewritten consistently; no cross-document fragments.
- Reject any forbidden element/attribute/resource/config, rather than silently label a substantially stripped page “success”. Normal HTML parse repair is allowed; innocuous wrapper/closure repairs are log-only, never a “Page formatting was repaired” notice to the person. Store original source privately and canonical accepted content plus validator version separately. If a future sanitizer rejects an old version, show source/error; never fall back to original bytes.
- No raster images/data SVG/files in L2 v1. Inline drawing and system fonts avoid network, decoding bombs, path signing and cookie mistakes. This is an explicit product limit, not an unimplemented generic asset proxy.

### 6.4 HTTP policy and bridge boundary

Every renderer/preview response, including plain error pages, has:

```text
Content-Type: text/html; charset=utf-8
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy:
  sandbox allow-scripts;
  default-src 'none';
  script-src 'sha256-<fixed-bridge-hash>' [L1: also exact Mermaid bundle hash];
  script-src-attr 'none';
  style-src 'unsafe-inline';
  img-src 'none'; font-src 'none'; connect-src 'none';
  media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none';
  worker-src 'none'; manifest-src 'none'; base-uri 'none';
  form-action 'none'; frame-ancestors 'self'
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(),
  usb=(), serial=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=()
```

Square-bracket annotation above is documentation, not literal header syntax. Use separate precomputed exact CSP strings for L1 and L2. No `script-src 'unsafe-inline'`, `unsafe-eval`, wildcards, CDN, report endpoint containing content, or `allow-top-navigation`/popups/forms/downloads/modals/same-origin sandbox token. Plain error responses can use stricter `sandbox; script-src 'none'`.

`style-src 'unsafe-inline'` permits layout, not CSS resource fetches: the other directives still deny fonts/images/network. Sanitization separately removes self-navigation vectors (meta refresh, links, forms) because CSP **connect-src does not block all navigations** and sandbox alone permits some frame-self navigations. No reliance on unsupported `navigate-to`. The fixed bridge never navigates; no model script can run. All app APIs keep CSRF/auth checks: the canvas cannot become a bypass even if a future browser bug allows an attempt. No cookies/CRON secret/MCP token/owner grant in child HTML, CSP nonce, source-map URL, message, query string or logs.

**Implement outer headers in `next.config.ts` `async headers()`**, matching `/panel/canvas/:path*` (includes `[id]` and `[id]/print`, errors/redirect responses): `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Add matching explicit private/no-store header handling for this path in `proxy.ts` on **each** response branch (including redirects/errors); the pages call session/ownership helpers, use `dynamic='force-dynamic'`, and all reads are uncached. Next may set/override Cache-Control on pages: verify final actual 200/401/404/redirect responses are private/no-store; if not, enforce at the same proxy response boundary and deployment proxy, never rely on page declarations alone. Only frame-ancestors is added to the trusted app wrapper CSP in v1, so React/Next assets and iframe route loading retain current app behavior. A future full wrapper CSP must allow required Next assets and isolated same-origin child routes explicitly. **Do not match `/api/canvas/*`** with wrapper frame-denial; renderer/preview raw Response handlers own their independent child CSP, including on errors. Only preview/renderer documents are embeddable in app. If a future global app CSP is added, explicitly allow this route as a frame source; never weaken child policy or use `srcdoc` to bypass it. No CORS access from opaque/null origins to app APIs or private content. The measurement bridge reports `height` clamped to 8192 and booleans only, throttled to 5/s; focus/Escape boundary messages from trusted bridge are the additional control-only messages allowed by shared H3; parent ignores source-provided message-like markup and all action/save/approve/navigation requests. L1's SVG export is the only bounded content reply allowed. Same UI component/instance checks apply to error, height, ready and export messages.

### 6.5 New tab, download, copy, save and print

**Open in new tab** always opens trusted `/panel/canvas/<id>?v=<n>` with `target="_blank" rel="noopener noreferrer"`, using its own auth/permission check. It never opens unwrapped agent HTML, and popout navigation capture must respect it. A direct raw preview URL is sandboxed by response headers but contains no app controls. Diagrams/pages have **no Copy link in v1**; share internally through Save to project files. Private deep links never grant another person access. Floor Copy link remains canonical `/floor/<id>` under floor access rules.

| Type | Download / Copy | Save to project files | Print / Save PDF |
|---|---|---|---|
| Diagram | **Drawing (SVG)**, **Picture (PNG)**, **Diagram code (.mmd)**; **Copy code** | Static `.html` containing validated SVG, title, plain summary, version/date; optional escaped source in a collapsed section. No Mermaid script/dependency in saved file. | Trusted print wrapper with static SVG and summary. |
| Page (includes raw SVG page) | **Page (HTML)** (canonical static content, no script); **Copy code**. No PNG or SVG extraction promised for mixed HTML. | Canonical static `.html`, no trusted bridge. | Same print wrapper containing sandboxed static page. |
| Floor plan | **Open floor plan** to use existing capture/sheet outputs; **Copy link** to its existing designer/version. No raw PlanDoc copied by Canvas UI. | **Open floor plan**; save through existing capture/sheet path, preserving plan/version association. Canvas does not fake a file by writing its JSON. | Existing sheet/print workflow, no second renderer. |

Diagram PNG: use only the **server-validated** SVG as an image in a client canvas, draw at max 2048×2048 preserving aspect ratio, total ≤4 megapixels; `toBlob('image/png')`, revoke object URLs. No html2canvas or server screenshot. If browser SVG decoding/canvas export fails, offer Drawing (SVG), no placeholder PNG. The response content type/disposition is fixed by the server, sanitized filename, attachment on download. Source .mmd is `text/plain` attachment. HTML and SVG download responses also carry strict `sandbox; default-src 'none'; style-src 'unsafe-inline'`, no scripts/network, plus nosniff; they are sanitized before download since headers do not accompany a copied file opened elsewhere.

**SVG derivative/export validation:** `POST /api/canvas/[id]/versions/[version]/render` accepts ≤512 KiB SVG from the trusted client's renderer, rechecks user/version/access/feature gates, and sanitizes/validates again on server. It is a derivative, not proof that source or measurements are true. Keep at most one accepted sanitized SVG hash per canvas/version/renderer version. A different upload after that returns `RENDERER_HASH_CONFLICT` (409); equal sanitized hash replay returns the existing derivative without new quota; no last-writer replacement of what someone already saved. Validate again before each export/save under current policy. Never server-render Mermaid or invoke sharp on an unvalidated SVG. Only the user-confirmed Save action can create a project-file record; merely uploading an SVG cannot publish anything.

**Print:** trusted `/panel/canvas/[id]/print?v=<n>` reauthorizes, pins the version, shows title/summary/date and the same isolated static preview. It removes app navigation and action buttons with print CSS. Its fixed measurement bridge reports the bounded page height, so the outer iframe is expanded before the outer window's own `print()` call; no cross-origin `contentWindow.print()` call or sandbox `allow-modals` exception. Wait for fonts (system only), SVG and bridge-ready; disable Print until ready. Printed document includes version and “Internal draft”; does not include the private chat. Safari/iOS multi-page iframe printing, page breaks and clipped tables are **release gates**; if a device cannot print embedded content reliably, the UI offers **Page (HTML)** with **“Open the file to print it on this device.”**, never a claim that a clipped print succeeded. No automatic PDF attachment; user chooses Save PDF in the device dialog. With source-only render failure offer source download instead.

Downloaded and saved content is static and sanitized, not the original untrusted source. Code is only a clearly labeled text copy/download. No client-facing Send/Publish action is added; existing project publication/sends retain their owner-grant requirements.

## 7. Existing floor designer, inline

Build `FloorCanvas.tsx` as an adapter around `components/floor/Designer.tsx`, not another SVG/CAD implementation and not an iframe of the entire OS shell. Extract a shared server loader from `app/(os)/floor/[id]/page.tsx` so both entry points apply the same projects-area check and data filtering. Dynamically load the client Designer only when selected, 2D plan mode initially; keep `Scene3DLoader` lazy and require an explicit user switch to 3D. Unmount when hidden to release WebGL resources. Only one designer/3D context per visible canvas. No new Node browser/GPU process.

Agent sequence:

1. Find an existing design via `list_plan_designs`/`get_plan_design`; create only if none fits the requested job/lead. `create_plan_design` uses actual `project_slug` or `lead_slug`, name, optional room template/dimensions in inches. No inferred dimensions from a decorative diagram.
2. `apply_plan_ops` must always pass `expected_rev` from the latest read (the current schema makes it optional; require it for panel-bound canvas work) and uses the existing rev guard and op names, e.g. `addRoomRect`, `addOpening`, `placeItem`; there are no new canvas drawing ops. Fix/restrict **floor MCP principal checks** before enabling staff L3: `registerFloorTools` currently receives rows/json without a per-principal gate. Named staff calls must recheck `projects`, design scope and rev on every read/write; unattended behavior outside Canvas is not broadened.
3. `show_canvas`/`update_canvas` with `content:{kind:'floor_plan',design_id,expected_design_rev}` locks that design, verifies rev and access, and pins an existing matching `plan_design_versions` snapshot or inserts one using the same immutable version mechanism. The snapshot and canvas version commit in one app transaction; no separate “save version” MCP round trip with a race. Snapshot number allocation locks design so concurrent calls cannot choose the same number; existing unique `(design_id,number)` remains. Source geometry exists only in `plan_design_versions.doc`; canvas stores its ID, not a duplicate doc.
4. Inline renders pinned snapshot via the same Designer with `readOnly=true`; hide editing, estimate generation, client publish, owner controls and autosave. Load only the allowed inspector data; catalog prices/cost rules/estimate targets require their existing money area independently. No raw price data in a “hidden” prop for staff lacking the area. Toolbar says **“Floor plan · Kitchen layout · v5”** (design number only) with **Edit floor plan**; never show Canvas version numbering for floors.
5. **Edit floor plan** opens canonical `/floor/<id>` (normal navigation in the app or new tab from the popout). Current editable doc and autosave/conflict handling remain there. Updating an old canvas never restores the live doc. If a new design rev appears, metadata shows **“The floor plan changed. [Load latest]”**; clicking appends a new canvas reference version after current-rev validation, rather than silently replacing the snapshot. Lost/unsaved designer edits retain the existing warning behavior.

Project Floor tab, Canvas, and agent tools therefore all refer to the same design ID, revisions, measurements, checks, saved sheets and client publication flow. Saving/publishing a sheet is not viewing a canvas. `stage_plan_sheet` still only stages a comment; publishing/signing retain existing grants. Floor plans attached to a lead keep the lead ref and require `leads` as well as `projects` for that scope; no automatic conversion to an unrelated project.

### 7.1 One design history, actual read-only chrome

Floor pane title/list/cards show **Floor plan · Kitchen layout · v5**, matching `DesignsStrip` chips. Canvas internal version integer still drives CAS/audit, but never appears as a second floor version. Version list shows distinct referenced design snapshots/notes, with design numbers; **Load latest** appends a reference, reuses matching design snapshot if one exists. If it already references current matching snapshot, return changed=false; no fake v6. Floor export/save opens existing capture/sheet workflow, not Canvas HTML Save dialog.

Current Designer readOnly disables tools but renders them; add explicit `embeddedPreview` prop to `Designer`/`TopBar` that **hides** tool groups/edit controls/inspector edits/estimate/publish/autosave, while leaving zoom/Fit and 2D/3D (3D only after tap). Server loader filters sensitive inspector data before props, and commands still reauthorize. Without projects area, show unavailable; never leak geometry through an Edit link. At 360, label **Edit on a tablet or computer** (canonical `/floor/<id>` link, same projects/scope check); page on phone is read-only viewing with that instruction, not an unusable tool palette. Authorized tablet/desktop gets **Edit floor plan**.

```text
360                                   1280 split / expanded
┌ Operator (sheet controls off) ┐      ┌ Chat ─────────┬ Floor plan · Kitchen layout · v5 ┐
│ Queue Chat Canvas Browser     │      │ Claude ▾      │ Versions ▾   2D [3D]   ⋯        │
│ ‹ Chat                        │      │ floor card v5 │      read-only geometry          │
│ Kitchen layout ▾              │      │               │ [−] [Fit] [+] [Edit floor plan] │
│ Floor plan · v5   Versions ▾  │      └───────────────┴─────────────────────────────────┘
│ 2D [3D]     floor preview     │      Exit per H1: split × / expanded Back to app.
│ [−] Fit [+]                   │
│ Edit on a tablet or computer ↗│
│ [Ask for a change]            │
└──────────────────────────────┘
```

### 7.2 Shared snapshot command and deletion

Proposed `lib/plan-version-writes.mjs:ensurePlanSnapshot(tx,designId,expectedRev,actor)` is the **one** design-row-lock and canonical hash/allocation command. Canvas calls it inside its transaction. Refactor **all** existing writers: `mcp/floor-tools.mjs` save_plan_version; `lib/actions/plan-designs.ts` savePlanVersion and restorePlanVersion's “Before restore” snapshot; capture/publish writers found by a repository INSERT scan at implementation handoff. Route direct MCP writes through the authenticated app adapter so it can see private Canvas references; no narrow SELECT grant to solve this.

Under `SELECT plan_designs FOR UPDATE`, validate current rev/scope, canonicalize migrated PlanDoc with stable key order, hash canonical bytes, and match existing immutable snapshot by same-design doc hash **and** current canonical bytes (hash collision fails closed). Add `doc_sha256`/`source_rev` to snapshots in 0109 with backfill/validation; hash nullable only during migration, never for new pins. Match uses doc hash, not an invented old source-rev field. If none matches allocate MAX(number)+1 under that same lock. Web explicit save may append a named identical snapshot intentionally, but Canvas ensure reuses one; every allocator still takes design lock. Live doc ops/restore use same design lock/rev CAS, so read/match/pin is atomic. Existing unique design/number is already present. DB trigger forbids modifying snapshot doc/design/number/hash once inserted; same-design+scope composite linkage protects Canvas refs.

`deletePlanVersion` and `deletePlanDesign` must check referenced Canvas versions in owner app command and **refuse** with **“This floor plan is used by a canvas. Delete that canvas first.”** until Canvas payload purge releases the reference (not merely tombstone). Published-reference protections remain. FK RESTRICT is final enforcement, not UI-only check. Snapshot cleanup on Canvas purge detaches its plan ref; no snapshot/doc cascade and no live design rewrite. Project/lead deletion similarly needs explicit tombstone/purge coordination before design physical deletion. Tests race actual web save/restore + MCP save against Canvas ensure, not two copies of a new helper only.

## 8. Data, migrations, grants and retention

### 8.1 Allocation, ownership and protected writes

Locally recorded planning inspection found no claimed 0100–0109 migrations on available origin refs; recheck fresh main and sibling claims before build/merge, never reuse applied numbers. No migrations run by this task. Adopt shared H5: 0100–0104 Browser first, **0105 privacy required for both Browser and Canvas**, renderer flags separate. Runtime admission code requiring owner column deploys after 0105; early browser DDL must not reference absent 0105 fields.

| Migration | Phase | Content |
|---|---|---|
| Browser `0100` | shared prerequisite | Canonical launch_source/continuation, guarded run identity. H4–H5, no duplicate interaction_surface. |
| `0105_ask_thread_ownership.sql` | Canvas 0 / Browser gate | owner_user_id, thread deleted_at/purge_after, thread access and deletion guards; thread-dependent run admission protections. |
| `0106_ask_canvases.sql` | 1 | Canvas/version/request/event, immutable identity/bounds; quota/rate/maintenance records. |
| `0107_ask_canvas_files.sql` | 1 | Derivatives, saves/profile/audience, trash association and maintenance fencing. |
| `0108_ask_canvas_pages.sql` | 2 | Static page constraints/policy version, or reserve unused if 0106 predeclares safely; note choice in handoff. |
| `0109_ask_canvas_floor_refs.sql` | 3 | Bigint floor refs/hash/source_rev, all-writer allocation/immutability/deletion guards. |

0105 adds `ai_conversations.owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT`; backfill old shared threads to unique active owner, never guess staff ownership. Null/ambiguous legacy owners quarantined (no staff access, report count); Joe may resolve via future explicit owner workflow, not a new agent tool. `requireThreadAccess` in proposed `lib/thread-access.ts` requires **thread owner=self** and ai for content, canvas and model-context assembly, including Joe. This follows Joe decision 8 “private to the person whose chat made it”; there is **no blanket Joe source-read exception for staff canvases**. Joe may manage retention/repair by opaque IDs without reading another person's private payload. Earlier draft/review's “owner can inspect any thread” is superseded by that decision. Saved copies are separate job-file audience (§9).

Apply before **list/load/getTurns/model inputs, messages/attachments, send/resume/session ID lookup, steer/stop, rename/archive/refile, reviews/approval reads, folders/rail counts/search and mobile equivalents**. Session read alone does not establish thread access. Owner cannot launch operator into another person's thread. Update `lib/ai-chat.ts`, `lib/actions/ai-chat.ts`, `lib/actions/dev-agents.ts`, `lib/actions/panel-review.ts`, `lib/thread-folders.ts`, run-context/attachment helpers, mobile operator actions/reads and voice delegation; caller must pass verified principal explicitly before building context.

**DB enforcement**, not an arbitrary session GUC: `guard_ask_thread_identity` and `guard_ask_run_identity` triggers check **session_user** against website owner login from deployment roles; no agent/worker-supplied set_config can authorize panel admission. All new trigger functions `SECURITY DEFINER SET search_path = public, pg_temp`; trusted owner command is not executable by narrow logins. Revoke PUBLIC EXECUTE on any scoped command function. Manifest existing worker/agent INSERT/UPDATE grants need not be removed wholesale, but guards override them:

- Narrow conversation INSERT must have owner_user_id NULL and background/legacy use only. Narrow UPDATE cannot set/change owner, deleted_at, purge_after, private session ID, or modify an owned panel thread. Narrow DELETE of owned/retained threads refused. No impersonation from setting a principal column. Worker retries must not directly read/append protected private transcripts; refactor those retries to background work with separate context and shared business subject IDs, or trusted app adapter after current authorization.
- Narrow run INSERT allowed only `launch_source='background'`, principal_user_id NULL, conversation_id NULL (use subject work item for association), business profile and continuation NULL. Narrow updates may advance status/activity/usage/retry timestamps on their **background** rows without changing identity/profile/thread/launch/parent/created_at, and may never alter an admitted panel row. Existing background paths refactored to this rule in same phase; no latent retry break hidden by removing a grant.
- Website `admitAskRun` is sole writer of new admitted run fields; validates user/thread/session as H4. For all roles immutable after INSERT: run principal/thread/source/profile/parent/created_at and thread owner. Website human maintenance may tombstone, never reassign. DB constraints check owner/principal/thread match for admitted rows and parent same-person/thread/source active-turn continuation; app also checks revocation. Existing legacy rows are not promoted. The detached runner itself currently uses website DATABASE_URL (`scripts/run-claude-agent.mjs:87`), distinct from its staff sjcos MCP child SJC_DB_LOGIN=agent. Preserve that trusted runner status/activity path; do not claim it currently has a narrow login or grant its child broader SQL access. A future narrow runner requires a separately reviewed, run-bound adapter, outside v1. Runner transcript writes still check thread tombstone before writing.

`deleteConversationAction` changes from physical DELETE to owned tombstone transaction (§8.5). Replace dev_agent_runs→conversation ON DELETE CASCADE with RESTRICT so unpatched deletes cannot destroy audit; raw physical delete of retained conversations refused until controlled final cleanup. Write-side checks after thread lock reject running-run commits after tombstone. No new pane flag can bypass Phase 0.

### 8.2 Records, FK lifecycle and durable limits

All new entity IDs UUID **except** version ints, event bigint, plan/design/snapshot bigint, and files text. Bigint wire IDs are decimal strings; convert only at existing safe-number floor boundary after safe-integer check, otherwise refuse. New times server timestamptz. Slugs resolve to UUIDs at admission; do not use “all IDs UUID” shorthand.

| Record | Fields and invariants |
|---|---|
| ask_canvases | id UUID; conversation_id/owner_user_id/created_run_id UUID RESTRICT; immutable kind/project_id UUID NULL/lead_id UUID NULL; required_areas catalog-validated set; latest_version int; created_at/updated_at/deleted_at/purge_after/hold_until. Unique(id,conversation_id,owner_user_id), owner equals thread and first run principal; project/lead mutually exclusive. Scope never becomes NULL to widen access. Lead slug is read-time alias from lead_id. |
| ask_canvas_versions | PK(canvas_id,version), composite thread/owner FK; actor_user_id UUID RESTRICT; run_id UUID NULL RESTRICT; title ≤80/summary ≤500/change_note ≤120; source_text/canonical_content, source_bytes/source_sha256, content_policy_version/renderer_version; plan_design_id/plan_version_id bigint NULL; design_rev int NULL; restored_from_version same-canvas FK; created_at/purged_at. Immutable payload/identity; exact kind fields, byte CHECKs. A version's effective privacy may only grow via parent requirements. |
| ask_canvas_requests | PK(conversation_id,request_id UUID); actor/action/input_hash/effective_policy_hash/result IDs/response metadata/created_at. No source copy; existing-result replay reauthorizes and applies current stricter policy before returning. Different request body or audience with same ID → conflict. |
| ask_canvas_events | id bigint identity, thread UUID, nullable canvas/version only for rejected, nullable run UUID, actor UUID, fixed kind/reason/time/group. Same-thread composite refs; append-only. No independent source log; joined title/summary redacted after deletion. Index(thread,id). |
| ask_canvas_renders | PK(canvas_id,version,renderer_version), validated SVG ≤512 KiB, hash/validator/actor/time; immutable hash per tuple; FK to selected version. Every renderer version's retained bytes count. |
| ask_canvas_file_saves | PK(canvas_id,version,project_id,format,generation), partial unique live generation per tuple; reserved_file_id text UNIQUE durable, file_id text UNIQUE nullable FK ON DELETE SET NULL, policy/hash/source/render/file hashes; saver UUID; request/time; pending/ready/failed/trashed/removed state; retry metadata. trashed is inactive for live uniqueness but retains reserved ID/policy. Never lose association on trash (§8.4). |
| files.security_profile | NULL or canvas_static_v1, write-once non-downgradable; fixed internal profile and matching save ledger required on insert/restore. |
| ask_canvas_usage | one global, per owner, per thread and per run usage rows: scope_type/scope_id PK, bytes/counts/checkpoint; bytes≥0. Same transaction as payload change. |
| ask_canvas_rate_windows | PK(actor_user_id,action_bucket,window_start); accepted_count; minute buckets UTC (floor epoch/60); per-run count on run usage row. Human writes have actor minute counter even with null run. |
| ask_canvas_maintenance | singleton job row: lease_owner UUID/lease_until/fencing_token bigint/last_cursor/heartbeat_at/last_success_at; phase/retry cursors plus deletion-journal sequence checkpoint. Owner-only maintenance. |

Conversation/run/user refs throughout **RESTRICT**, never null identity or cascade audit. Deactivate users normally; any physical delete refused while retained shells exist. Project/lead UUID refs RESTRICT; deletion first tombstones scoped canvases/files, then purges and removes scoped refs only in terminal shell cleanup (saved-file lifecycle completed first). Saved snapshots stay with job until job-file deletion, never public/unscoped. Design and snapshot bigint refs RESTRICT plus composite `(plan_version_id,plan_design_id)` ensuring same design; trigger verifies design scope equals canvas project/lead. Existing plan versions→design cascade remains but is blocked by Canvas FK/deletion guards until referenced payload purge; snapshot's user SET NULL is not Canvas actor provenance. Canvas source purge may null its floor ref while preserving minimal IDs/hashes in non-content shell; no deletion of external job file/design. All sources/versions retain payload until own/thread deletion grace; not age since creation.

**One lock order** for create/update/restore/floor_latest/render/save policy/trash/purge: transaction advisory **global canvas quota** lock (fixed namespace/key), owner usage row, thread row, canvas row (IDs sorted if batch), design row (if needed), file/save row, then rate/usage rows in sorted scope order. A design-only writer takes design lock and never later acquires canvas locks. Validate expensive content outside lock, reauthorize and confirm state inside. No network/fs await under DB locks; save reservation/commit are separate fenced transactions. Every event insertion, including runner rejected fallback and human saved/deleted events, takes global/thread serialization before allocating event ID; forward high-water cannot skip an uncommitted lower ID. Latest pointer+version+request+event commit atomically; deferred FK validates latest. New source or derivative insertion updates byte deltas under global lock, even across owners. Equal-hash derivative/idempotency replay costs zero; equal content with new update request still creates and counts a version.

Limits: **20 canvases/thread, 100 versions/canvas, 20 MiB/thread, 200 MiB/person, 1 GiB global** retained source+canonical+every derivative renderer version, titles/summaries/change_notes and bounded serialized request/event metadata. Project file bytes follow existing upload storage separately; save source never gets excluded from Canvas accounting just because a copy exists. Fixed metadata accounted by serialized UTF-8 size plus conservative row overhead; tombstone payload retained until purge still counts. At cap refuse new positive delta, no silent eviction; alert Joe once. Each committed new content version costs actor minute bucket **10/min**, plus **100/run** if nonnull; human restore/latest cannot evade 10/min via null run. Render upload **10/min actor**, saves **10/min actor**, distinct buckets; duplicate replay consumes none. Failed validation doesn't consume accepted quotas but requests have adapter per-person abuse throttle before parse. Expired minute rows pruned after 24 h, terminal per-run rows retained per audit policy. Minute rollover exact UTC; return retry_after seconds.

Checked accounting delta in same DB transaction; payload purge subtracts only actual deleted bytes, idempotently with purged_at and row locks. Reconciliation maintenance recomputes actual retained bytes under global lock in bounded resumable batches against a frozen write checkpoint; if drift found, block positive writes and rebuild counters before reopening, never guess lower. Counter inconsistency emits one repair item. One selected frame; no hidden pre-render. Body limits: internal 1 MiB, derivative envelope 600 KiB, save 8 KiB; stream-read hard cap, reject compressed bodies, no global upload-cap increase. Diagram ≤32 KiB; page source/canonical each ≤256 KiB; graph/DOM/path caps §6 remain.

### 8.3 Database role manifest

All canvas tool writes go through **the app internal adapter using the website login**, not raw MCP SQL. This choice centralizes authorization and avoids giving a shared `sjcos_agent` login access to other people's private canvas rows. New table entries in `deploy/db-roles.manifest.json` must explicitly have no raw narrow-role grants, e.g.:

```json
"ask_canvases": {"note":"Private Ask data; all reads/writes via authenticated canvas app adapter; no narrow-role raw access."}
```

Apply the same entry to all `ask_canvas_*` tables (including usage/rate/maintenance). No `SELECT` for `sjcos_readonly` over source or metadata; expose aggregate counts/bytes/error counters through a safe monitor adapter if needed. No worker grants: worker does not render or sweep Canvas; the named timer calls the authenticated app maintenance route (§8.5). Website owner login already owns app tables and is not listed as a narrow role. `sjcos_backup` reads through its existing backup read role, so backup disclosure/aging below applies.

In **each** migration changing tables, update the manifest together and paste the output of `node scripts/db-roles-sql.mjs <affected tables>` into the migration. For these no-grant entries output is intentionally empty: state “No narrow grants generated; access is through the app adapter” in the migration and verify raw role denial in DB tests. Existing `ai_conversations`, `dev_agent_runs`, `files`, and `plan_design_versions` already have manifest entries; retain needed ordinary grants subject to §8.1 triggers; update callers that previously wrote owned panel rows directly, add no broad privilege. Re-run the generator/role-path scan for the actual final write paths. No speculative GRANT added merely because a tool name exists. If implementation chooses direct MCP writes instead, **this design must be revised/reviewed**, with scoped functions and principal-bound access, before granting rows.

### 8.4 Project-file save, policy, recovery and trash

Proposed `lib/project-file-writes.mjs` shared command uses injected transaction/fs adapters. Existing MCP `save_project_file` direct writer keeps ordinary notes' markdown/text/HTML/1 MiB/same-name behavior, **refuses any replacement/downgrade of Canvas-profile file**; Canvas uses immutable snapshot mode, never calls private persistBlob or assumes storeBuffer is transaction-aware.

**Human Save API:** `POST /api/canvas/[id]/versions/[version]/save`, strict body `{request_id:UUID,project_slug:string,filename?:string,audience?:{kind:'owner_only'}|{kind:'staff',required_areas:PermissionKey[]},save_another_copy?:boolean}`. No source/bytes/path/user/run in input. Owner omission → owner_only (safe API default); the Joe dialog pre-selects Share with staff (Joe decision 9) and therefore sends an explicit staff audience on Save. Staff must **omit audience** (even owner_only rejected) and server derives staff policy; save_another_copy only allowed when prior generation removed/trashed, explicit UI action, never normal retry. Current active session/Origin/CSRF, ai, owned source thread/current source requirements, projects + target file access mandatory. Lead-only destination refused. Server chooses html. Policy resolved from DB and selected version's current parent requirements immediately before commit; static ≤1 MiB else **This file is too big to save. Download the code instead.**

Effective policy: staff-authored content's stored area union grows on **each** write (§9); Save unions stored + current staff actor areas + derived source/target requirements, raising parent policy transactionally if needed. Owner-authored API default owner_only; Joe's dialog pre-selects the staff audience (Joe decision 9), which is an explicit human confirmation. Joe's explicit staff audience validates catalog keys/unique/max size, shows stored/derived financial areas pre-ticked and requires human confirmation; this is the **only** declassification boundary (audited requested vs stored areas), never an MCP field. Empty checklist requires explicit “Share with all staff who can use project files” confirmation. Staff sharing cannot drop any effective requirement. Saved policy `{kind:'owner_only',owner_user_id:JoeId}` or `{kind:'staff',required_areas:sortedKeys}` is independent of source thread access; owner can read internal saved staff files, subject to current active account/projects policy. Private source stays private.

Canonical request hash includes endpoint canvas/version/project ID, normalized filename, explicit/normalized audience choice and save_another_copy; distinct actor bound in request key. Store effective policy+hash/revision in response/audit separately. Same key/different requested policy → IDEMPOTENCY_CONFLICT. Same key replay reloads policy/current access and never returns a now-weaker prior result. Active existing generation same tuple and **same effective policy/hash** returns existing file; different requested or stricter effective policy → **SAVE_POLICY_CONFLICT**, preserve old generation and its access, no silent broadening or reuse of weaker copy. UI explains §4; v1 has no sharing-edit endpoint. Owner may trash existing copy and explicitly Save another copy under a newly confirmed audience. Current permission expansion never silently broadens old saved copies: immutable saved snapshot keeps original bytes/policy; future saves must not return weaker-policy existing copy, and changing content creates a new version. Revoked reader always rechecked. No backdoor for a conflicting saver on the same tuple.

Success `{ok:true,file:{id,name,project_slug,version,href},effective_policy,policy_hash,generation,replayed:boolean}`. Policy conflict returns code only plus readable existing file metadata if authorized; never disclose another audience's filename otherwise. Filename default **Permit steps (v2).html**, identity stored separately. Save dialog captures version; a newer version arriving cannot change the bytes being saved.

Reserve deterministic file ID/path in pending row under tuple uniqueness, hash canonical bytes/policy; store bounded recovery recipe (version/renderer/policy/filename/project/saver, **not arbitrary content**) and retry time. Exclusive temp write in UPLOAD_DIR, fsync/atomic rename, then separate fenced transaction reauthorizes and inserts files row+ready save/event, client_visible=false, canvas_static_v1, tag **Canvas**. Blob hash mismatch never overwrites. Crash after rename reuses hash-matching blob; after commit replays ready. Independent maintenance resumes pending/failed saves even if no panel opens, at most 5 attempts with bounded exponential backoff (1/5/15/60/240 min); no indefinite reattempt of revoked/disabled work. On session/principal/policy revocation fail closed, mark failed and retain immutable provenance; user must readmit Save to retry. Ordinary stale temps >24 h cleaned only after durable reference checks, never generic upload directory sweep.

**Named saved-file resolver:** proposed `lib/canvas-file-access.ts:resolveCanvasFilePolicy({principal,fileId,operation})` loads files + save/trash ledger in website login, current named user/permissions/project + effective policy; hides names before authorization. Returns ordinary-file result or authorized fixed profile/policy, never canvas source/thread. Reject signature-only, portal/client/sub, unknown/unattended principal for canvas files. Authenticated internal `/api/internal/canvas-files` exposes bounded resolve/list/read/trash/restore to MCP, reloading named principal; no raw ledger grant. Delivery operation forbids any Canvas snapshot as external attachment in v1, even with grant or queue. **Concrete callers to modify before exports gate:**

| Callers | Required integration |
|---|---|
| `lib/files.ts:getFilesData`, `app/api/files/route.ts`, `lib/projects.ts:getProjectFiles` and mobile project/file lists | Filter before names/titles/thumbnail metadata/counts, then paginate; no hidden-row count leak. |
| `app/api/files/[id]/route.ts`, `app/api/mobile/files/[id]/route.ts`, all portal file/download/thumbnail routes, saved standalone viewer | Resolver before bytes/headers; Canvas requires named auth, no signed-link bypass; portals always deny. Thumbnail path also gated. |
| `lib/actions/files.ts:setFileClientVisibility`, replace/rename/upload operations | Cannot turn client_visible on, strip security_profile or replace Canvas bytes; permitted rename retains policy. |
| MCP `mcp/bidding-tools.mjs` list/get/view/save and `mcp/upload-tools.mjs` reads/writes/trash/list/restore | Delegate Canvas policy operations to app adapter before names/bytes; ordinary paths still work with narrow DB roles. Scan other file search/fetch tools and apply resolver, including connector readers. |
| `lib/mail-attachments.ts:loadFileAttachments`, `lib/providers/email.ts:loadAttachment`, bid-package assembly/delivery | Reject internal Canvas snapshots at enqueue and **again at delivery**, including already queued attachments after permissions change; named principal required for any internal read, never substitute service's owner DB login. |

Every Canvas HTML response: `sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`, no bridge/network, nosniff/private-no-store. Preview saved file in sandbox. Bytes revalidated as static before save, no original source fallback. No external send/publication controls. Other saved files unaffected.

**Trash compatibility:** `lib/file-trash.ts:fileReferences` must skip the known policy-managed `ask_canvas_file_saves.file_id` FK when enumerating references, for **ordinary files too**, so sjcos_agent never SELECTs a private table it cannot read. Do not ignore other business references. `trashProjectFile` authorizes **before loading name/error detail**; Canvas operation goes to app adapter, locks save tuple/file, records retained reserved_file_id/generation/policy/hash association, sets state trashed and file_id NULL while moving entire files row to file_trash/deleting files atomically. Profile/policy cannot disappear because FK was nulled. No “referenced file” refusal merely for Canvas provenance; genuine bid/signature references still refuse. Policy triggers refuse direct narrow trash/delete/restore of Canvas-profile files (including via JSON row); ordinary note deletion remains available.

`listFileTrash` and MCP restore lists join retained policy through reserved_file_id in app adapter and hide denied names/counts. `restoreProjectFile` authorizes original policy and target, checks blob/hash/profile, and reinserts original files row **plus file_id link/state ready atomically**. If new active save generation exists after **Save another copy**, or filename collision, `FILE_RESTORE_CONFLICT` preserves trash and active copy; never two active generations. Save another copy marks old generation removed only within same reservation transaction; original restore remains conflict while replacement active. Purging trash keeps minimal reserved-file/policy/hash provenance needed for audit, never restores missing blob. Both file lifecycle commands must use same adapter/locking, not generic private-table scan or broad grants.

**Project › Files row/view:**

```text
Permit steps (v2).html   [Canvas]  [🔒 Only Joe]                Version 2
Permit notes (v1).html   [Canvas]  [🔒 Staff: Money, Bidding]    Version 1
```

Denied rows are absent for staff; Joe sees the audience and why a colleague cannot see it. Open file uses static sandboxed viewer caption **Made by Claude · Version 2 · Internal draft**, no source-thread link unlocked for job readers. Saved snapshot survives Canvas/thread deletion under normal job file retention.

### 8.5 Retention, deletion journal and scheduled maintenance

**Settled Joe decisions 7–8**, not pending policy: Canvas lives with thread; archive keeps full history; deleted Canvas purged after **30-day grace**; saved job copies remain job files, always internal in v1. DELETE asks **Delete this canvas and all its versions? Saved project files will stay. [Delete canvas] [Cancel]**. Tombstone immediately, revoke preview/code/export/read titles, generic deleted cards only; set purge_after=deleted_at+30 days. **Thread delete** writes thread tombstone, marks runs cancellation_requested, rejects any subsequent tool/context/message writes after locking thread, tombstones all its canvases with same grace. Patch runner persistToConversation/unseenTranscript to respect deletion, not resurrect it after cancellation. No physical thread DELETE during grace or while retained refs exist; replace current cascading delete path. After grace controlled maintenance redacts private transcript/session/attachment refs as existing retention requires and Canvas source/canonical/derivatives/titled request/event payloads; retain minimal thread/run/canvas/version IDs, actor/hash/date shells required by saved provenance. No cascade to saved job files. Physical cleanup of shells only if no retained audit/files references; indefinite minimal shells acceptable.

One-way purge command alone may redact immutable rows, under owner login/fenced maintenance after hold check; live/history immutability remains. `purged_at` + null content/title/summary permitted only on tombstoned terminal rows. Quota frees actual removed bytes once. Holds owner-only; they block purge **not** access denial. Project/lead deletion coordinates scope tombstone and job-file retention, never NULL→public; user deactivation/revocation denies immediately, physical identity deletion RESTRICT (§8.2). No age-based pruning of active threads or saved copies.

**Deletion journal outside DB restore point:** proposed append-only `SJC_CANVAS_DELETION_LEDGER_DIR` on a durable operations volume excluded from database snapshots/restores, owner-readable 0700. Before acknowledging delete, owner app command under an OS file lock appends+fsyncs sequence/UUID/entity type+opaque IDs/deleted_at/purge_after/prev_hash/checksum (no source/title). Tombstone DB transaction then records sequence; interrupted intent is conservatively treated as deleted, reconciled by maintenance. File lock serialization/partial-tail checksum recovery specified in `lib/canvas-deletion-ledger.mjs`. Delete fails visibly and grants no success if journal unavailable; do not acknowledge DB-only deletion. All automated project/thread Canvas tombstones use same journal. Deploy independent encrypted, versioned off-box replication of the journal (separate restore set; never restored to DB snapshot date). Handoff records volume/location, last durable/replicated seq and backup aging; restore gate **refuses access** if latest required journal cannot be obtained/verified. Journal outage does not allow “restore first, replay later.” This is additional deployment work, not a claim a DB table survives its own restore.

Restore runbook, flags off and access blocked: restore DB + uploads; obtain latest independent journal, verify full hash chain through acknowledged high-water (including newer deletes), replay all intents idempotently into restored thread/canvas tombstones and immediate access denial; purge if grace elapsed/no hold, reconcile saves/usage/files and validate references, then coordinator may reopen access after privacy tests. A backup from before deletion must still deny deleted content. DB-side tombstones alone are not replay evidence. Backups themselves age by existing encrypted backup retention, whose actual duration must be recorded before release; 30 days does not promise erasure of historical backups. No client offline storage/analytics of source.

**Actual maintenance caller to add:** `deploy/sjcos-canvas-maintenance.service` oneshot + `.timer`, every **5 minutes**, Persistent=true, Nice=19, MemoryMax=128M, CPUQuota=25%, TimeoutStartSec=15, Restart=no; no browser/renderer process. `scripts/canvas-maintenance.mjs` reads CRON_SECRET from protected env, sends loopback POST `/api/internal/canvas-maintenance` (no shell interpolation/secret stdout), request timeout 10 s. Joe installs/enables timer only with approved deployment. Website route validates constant-time secret and runs ≤**50 rows or 2 s** per invocation. This timer explicitly replaces the old vague “configure cron”; no operation run during planning.

Lease row `ask_canvas_maintenance` stores lease_owner random UUID, expires now+30 s, incrementing fencing_token and heartbeat/cursors; acquisition CAS only expired lease. Each batch transaction verifies current owner/token/expiry; stale token cannot commit DB changes or destructive fs unlink. No locks held across fs calls: fence/reserve path first, recheck token/current file references immediately before unlink; deterministic exclusive paths mean retry harmless. Expired lease recoverable on next tick, never parallel sweeps. Phases: reconcile journal→recover pending/failed saves→purge due tombstones→remove orphan `.canvas-tmp` after24h→reconcile quotas. Each phase has `(due_at,id)` cursor persisted with checkpoint, bounded scan and wraparound so inserts behind cursor are not skipped; purge updates purged_at/cursor/accounting atomically per row, restarts skip already purged payload. All publication and cleanup of a deterministic blob path also take the same per-path OS lock: fence validation + reference check + unlink while held; new writers cannot attach that path between check and unlink. A stale lease cannot delete a newly referenced file. Disk cleanup intents survive interrupted batch and are retried only after reference/fence validation. Purge holds revisited on later ticks.

Monitor through safe owner aggregate adapter: heartbeat >15 min, oldest pending save >15 min (or failed exhausted attempts), due purge >15 min overdue excluding holds, orphan >48 h, journal replication lag >15 min or accounting drift. Create/update **one** deduplicated repair work item for Joe, stable key `canvas-maintenance-health`, summarize fixed codes/counts/oldest age only; healthy recovery marks it complete through normal work-item status command. Use existing work-item writer/audit convention with app login, no promotion/approval. Maintenance catches up without an open panel; UI may show saved failed status on next visit. No unbounded directory or DB scan.

## 9. Security review checklist and failure boundaries

| Threat | Required control / proof |
|---|---|
| Sandbox escape/app XSS | Opaque origin from both HTTP sandbox and iframe sandbox; trusted hash-only bridge/bundle, no agent script, no same-origin token, no raw HTML in Markdown/app DOM. Open raw route directly in tests too. Unsafe markup is rejected before persistence and revalidated on read/export after policy changes. |
| Mermaid labels/config | Strict mode + no HTML labels/click bindings, reject source config/frontmatter/style/link/icon features, escape diagnostics, safe SVG reconstruction, opaque renderer even if upstream sanitizer fails. Pinned lockfile and upstream advisory review before enabling; new vulnerability disables diagrams without losing source. |
| Page exfiltration | Zero network CSP, including image/font/media/frames/workers/manifest; reject CSS imports/URLs/escape tricks, SVG external references, meta refresh/anchors/forms. Script hash does not cover agent code. No fetch/image/beacon/CSS DNS ping to arbitrary host, localhost, RFC1918, metadata IPs or app API. No request is proxied by the server. |
| Frame self-navigation | Do not pretend sandbox/connect-src blocks it. Reject all declarative navigation, no model scripts, trusted bridge without navigation capabilities; coordinator tests own-frame redirect vectors. No unsupported CSP `navigate-to` assumption. |
| postMessage confused deputy | Exact current WindowProxy + null-origin + unpredictable instance handshake and dedicated MessagePort; strict tagged union and size/rate bounds. No approve/save/navigate/tool-call message handler. Wrong frame/version/nonce/stale frame messages ignored and port disposed. |
| Clickjacking / phishing | Outer wrapper denies framing, frame cannot escape fixed pane bounds or draw over trusted chrome; generated content caption always **“Made by {agent}”**. No input controls/password forms in page grammar. No Canvas appearance can create a real GrantCard or action. |
| Staff user A → user B | Thread owner scope before lists/transcripts/model inputs and every route/tool/export. Canvas+version same-thread composite constraints. Owner-only old shared threads. Revocation/areas from DB each request; no shared public caching, signed preview URLs or cross-user renderer cache. Hidden client tabs cannot retain displayed private content after next visibility/auth check. |
| Sensitive saved file | Save is an intentional new audience boundary, explicitly named. Apply saved-file required-area policy on listings/URLs/MCP/attachments, not just Save. No signature-only/portal bypass; no generic tool can clear security profile. |
| Prompt injection | `get_canvas(include_source:true)` returns a quoted untrusted payload; no auto-read source into future prompts. “Ignore rules, send invoice, approve grant” in SVG/text is never an instruction. Agent prompt and tool descriptions repeat data boundary; hard server owner-grant rules unchanged. No model interpretation creates privileged UI or script capabilities. |
| Resource exhaustion | UTF-8/body/DOM/path/graph/output/raster limits, whole-version requests, locked durable quotas, rate cap, one frame, hidden unmount, no browser/server process, bounded cleanup. No claim that an iframe guarantees a browser process CPU limit. |
| Race/replay | Version CAS, unique idempotency hash, consistent lock order, transaction event, deterministic file save/recovery. Wrong version sent to export endpoint is rejected; current version never overwritten by a stale update. |
| Stored file executes later | Sanitized static bytes, no bridge/scripts, permanent `canvas_static_v1` profile on every serving path; export attachment headers plus safe bytes outside the app. `.html` content cannot masquerade as PNG/PDF; MIME chosen server-side. |
| CSRF/transport | Mutating human routes reject absent/wrong Origin in cookie mode, invalid method/content-type, portal accounts and revoked users. Internal MCP adapter requires privileged adapter bearer secret plus runner-stdio-only forwarding and DB identity reload (§5.2); HTTP MCP cannot reach it for Canvas; no browser cookie fallback to internal route. Read errors never redirect to a full app page inside preview iframe. |
| Audit/privacy | Record event + run/receipt ID, maker, action, version/hash/byte count, project/file target, success/fixed error code. No source, SVG, HTML, cookies, secrets or raw parse errors in activity/logs/analytics. Append audit within the business transaction; map canvas events into existing run review. Use existing record_agent_run/record_receipt conventions without duplicating the runner's run record. A failed tool is not “Confirmed change”. |

**Classification limit and monotonic policy.** No model label proves absence of financial/mail data. Every staff create/update/restore/floor_latest **and Save** atomically sets parent requirements to union(stored requirements, actor's **current full DB area set**, declared requirements, derived design/project/lead/source areas). Human null-run actions use same rule. Existing restrictions never shrink on permission loss or omitted labels; principal must still hold previous set or write is refused. Permission increase → unlabeled write adds new areas before commit; affected metadata/access checks use new parent set for every version, including old versions. Required-area locks/recheck serialize concurrent update/save. Retried original request remains same version but reauthorizes and cannot return a weaker-policy copy; Save conflicts if effective policy differs from existing generation. Old immutable saved copies keep their original bytes and policy; stricter future version/save cannot reuse them as a weaker result. Permission revocation at read or queued delivery remains enforced by saved-file resolver. Canonical policy version/hash in request response/audit prevents replay policy confusion.

Owner content is owner_only only when the audience is omitted (API default); the Joe Save dialog pre-selects Share with staff with derived areas pre-ticked (Joe decision 9). Only Joe's explicit **human** audience confirmation can declassify a saved snapshot, with a validated checklist/pre-ticked derived and money requirements and recorded requested/effective policy (§8.4). Staff cannot send any audience payload or weaken source policy. Saved sharing grants no access to source thread. Canvas is **private to chat's person**, including staff vs Joe; saved job snapshots follow explicit internal file policy. Client portal, outside attachments and sends are denied for Canvas snapshots in v1, with no owner-grant bypass in this feature. Joe decisions 7–8 settle retention/internal visibility; they are not reopened in §12.

These are application boundaries against untrusted generated content and staff principals, not a new isolation guarantee against Joe's operator profile intentionally editing source/DB or a compromised server-admin account. Shared internal CRON/MCP secrets remain privileged; do not hand them to a model or child frame.

## 10. Phases, tests and acceptance

No browser, dev server, build, tsc, database mutation or service operation was run for this planning task. Future implementation uses single test files and disposable databases only. DB tests must use the disposable harness directly or an explicit harness-minted `SJC_TEST_DATABASE_URL`; never fall back to a production URL. `assertNotProduction` in `tests/_harness/testdb.mjs:40` refuses the live shape and a missing application_name marker before connecting. Use this guard, never the legacy fixed-port esign guard. Never run the whole `npm test` suite on this shared host.

Future DB tests use **`tests/_harness/testdb.mjs` withTestDb** or a harness-minted SJC_TEST_DATABASE_URL only, unique tag per worktree/invocation and explicit cleanup. The harness refuses live shape and missing `application_name=sjc_test_harness` **before connecting**. Example for implementation only (not executed by this planning task):

```bash
export SJC_TEST_CLUSTER_TAG="ask-canvas-$(date +%s)-$$"
trap 'node scripts/test-db.mjs stop' EXIT
node scripts/test-db.mjs start
# Use withTestDb in each named file; never source/eval arbitrary printed output.
node --test tests/ask-thread-access-db.test.mjs
node scripts/test-db.mjs stop
trap - EXIT
```

One file per invocation, sequentially, same unique tag until stop. If a test needs the URL, obtain it from startCluster inside the harness and call assertNotProduction before opening its client; never inherit a default production URL. Stop disposable cluster even on assertion failure. Any exit 137: stop work/report, do not retry. Phase handoff enumerates each changed integration caller and exact test/evidence result, including anything still gated.


### Phase 0 — thread privacy and pane contract (required for both features)

Build: Browser 0100 shared provenance prerequisite plus Canvas migration 0105; shared thread-access helper; apply to web/mobile panel paths enumerated in §8.1; panel-run provenance; one pane host shared with browser. Fix privacy before persisting canvas data. Keep all canvas flags off.

Named tests:

- `tests/ask-thread-access-db.test.mjs`: two staff, owner, client/sub, inactive/revoked identity, legacy null-owner thread, same-folder counts, transcript load/turn-context, attachment download, run review, cross-user resume/session injection, rename/archive/refile/stop/steer. Wrong ownership denied server-side even with a forged UI request. Joe cannot read another person's private canvas/thread or launch an owner run into it. Direct SQL as sjcos_agent AND sjcos_worker: forge panel INSERT, change background launch_source, attach a real panel thread/principal, change thread owner, overwrite admitted run/session, delete retained thread: all denied; permitted background retry/status update still succeeds. Test web/mobile/voice/Telegram/background/new human continuation admission separately.
- `tests/panel-content-pane.test.mjs` and Browser `tests/browser-ui.test.mjs` import **the same** `tests/fixtures/ask-pane-host.mjs` cases (shared H5): 360/420/720/820/839/840/959/960/1000/1280, dock explicit expansion vs arrival dot, Queue/Threads collapse, simultaneous arrivals, switch during takeover including failed leave protocol, draft/selection/focus/history preserved, stale responses ignored. Reducer evidence does not replace real iframe/VoiceOver testing.
- Extend existing `tests/agent-profile.test.mjs` and MCP identity tests with panel vs unattended vs Telegram provenance and `with_mcp=false`; staff can never gain operator profile or claim another user through tool args.

Exit: no title/source/thread leak across accounts; browser implementer can mount its pane through the same host without a second layout/state machine.

### Phase 1 — smallest useful slice: diagrams that survive and can be kept

Build: 0106/0107, four tools on sjcos, Claude guidance, complete-version polling/card/history, L1 renderer, source view/fix flow/version restore, standalone wrapper, SVG/source download, validated static project-file snapshot with access/profile protections, PNG and print as client enhancements only after device checks. No L2/L3 advertisement. Joe owner pilot first, then staff after access gates pass.

Named tests:

- `tests/canvas-content.test.mjs`: valid flowchart/sequence/state samples; Unicode byte boundary; YAML/init config everywhere; malicious label `<img onerror>`, encoded javascript URL, click callback, external icons, CSS `url()`, quote/HTML closing attacks, malformed SVG, unknown types; lexical checks do not reject a safe quoted word “click”. Node/edge/depth/path and large-output limits.
- `tests/canvas-commands-db.test.mjs`: create/update/restore whole snapshots, immutable version/title/summary, CAS concurrent updates, 10 simultaneous same-key retries, key/hash mismatch, replay after newer update, run/thread/principal mismatch, stopped run retains existing canvases, concurrent quota accounting across two processes/connections, kind/project mutation denied, same-canvas restore FK, event/pointer/request atomic rollback. Include two different owners racing just below global cap, derivatives racing content updates across connections, equal-hash replay accounting, purge/retry deltas, counter corruption repair and null-run human restore floods. Staff ai/projects → permission adds money → unlabeled update/restore/latest → save must require money; denied after revocation; retry cannot resurrect weaker policy.
- `tests/canvas-mcp.test.mjs`: exactly one registration in sjcos, strict schemas/errors, no registration in interact; operator and staff business named panel calls work, staff-area denial, unattended/cron/Telegram/direct header impersonation denied: **valid external MCP_HTTP_TOKEN + exact existing active panel owner tuple and staff tuple** still fails before any internal fetch; same admitted stdio succeeds. Include inherited env with MCP_HTTP_PORT forcing explicit stdio override, missing tags/bare stdio, invalid start time, HTTP ALS with misconstructed stdio guard, revoked run refused, code-only omits tools, tool results/activity contain no source/secrets.
- `tests/canvas-routes.test.mjs`: unauthenticated/CSRF/origin/method/body/type cases; private no-store; awaited params; every 200/error has intended CSP/Content-Type/nosniff/referrer; opaque renderer has only exact hashes; no permissive CORS/null-origin auth. Check actual matched next.config/proxy paths `/panel/canvas/<id>` and nested `/print`, including anonymous/401/404/redirect/private no-store responses; `/api/canvas/*` must not inherit wrapper DENY. Check direct preview access as well as embedding and standalone frame denial, selected-old-version Code responses, renderer-hash/save-policy conflict mapping and disabled/revoked codes. These are HTTP/unit tests, not proof of browser CSP enforcement.
- `tests/canvas-poll-history.test.mjs`: live/final/error card dedupe; commit before runner crash; terminal last update; reload with no assistant message; cursor pagination/forged cursor; canceled promises/thread switches; missing version; hidden/reopen; new tab/popout anchor exemption; no private data in storage/bus. Feed >20 events over multiple byte-limited pages, multiple runs with same canvas and failed/no-reply cards, human restore/latest/save, terminal cursor drain after crash, both pagination directions and selected old-version code. Flip each effective master/kind/staff/export switch during active AND idle metadata-only responses with no new events: mounted frame/code/actions close at promised refresh.
- `tests/canvas-exports-db.test.mjs`: derivative SVG sanitation and hash immutability, wrong canvas/version, corrupt/stale policy, no server browser, deterministic save recovery at each fs/DB crash boundary, duplicate filenames and same-key retry, client-visible default false, owner-only sharing default, source required areas, cross-project target denial, saved snapshot vs private source, file profile cannot downgrade, signed/portal/MCP/attachment bypass denied, generic note replacement of canvas-profile file refused. Include owner consent/default and staff audience forgery, same-key/different-audience replay, existing tuple/different-policy/conflicting saver, permission-increase/unlabeled-update/save less-privileged reader denial, source revocation and policy recheck after retry. Exercise **every named §8.4 resolver caller**, sjcos_agent normal-file deletion after new private FK, denied trash names/counts, restored sensitive Canvas file policy+association, Save another copy vs restore conflict and queued email/bid attachment recheck after permission change.
- `tests/canvas-retention-db.test.mjs`: archive keeps versions; deletion immediately denies source/title; grace purge/hold; saved snapshot survives; deletion of project/user does not widen access; lease/batch bound; restored backup deletion replay; orphan sweeper never removes referenced normal uploads. Failed-save recovery with no panel, two competing sweepers, fencing/stale lease, interrupted purge/journal append, restore from before deletion using independent journal, missing journal restore refusal, actual physical DELETE refusal and run-in-flight thread deletion must pass. Journal repair never opens access before replay.
- Run `node scripts/db-roles-scan.mjs --diff`; run `tests/db-roles-manifest-db.test.mjs` and `tests/db-roles-paths-db.test.mjs` **one at a time against disposable test DB**. Assert every canvas table denies raw narrow-role read/write; existing paths retain the grants they require.

Coordinator visual/security release matrix (future work, not authorization to launch a browser here): 360 iPhone Safari, 820 iPad Safari, 1280 desktop, default 420 dock plus wide/popout; keyboard/VoiceOver/reduced motion; zoom/pan long labels; render failure source shown; stale-version update; card after reload/crash; download filenames/formats; save audience/destination; print cancel/multi-page/clipping; focus restored from Canvas. Test hostile page/diagram fixtures in instrumented browsers with **zero unexpected requests** after initial renderer document (including image/CSS/font/frame/refresh/self-navigation), app cookie/API/parent/localStorage access denied, parent top-navigation unchanged, attacker `postMessage` ignored, raw preview sandbox persists when opened in a tab. Verify actual deployed headers/compression through nginx/Cloudflare, not just an in-memory route test. Use authorized coordinator memory caps and stop everything started.

Exit: Joe can ask for a process diagram, see it, ask for a change, step back, reload it, and save the selected static version privately to a project. Export bugs do not justify weakening the sandbox. PNG/print controls can remain gated with the specified fallback until verified.

### Phase 2 — static pages / inline SVG

Build: 0108 if needed, page parser/strict allowlists, trusted measurement bridge, L2 routed preview, HTML download/print/project save through same flow. Code help shown to the person says **“This page can show text, tables, and drawings. Ask Claude to change it.”** Tool-only help says “Static HTML with inline styles and SVG. No scripts, links, or external files.”

Named tests:

- Extend `tests/canvas-content.test.mjs` with mismatched tags/namespaces, Unicode/HTML entity and CSS escape attacks, style imports/image-set/custom vars, script/event/foreignObject/use/SMIL, base/meta refresh, srcset/ping/formaction, local fragment integrity and huge SVG paths/grid/depth; valid flexible phone/tablet table/card layouts.
- `tests/canvas-page-sandbox.test.mjs`: exact static grammar → canonical bytes; trusted hash script cannot be injected/replaced by source; source text closing script tags never joins bridge context; no model script executes, no arbitrary iframe messages accepted, bounded height vs enormous source layout, sanitization doesn't mutate canonical accepted bytes on repeat.
- Extend `canvas-exports-db` with saved HTML opened via all routes, strict file CSP and static bytes with no bridge, old version failing new sanitizer is refused, original source only as text.
- Coordinator repeats zero-network adversarial browser checks and Safari multi-page table/print/source/download checks. A tested route CSP is insufficient without actual browser enforcement evidence.

Exit: Joe gets a clear static illustrated page that adapts to all three widths, survives history/version changes, and can be downloaded/saved without executing or requesting anything.

### Phase 3 — existing floor designer inline

Build: 0109, canonical loader/Designer adapter, scope-aware floor MCP checks, atomic saved-version references, preview-only inline controls, full designer handoff. Keep current published floor/client workflow unchanged.

Named tests:

- `tests/canvas-floor-db.test.mjs`: missing/wrong-scope design, denied projects/leads, rev race, actual existing web save/restore and MCP save versus Canvas races, same immutable snapshot reused, no duplicate design from canvas, selected saved version differs from live design, canvas restore cannot change canonical doc, ops still use existing rev CAS, money/catalog/estimate props filtered before serialization; referenced snapshot/design deletion refused, cross-design/scope FK attacks, bigint serialization, canonical-hash matching and immutable doc bytes. Thread-delete/run-in-flight/physical-delete interactions also covered in retention tests.
- `tests/canvas-floor-adapter.test.mjs`: readOnly prevents edit/autosave/publish/estimate actions; 2D default; hidden canvas releases selected renderer; latest revision notification doesn't overwrite snapshot; canonical link and project Floor refer to same ID.
- Extend existing **`tests/mcp-floor-tools.test.mjs`**, **`tests/plan-ops.test.mjs`** and **`tests/agent-profile.test.mjs`**, plus role-path checks for any new version write path. Run no unrelated/full suite.
- Coordinator phone/tablet/desktop verifies floor inspector, read-only labels, old/live versions, full designer return, no duplicate 3D context, and its existing unsaved-edit/conflict behavior.

Exit: agent-created real construction geometry appears inline, with measurements and revision history from the existing designer, without a parallel store or publishing path.

## 11. Flags, deployment, rollback and handoff

**Flags.** Server master env `SJC_CANVAS_ENABLED=0` default; owner-only `app_settings` feature keys `canvas.diagrams_enabled`, `canvas.pages_enabled`, `canvas.floor_enabled`, `canvas.exports_enabled`, `canvas.staff_enabled`, all initially false. Existing app-settings access remains owner-only: no new agent/worker write grant or feature-toggle MCP tool. Read flags in every adapter/preview/export request (short cache ≤5 s, kill switch invalidates it); client flags only hide controls. Staff enablement additionally requires migration 0105/privacy acceptance. Module imports/type schema cannot alone enable a kind. Saved static project files remain available under their file-access policy even when canvas preview creation is disabled.

**Failure/kill.** If a renderer regression/security advisory appears, turn off its kind; deny new writes/preview/derivative creation, close mounted frames on the next poll (≤2 s active, ≤30 s visible idle), and preserve authorized metadata/version/source downloads only when the incident policy allows source. Master off denies source/preview entirely, leaving generic cards and saved files. Server-side API denial is immediate after flag propagation; already delivered pixels/bytes cannot be recalled. Clear hidden frames before redisplay. Export kill stops new exports; it never changes existing file CSP. Privacy incident may additionally tombstone affected canvas/file access; flipping a flag is not deletion or credential revocation.

**What Joe/coordinator must do to deploy (in this order):**

1. Adopt `_ask-pane-host.md` verbatim in Browser plan/build; merge/reconcile AskContentPane, canonical launch_source and protected admission. Confirm Browser 0100–0104 and Canvas 0105–0109 claims on fresh main; apply shared prerequisite in numeric order with both features off, Browser/Canvas panel gates wait for 0105 privacy evidence. Review manifests/actual grant-generator output and migration SQL; have the existing encrypted backup/restore path verified. Confirm real backup aging; provision independent deletion-journal volume and encrypted separate replication/restore gate with sequence verification (§8.5).
2. Install pinned dependencies from reviewed lockfile in the deployment checkout. Ensure standalone Mermaid asset is packaged, integrity checked, exact CSP hashes match it, license notice retained, public library-only bytes cached, compressed response served. No CDN or renderer service. Canvas does require the bounded maintenance oneshot/timer and independent deletion journal (§8.5).
3. Apply additive migrations through the normal **owner-authorized** deployment procedure, with flags off. Confirm ownership backfill/quarantine count; do not guess staff owners for legacy threads. Test rollback backup on an isolated DB first. Migration command must be the repo's normal migration runner, not pasted direct live SQL from this plan.
4. Set master env as part of the approved website deployment; initialize owner feature settings off. Install the proposed `sjcos-canvas-maintenance.service` and `.timer`, protected caller secret/env and `SJC_CANVAS_DELETION_LEDGER_DIR`/independent replicated journal; demonstrate five-minute invocation, lease recovery, health thresholds and closed-panel save recovery (§8.5). It runs bounded batches in the website route, not a persistent renderer/worker. No MCP daemon restart is required merely to add Claude's per-run stdio tools, but the long-lived sjcos-mcp service must receive new registrations in its next **approved** deployment if external clients should discover them (all HTTP Canvas calls stay denied even with matching panel provenance).
5. Coordinator alone performs a memory-capped staged production build with a unique `SJC_DIST_DIR`; inspect `pgrep -af next` first, never build/start into live `.next`. If a side preview is required, use the admin's capped `systemd-run --user -p MemoryMax=8G -p Restart=no` procedure on a side port and stop it in the same turn. Never `next dev`. No service stop/restart or production promotion without Joe's deploy instruction. No browser in design sub-agent work.
6. Enable diagrams for Joe only; do the Phase 1 matrix using a practice thread/project and adversarial fixtures, then staff account A/B privacy tests. Enable staff only after those pass. Enable exports only after file-route/print/download checks. Record exact build SHA, migration IDs/dependencies, flags, package hashes, shared-host fixture results, all concrete privacy/file-trash/delivery/floor integration paths changed, single-file test commands/results, actual Safari/CSP/compression evidence and journal/timer restore evidence in `docs/plans/build/ask-canvas-phase1-HANDOFF.md`.
7. Enable Pages, then Floor, only after their separate phases/reviews/matrices. Monitor counts/bytes, render failures/timeouts, rejection codes and exact pending/purge/orphan/heartbeat/journal thresholds from §8.5. No source-content telemetry. One repair to-do for repeated infrastructure failure, no per-diagram spam.

**Rollback.** Disable affected kind/staff/exports first; master off if needed. No data-destructive down migration. Retain tables, snapshots, file policies, ownership checks and strict file-serving support. An old app binary **without** these security-profile/ownership guards is not an acceptable rollback while canvas files/private threads exist; keep the small security compatibility patch or disable all affected file-serving paths first. Do not restore generic permissive HTML serving as a workaround. Keep static project files readable under the patched policy; fallback cards say Canvas is off. No floor doc rewrites, portal state change, sends or grant changes. Re-enable against stored immutable versions only after patched validator tests; previously accepted content is revalidated, never blindly trusted.

**Verification discipline for implementer.** At most one typecheck, only if code changed: `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`. Single test files sequentially; no full `npm test`, no live database, no servers or browsers except explicitly authorized coordinator checks. Exit 137/“Killed”: stop and report, never retry. Only authorized deployer touches live services.

### Planned implementation file map (not edits made by this plan)

| Area | Proposed or existing files to change |
|---|---|
| Shared panel/UI | `components/panel/AskContentPane.tsx`, `CanvasPane.tsx`, `CanvasCard.tsx`, `CanvasVersions.tsx`, `CanvasSaveDialog.tsx`, `FloorCanvas.tsx`; integrate `PanelHost.tsx`, `PanelDock.tsx`, `PanelChat.tsx`, `PanelWindow.tsx`, `useAgentChat.ts`, `panelStore.ts`. |
| Commands and validation | `lib/ask-canvases.ts` (server reads/writes/auth/transactions), `lib/canvas-content.mjs` (pure parser/limits), `lib/canvas-renderer.mjs` (fixed document/bridge/CSP), `lib/project-file-writes.mjs` (shared snapshot-aware writer), `lib/thread-access.ts` (shared ownership), `lib/ask-run-admission.ts`, `lib/canvas-file-access.ts`, `lib/canvas-deletion-ledger.mjs`, `lib/plan-version-writes.mjs`. |
| MCP/runner | `mcp/canvas-tools.mjs`, `mcp/sjcos-mcp.mjs`, `mcp/bidding-tools.mjs`, `mcp/upload-tools.mjs`, `mcp/floor-tools.mjs`, `scripts/run-claude-agent.mjs`, `lib/dev-agents.ts`, run-profile tests; **no** new tools in `mcp/interact-mcp.mjs`. |
| Web/API | `app/panel/canvas/[id]/page.tsx`, `app/panel/canvas/[id]/print/page.tsx`, `app/api/internal/canvas/route.ts`, `app/api/internal/canvas-maintenance/route.ts`, `app/api/canvas/renderer/route.ts`, `app/api/canvas/[id]/route.ts` (metadata/DELETE), `app/api/canvas/[id]/versions/route.ts`, `app/api/threads/[id]/{canvas-events,canvases}/route.ts`, `app/api/internal/canvas-files/route.ts`, `next.config.ts`, `proxy.ts` wrapper headers, `app/api/canvas/[id]/restore/route.ts`, `app/api/canvas/[id]/floor/latest/route.ts`, `app/api/canvas/[id]/versions/[version]/{code,preview,render,download,save}/route.ts`; same command adapter for human restore/latest actions. |
| Existing access/history | `lib/ai-chat.ts`, `lib/actions/ai-chat.ts`, `lib/actions/dev-agents.ts`, `lib/thread-folders.ts`, `lib/actions/panel-review.ts`, thread rail/attachments/run-context callers, `lib/mobile-rpc/operator.ts`, `lib/mobile-rpc/operator-reads.ts` and mobile operator routes, `lib/permissions.ts` description correction (remove outdated shared/Joe-only-thread comment). New wrapper route stays under `/panel`, already assigned to `ai`. |
| Files/floor | All §8.4 named callers including `lib/file-trash.ts`, `lib/files.ts`, `lib/projects.ts`, `lib/actions/files.ts`, `lib/mail-attachments.ts`, `lib/providers/email.ts`, bid-package delivery and mobile/portal routes; `lib/actions/plan-designs.ts`, `mcp/floor-tools.mjs`, shared floor loader from `app/(os)/floor/[id]/page.tsx`, `components/floor/Designer.tsx`, `TopBar.tsx`, sensitive inspector loaders. |
| Schema/ops | 0105–0109 plus shared Browser 0100 changes as H5, `db/schema.sql`, `deploy/db-roles.manifest.json`, `deploy/sjcos-canvas-maintenance.service`, `.timer`, `scripts/canvas-maintenance.mjs`, independent journal replication/restore runbook, package/lockfile and renderer asset packaging, named tests above, per-phase handoff evidence. |

## 12. Business choices for Joe

**Settled, no re-asking:** retain Canvas with its thread; purge deleted private content after 30 days with backup aging disclosed; saved copies remain job files; source is private to the chat's person; job copies internal only, never clients in v1 (Joe decisions 7–8). A job file reader must hold its recorded audience/areas as well as job file access; saving never shares the source chat.

**Joe decision 9 (2026-11-05):** when Joe saves a canvas to a job's files, **Share with staff** is pre-selected (derived areas such as Money pre-ticked); he can pick **Only Joe** on the Save screen. The API's omitted-audience default stays owner_only for safety.

The first permit portal, vault, company submission/payment approvals remain Browser decisions; shared host marks Browser-specific choices **Browser plan decides**. No new Canvas send/publish/grant capability.

## Appendix — Round-1 fixes

Each entry maps the exact “Required to reach 10” item to its normative change; no claim that a plan revision itself proves a 10/10 build or browser security test. D=design, E=engineering, S=security. Shared sections H1–H5 refer to `_ask-pane-host.md`, which Browser must adopt in its next revision (Browser plan was not edited here).

| Judge item | Plan section changed |
|---|---|
| Design 1 | §3; shared H1–H5: one AskContentPane/interface/layout contract. |
| Design 2 | §3.1; H1–H2: explicit dock expansion, arrival dot, fourth wireframe. |
| Design 3 | §3.1; H2–H3: real Operator/agent/History/New chrome and one segmented control. |
| Design 4 | §4.1: title picker, 56 px rows, last-viewed/newest behavior. |
| Design 5 | §§3.1/4: Ask for a change, updating copy, follow-latest default. |
| Design 6 | §3; H3: one history entry, popstate/iOS swipe, Escape/focus including iframe. |
| Design 7 | §§1/4/6.3/6.5/8.4: Preview · Code, plain format labels, exact fix/error/filename copy. |
| Design 8 | §§4/5.4–5.5: Joe/Claude/both rows and durable terminal rejection fallback. |
| Design 9 | §§4.1/5.1/8.2: change_note, bottom-sheet history, Previous/Next labels. |
| Design 10 | §3.2: light scheme/token theme, summary alternative and zoom/key/touch controls. |
| Design 11 | §4.2: final Joe/staff dialogs, 360/1280 wireframes, JobPicker/lead/result copy. |
| Design 12 | §8.4: Files row/chips, audience lock words, sandbox viewer provenance. |
| Design 13 | §6.5: no private-page Copy link, share via files; canonical floor link retained. |
| Design 14 | §§7.1–7.2: one design number, hidden edit chrome, 360/1280 floor wireframes. |
| Design 15 | §5.4: native old-client reply fallback and Open in Safari, no URL token. |
| Design 16 | §4.1: card anatomy/states/accessibility and reply → card → RunReview. |
| Design 17 | §3.1; H1/H3: narrow ‹ Chat / split × / expanded Back to app, no Hide. |
| Engineering 1 | §§3/5.2/8.1/10/11; H1–H5: shared typed host/admission/fixtures and explicit 0105 dependency. |
| Engineering 2 | §§5.2/8.1/8.3/10: actual stdio env/transport gate, protected SQL identity, background retry contract/attacks. |
| Engineering 3 | §§4.2/8.4/9/10/12: audience union/default/consent/hash/replay and monotonic per-write areas. |
| Engineering 4 | §§5.1/5.3–5.5/6.5/10: exact events/reads/cursors/capabilities/errors/mobile/kill metadata, DELETE only. |
| Engineering 5 | §§6.4/10/11: Next headers+proxy response implementation and actual matched-path/cache/browser checks. |
| Engineering 6 | §§8.2–8.4/10/11: named file resolver/callers, trash association/restore conflicts and delivery tests. |
| Engineering 7 | §§7.2/8.1–8.2/8.5/10: correct FK types/tombstones, all floor writers/hash/immutability/delete races. |
| Engineering 8 | §§8.2/10: global quota lock, durable rate counters/null-run caps and derivative/purge accounting. |
| Engineering 9 | §§8.4–8.5/10/11: named timer/lease/fencing/recovery/journal/health, isolated DB harness commands. |
| Engineering 10 | §§2/10/11: verified real anchors, existing integration files/tests and per-phase security/deployment handoffs. |
| Security 1 | §§5.2/8.1/10: HTTP even exact real tuple refused before internalCall; runner stdio+DB admission. |
| Security 2 | §§5.1/8.2/8.4/9/10: every write/save unions current full staff areas; current access/retries/copies fail closed. |
| Security 3 | §§4.2/8.4/9/10: strict human audience, owner default/consent/hash and existing-copy policy conflict. |
