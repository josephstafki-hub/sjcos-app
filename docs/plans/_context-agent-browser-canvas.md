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
