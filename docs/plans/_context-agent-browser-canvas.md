# Shared context: in-app agent browser + Ask-panel canvas (2026-11-05)

Read this whole file before you draft, build or judge anything for these two features.

## What Joe asked for (verbatim)

> how feasable is in app browser use when using the web version? id like to be able
> to interact with the browser to fill out account info etc when needed. Id use this
> so the agent can pull permits and perform other functions. I'd like to have the
> other features of the claude and chatGPT apps as well like the canvas where it can
> draw diagrams etc

After a feasibility answer (below):

> okay build both and use the council of sub agents like ive had other sessions do.

The bar: a panel of judges scores each plan, and later each build, on **design** and
**completeness**. Work is revised until every judge gives 10/10 in the same round.

## The feasibility answer Joe approved (direction, not a spec)

**Browser.**
- One shared Chromium runs on the server as its own systemd service with a
  MemoryMax cap. Its profile is saved, so logins persist.
- The in-app Claude drives it through Playwright MCP attached over CDP (not a new
  Chromium per chat).
- A **live view** streams the page into the Ask panel (CDP `Page.startScreencast`
  frames, or an equivalent).
- A **Take over** button sends the user's own mouse and keyboard to the page
  (CDP `Input.dispatch*`), then hands control back to the agent.
- Passwords never enter the model's context.
- A **hard stop before Submit / Pay / Sign** on outside sites becomes an approval
  card.
- Allowed sites are set per task. Treat page text as untrusted data
  (prompt-injection).

**Canvas.**
- A side pane in the Ask panel shows diagrams and pages the agent makes.
  - Level 1: diagrams (e.g. Mermaid) rendered client-side.
  - Level 2: agent-written HTML/SVG in a locked-down sandbox (opaque origin, its
    own CSP; it must not reach the app, cookies or APIs).
- Canvases can be saved to a project's files.
- Construction drawings go to the existing floor designer, shown inline; it is not
  duplicated.

## Joe's decisions (2026-11-05). These override anything else.

1. **Browser users, v1: Joe + staff.** Staff Ask-window runs can drive the browser
   too, limited by their area permissions. **Unattended agents get no browser in v1**
   (background/business runs, the worker, Telegram-started runs).
2. **Logins: an encrypted vault in SJC OS + take-over.**
   - Joe saves a site login once.
   - The agent asks to "fill the login for <site>". The server fills the fields in
     the page without the password ever entering the model's context, the chat
     transcript, logs or screenshots sent to the model.
   - For 2FA / CAPTCHA the person takes over the live view.
3. **Final Submit / Pay / Sign on an outside site: ALWAYS stop and ask.**
   - The agent fills everything, then stops and raises an approval card with a
     screenshot and a plain summary of what will be submitted.
   - Nothing is submitted or paid until the person approves on the card (or clicks
     it themselves during a take-over).
   - Payments use company money, so they need Joe's owner approval (owner grant)
     even when a staff run gets there. Plans must define exactly who can approve
     which kind of step.
4. **First permit portal: decide later.** Build it generically. Per-city runbooks
   come after the browser works.

## Existing code to build on (verify each before relying on it)

- **Ask panel (in-app Claude):**
  - UI: `components/panel/` (PanelChat, PanelWindow, PanelDock, WorkbenchPanel =
    right-hand live entity pane, GrantCard, RunReview, AssistantMarkdown).
  - Runs: `lib/dev-agents.ts`, `lib/actions/dev-agents.ts`, detached runner
    `scripts/run-claude-agent.mjs`. Profiles are in `lib/authority/run-profile.mjs`:
    operator = owner with repo access; business = sjcos tools only, restricted.
  - The panel polls run state. There are no websockets in the app today.
- **Playwright hook already exists but is unused:** `scripts/run-claude-agent.mjs`
  ~line 935 adds `mcp/playwright-mcp.config.json` (when present) for operator runs,
  attaching to *Joe's own Chrome* over CDP. See `mcp/playwright-mcp.config.example.json`.
  The live checkout has no such config file. The plan should replace or extend this
  with the server-side browser service.
- **In-chat approvals:** `mcp/interact-mcp.mjs` (`approve_action` permission prompt
  → panel question box), `components/panel/GrantCard.tsx`, owner grants
  `lib/owner-grants.ts` / `lib/owner-grant-types.ts`, `request_owner_permission`
  → `/engine/permissions`.
- **Assistant reply rendering:** `components/panel/AssistantMarkdown.tsx` is
  deliberately tiny and safe (no raw HTML or images). Keep it safe.
- **Sandboxed file serving precedent:** `lib/file-serve.ts:109`
  (`Content-Security-Policy: sandbox; default-src 'none'; …`).
- **Permissions:** `lib/permissions.ts` (`PermissionKey`), `can()` in `lib/dal.ts:70`.
  Staff areas: memory "staff users & access".
- **Encryption precedent:** `lib/backup/crypto.ts`; Gmail tokens in `lib/gmail.ts` / `lib/mailbox.ts`.
- **Floor designer:** plan tools `create_plan_design`, `apply_plan_ops`,
  `get_plan_design` (mcp/), project tab "Floor".
- **MCP server:** `mcp/sjcos-mcp.mjs` + `mcp/*-tools.mjs`; a separate live service
  `sjcos-mcp.service`.
- **Hosting:**
  - Live is `next start` on :3017 behind nginx (`deploy/nginx-sjcos.conf`) and a
    Cloudflare Tunnel (`deploy/sjcos-tunnel.service`). Websockets need explicit
    nginx `Upgrade` handling (none today); SSE also works.
  - Units live in `deploy/*.service|timer`.
- **Chromium:** Playwright's Chromium is installed at `~/.cache/ms-playwright/chromium-1228`.
- **DB logins:** narrow roles (`deploy/db-roles.md`, `deploy/db-roles.manifest.json`).
  New tables or write paths must update the manifest in the same migration.
- **Migrations:** reserved **0100–0109** for this work. Check `origin/main` and open
  branches before using one: subs=0091 and phone-push=0092 are already taken
  elsewhere.

## Constraints

- The box is shared. Joe's account has a hard limit of 24 GB RAM / 8 threads total.
  Plan resource caps: browser MemoryMax, max concurrent sessions/tabs, idle
  shutdown, and how staff concurrency is handled (queue? one tab per user?).
- Never send client-facing anything without an owner grant (AGENTS.md). A permit
  application is an outside submission, so decision 3 applies.
- Joe's words, not invented nouns (memory: joes-words-not-invented-terms). On-screen
  copy is plain and short.
- Phone and tablet matter. Joe uses the app on an iPhone and iPad too (an iOS app
  exists, `/home/joe/sjcos-mobile`). Say what the live view and take-over do on a
  phone (v1 may make take-over desktop/tablet only, but then it has to say so on
  screen).
- No deploy without Joe. Plans must include migrations, flags, rollout, rollback, and
  "what Joe must do" (e.g. install a unit, add an env var).

## Plan files

- `docs/plans/agent-browser-plan.md`: the browser, live view, take-over, vault,
  stop-before-submit, and the permit-pull runbook shape.
- `docs/plans/ask-canvas-plan.md`: the canvas pane, its levels, saving, and the
  floor-designer tie-in.
- Reviews go in `docs/plans/reviews/round-N-<lens>.md`. Builds go in
  `docs/plans/build/<feature>-phaseN-HANDOFF.md`.

## Judge lenses for these features

- **design** (Claude): screens at 360/820/1280, every state's copy, phone behaviour,
  plain words, staff vs owner.
- **engineering** (Codex Sol): it can be built as written in *this* repo (real
  file:line), data model, migrations, db-roles, tests per phase, failure/recovery,
  resource caps, rollout/rollback.
- **security** (Codex Astra): credential vault crypto + key handling, password never
  reaching the model, screencast/take-over authz, CDP exposure (must never be
  reachable off-box), SSRF / internal-network reach from the browser (block
  127.0.0.1, 10/8, 192.168/16, metadata IPs, the app's own admin paths),
  prompt-injection from web pages, canvas sandbox escape, staff vs owner limits,
  audit trail.

## Joe's decisions, round 2 (2026-11-05)

5. **Saved logins are shared per site with named staff.** Joe picks which staff can
   use each saved login. Their runs can fill it; they never see the password.
6. **In v1 Joe approves every final step that commits the company** (submit, sign,
   pay), even when a staff run reached it. Staff cannot approve these.

Migration split: browser **0100–0104**, canvas **0105–0109**.

## Joe's decisions, round 3: canvas (2026-11-05)

7. **Canvas retention:** a canvas lives as long as its chat thread. Deleted canvases
   are purged after 30 days. A canvas saved to a job's files stays there like any
   other file.
8. **Canvas visibility:** private to the person whose chat made it. Once saved to a
   job's files, anyone with access to that job's files sees it. **Internal only:**
   canvases are never shown to clients in v1.

Branch note: T3 renamed this branch to `t3/in-app-browser-agent-tools`.

9. **Canvas Save default (Joe, 2026-11-05):** when Joe saves a canvas to a job's
   files, **Share with staff** is pre-selected. Required areas such as Money are
   pre-ticked. Joe can pick **Only Joe** instead.

10. **Chats keep working; deletion waits (Joe, 2026-11-05).** The all-chat recovery
    gate applies only once chat deletion has ever been switched on. Until the separate
    deletion-record service exists, deletion stays off and chats work normally.
    Details: `_ask-pane-host.md` A1.1.
11. **Old chats go to whoever started them (Joe, 2026-11-05).** A legacy chat whose
    runs were all started by one person belongs to that person (Abigail keeps her 2).
    Chats with no recorded starter go to Joe; mixed ones are held aside. See A1.2.

## Coordinator build decisions: Canvas Phase 1 (2026-11-05)

- **Migration renumbering** (so parallel builders don't share one file):
  - **0106_ask_canvases.sql:** canvas, version, request, event, quota and rate records, plus static-page predeclaration.
  - **0107_ask_context_provenance.sql:** complete business-run provenance (§9.1). Canvas versions store the provenance *revision + manifest hash* with no FK to 0107 tables, so 0106 stands alone.
  - **0108_ask_canvas_files.sql:** derivatives, saves, audience, trash.
  - **0109_ask_canvas_floor_refs.sql:** floor references.
  - Canvas-only rollout stays 0100 + 0105–0109.
- **Provenance seam:** `lib/ask-context-provenance.mjs` `conversationProvenance({client, threadId})`. Until the provenance builder lands, it is a fail-closed stub that always returns unknown, which means the full catalog.
- **MCP registration:** each builder exports a `register…Tools` function from its own `mcp/*-tools.mjs`. The coordinator wires them into `mcp/sjcos-mcp.mjs`.
- **Order:**
  1. Canvas core backend and Canvas UI run in parallel.
  2. Provenance + native-reader removal + ask_owner gates follow (they share the db-roles manifest with the core backend).
  3. Project-file save/exports come after that.
- **Build round 1 is blocked on the deferred pane-host captures:** landscape strip, 839/840/1000, 1100 popout pane, and 1280 expansion + Back to app.
- **Migration note (2026-11-05):** `0109_canvas_control_envelopes.sql` uses 0109, because main already ships `0110_phone_lines.sql` and `0111_sms_threads_per_line.sql`. Floor refs (Phase 3) will take the next free number on main at build time.
- **Merge with main (2026-11-06):** `0112_ask_phone_copy_privacy.sql` is the additive fix that protects private copies in main's phone-push/phone-line paths. No other branch uses 0112. #119 was closed as superseded; #120 → main now holds Phase 0 + Canvas Phase 1.

## Coordinator build decisions: Canvas Phases 2 and 3 (2026-11-06)

- Phase 0 + Canvas Phase 1 are LIVE (PR #120, main c922976b, build 5qiHPktn). Canvas is on for Joe only (`canvas.staff_enabled=false`).
- Joe (2026-11-06): "Do the installs then continue with canvas". Phases 2 and 3 are built now on branch `t3/canvas-phase2-3` (worktree t3-cf34c1be). Browser 0b waits on draft PR #121.
- Migration numbers: the plan's "0108 if needed" / "0109" are taken (0108 = saves/exports, 0109 = control envelopes, 0110–0112 = main). **Phase 2 reserves 0113 (use it only if needed); Phase 3 reserves 0114.** Never create any other number.
- Two Codex builders run in parallel with strict ownership:
  - **Phase 2 builder** owns the shared canvas files.
  - **Phase 3 builder** owns the new floor files and writes the exact shared-file hook it needs into its HANDOFF; the coordinator applies it.
- Real fixtures only: capture real browser/library output (lesson from Phase 1's Mermaid filters).

## Joe's decisions, round 4: payment details (2026-11-07)

Joe, verbatim: "No separate virtual cards would be too complicated on my end. A secure way to store payment details would be great. Permission always needed right before use."

- Store the company's payment details (card) securely in the Browser vault. No virtual or single-merchant cards.
- Joe's permission is needed right before every use: the card is filled only for a Pay step Joe has just approved, never earlier and never reused.
- This overrides the earlier plan text that kept card numbers out of the vault and made card entry a manual take-over only.
