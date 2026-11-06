# Canvas Phase 2 implementation handoff

Branch `t3/canvas-phase2-3`, starting at `1ace8ae8`. Phase 2 owns shared Canvas files; Phase 3 files and migration 0114 were not edited or staged.

## Purpose and build items

1. `lib/canvas-content.mjs`: dependency-free, closed HTML fragment parser, reconstructing canonical bytes rather than repairing malformed HTML. Strict per-property finite CSS grammars; responsive flex/grid, cards/tables, inline SVG through the existing independent drawing validator. Rejects scripts, handlers, all navigation, external resources, namespaces/integration points, custom properties, CSS escapes/comments/functions, overlay positioning, animation, malformed nesting and unresolved SVG fragment references. Innocuous `doctype/html/head/title/body` envelopes are extracted; meta/style/resources in head remain forbidden. HTML id/class/data attributes are deliberately refused. Original source stays in `source_text`; canonical `{html,validator_version:2}` lives in the predeclared `canonical_content`. Existing DB `content_policy_version=1` remains its envelope version.
2. `lib/canvas-renderer.mjs`, `components/panel/canvas/page-bridge.ts`: separate fixed source-independent page bridge. Parent authenticates current frame, null origin, random 128-bit instance and nonce, exact shapes and one transferred MessagePort. Child accepts its parent's one-shot handshake, then only bound print-layout commands. Source is never transmitted to or interpolated into the script. Ready/height/error/focus/Escape/Tab boundary messages only. Measurement limited to 8192 px and normally 5/s. Print toggles a trusted layout attribute and remeasures. No source execution, clicks, fetching, navigation or credentials.
3. `components/panel/canvas/server.ts`: authenticated selected-version preview route returns a complete HTTP document with independent opaque sandbox CSP, no CORS or Set-Cookie. Public Code access is independent: preview obtains private bytes through `canvasPagePreview`, not the public source endpoint. Failed revalidation never falls back to old bytes.
4. `lib/ask-canvases.ts`, `mcp/canvas-tools.mjs`: page availability/mutations/version restore/read through existing private journal, actor, provenance and CAS checks. Existing strict tool schemas already predeclared `{kind:'page',source:string}`. Page capability advertises `static_page` preview, HTML download, Save and restore. Diagram/floor permissions remain separate. Tool help includes exactly “Static HTML with inline styles and SVG. No scripts, links, or external files.”
5. `lib/canvas-exports.ts`: pages generate static HTML directly, without a client SVG derivative. Original source is revalidated for download/Save (including replay)/restore/maintenance. Same immutable audience, acknowledgement, provenance and crash-recovery flow as diagrams. Saved bytes include title/summary/date/version/Internal draft and a strict file meta CSP, no script or bridge. Existing `canvas_static_v1` file-serving policy is reused. Human-only original-source download is `.txt` and `text/plain`, gated by Code access; it is not advertised as a second page export in the menu.
6. `CanvasPane`, `CanvasCard`, `PageStage`, `PagePrint`, empty availability/feed/store: routed page iframe, page labels/About/help, escaped Code, responsive scrollable stage, trusted Fit/100%/zoom, compact touch controls, existing pane layout/Save dialog and standalone wrapper. Trusted print wrapper waits for ready, expands the bounded frame, prints the outer window only, hides controls in print, and offers HTML fallback. Over-limit height disables Print. No iframe same-origin/modals privilege.

## Limits and intentional parser choices

Up to 256 KiB source and canonical storage envelope, 5,000 aggregate HTML/SVG elements, HTML depth 24 (stricter than plan's 32), at most 32 SVG roots, existing SVG depth 32/path budget 100,000/dimension 8192. CSS declarations ≤4096 characters, tracks/repeat ≤24, lengths ≤8192px/100%/64rem/64em. SVG ids are consistently prefixed per drawing, with integral local references only. Numeric SVG drawing attributes follow the existing finite drawing grammar; CSS styles go on surrounding HTML. Raster images, stylesheet blocks and arbitrary author JavaScript remain unsupported by design.

The parser is a small explicit grammar rather than htmlparser2 repair plus sanitize-html: this keeps the factory executable in the existing diagram sandbox with no new dependency, and makes nesting/namespace rejection and canonical idempotence explicit. Unknown/unsupported syntax fails closed. Fixtures are realistic model-written responsive cards/tables and an SVG drawing with markers, viewBox, transforms, strokes, dash arrays and text, not toy strings. Expectations for 25 fresh adversarial inputs were written before implementation/execution.

## Routes, schemas and flags

- `GET /api/canvas/:id/versions/:version/preview`: page document, normal session/ownership/area/recovery/kind checks, `sandbox="allow-scripts"` in every frame.
- `GET .../download?format=html`: static attachment with strict HTTP CSP; `format=txt` returns original source as text, subject to source flag. Mixed pages do not offer SVG extraction.
- Existing show/update/get/list schemas, version/restore routes, save-policy/acknowledge/save routes and private file adapters unchanged in shape. No new MCP registration.
- `GET /panel/canvas/:id?v=n`: existing trusted new-tab wrapper. `GET /panel/canvas/:id/print?v=n`: trusted page print wrapper, independently authenticated.
- Production configuration unchanged: `canvas.pages_enabled` stays false. Runtime requires `SJC_CANVAS_ENABLED=1`, page flag true, existing staff/area/launch/privacy gates; exports additionally require `canvas.exports_enabled`. Source kill switch remains separate. QA seed script enables pages only in its explicitly named `sjcos_qa_*` target.
- No migration 0113, dependency install, new table or narrow-login write path. No manifest/grant changes and no registration handoff needed for Phase 2.

## Validation

All commands ran single test files, using unique `SJC_TEST_CLUSTER_TAG` values; DB work used only `tests/_harness/testdb.mjs`. All Phase 2 test clusters stopped. No live database, browser, server, build, service restart, push or deploy.

| Test file | Result |
|---|---|
| canvas-content | 58 passed |
| canvas-page-sandbox | 9 passed |
| canvas-exports-db | Initially 3/3 passed. Latest combined schema: 1 passed, 2 failed because of Phase 3's new trigger; page case separately rerun and passed. |
| canvas-routes | 22 passed |
| canvas-mcp | 40 passed |
| canvas-ui | 39 passed |
| canvas-commands-db | 21 passed before the later Phase 3 trigger edit |
| canvas-renderer | 7 passed |
| canvas-render-bridge | 29 passed |
| canvas-rollout-db | 7 passed |
| canvas-save-dialog | 30 passed |
| ask-private-query-scan | 10 passed, 1 failed: only Phase 3's new private-query inventory is outstanding |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit **0**. No Next build requested or run. Test logs are `/tmp/canvas-p2-*.log` for this session. Early failures (old unsupported-page expectation, literal HTML comment opener in stringified validator, reused test-DB slug collisions) were corrected or rerun with fresh isolated clusters; there was no resource kill.

### Coordinator integration blockers (outside ownership)

1. **0114 `canvas_floor_payload_lifecycle`**: the final combined IF uses `NEW.source_text::jsonb` in the same boolean expression as the floor-kind check. PostgreSQL can evaluate that cast for diagram rows. Latest full exports run fails two diagram tests with `22P02 invalid input syntax for type json` at transaction COMMIT; the page test passes because page canonical_content is non-null. Put the JSON cast inside a separate nested procedural IF entered only for `floor_plan` (do not rely on SQL AND short-circuit ordering). Phase 2 did not edit 0114. Rerun exports-db and commands-db after that fix on a fresh tagged harness cluster.
2. **Private inventory**: Phase 2 updated the allowlist for its own `lib/ask-canvases.ts`, `lib/canvas-exports.ts`, `scripts/qa-seed-canvas.mjs` only. Remaining scan errors name `lib/canvas-floor.ts` and `db/migrations/0114_canvas_floor_refs.sql`; the coordinator must review/audit Phase 3 files. Do not approve their hashes mechanically.
3. Phase 3 shared-file wiring remains the coordinator's work. No Phase 3 branch was enabled here.

## Visual release checks and how to seed

Coordinator only: use existing isolated QA build/identity protocol; run `scripts/qa-seed-canvas.mjs` with an explicit **sjcos_qa_*** URL, never a live/test default. It now emits `joe_page_v1`, `joe_page_v2`, `abigail_page_v1`, `abigail_page_v2` URLs alongside existing diagram states. Pages/staff are enabled in that QA DB only. These are screenshot/real-browser gates, not claimed by Node tests.

| State to capture | How to seed/open |
|---|---|
| Cards/table at 360, 820, 1280; 360×800 stage ≥420 | Seeded `joe_page_v1` wrapper/owned thread, select version 1; inspect overflow and card reflow. |
| Inline SVG and readable marker/text at those sizes | Seeded `joe_page_v2`; inspect text/markers, Fit/100% and zoom. |
| 800×360 landscape, stage ≥200; 1100 popout compact | Same page versions in existing pane host; verify one selector/exit and coarse vs fine pointer floats. |
| Title/meta/About in compact and fuller panes | ⋯ → About this page at 360/compact; disclosure at 820/full width; include picker and card type labels. |
| Older version/newer ready/restore/follow | Open v1 while v2 exists; Latest, Versions, then Use this version. No focus jump on update. |
| Escaped Code, Copy, page help | Show code / Code; fixture text contains `&amp;`; no model HTML rendered in trusted DOM. |
| Save and acknowledgement | Save to project files → select authorized QA project; staff default/baseline; remove areas as Joe and capture acknowledgement; save, then open/download static project file. Existing Save dialog is unchanged. |
| HTML download and print/PDF | Page (HTML); verify no bridge in downloaded file. Print wrapper waits ready; inspect multi-page cards/table/SVG in desktop and actual Safari/iOS print. Verify version/Internal draft, no chat/buttons and no clipping. Use HTML fallback if embedded print is unreliable. |
| Loading, timeout/error and retry | Throttle/block only the preview request in QA browser tools; capture Opening page, then after 10s unavailable-page copy with Show code / Ask Claude to try again / Try again. |
| Unavailable/auth/off/source off | Foreign QA account, expired session, page flag off, and source flag off in QA separately; generic unavailable/auth copy, retained Code when permitted, no private pixels across account/thread change. Source-off preview must still work. |
| Staff/owner scope | Seeded Abigail thread signed in as Abigail vs Joe's private link; shared project file only after explicit Save policy permits it. |

Not done: coordinator production build, screenshots, real HTTP/proxy/header captures, focus/Safari/iframe multi-page print acceptance, Phase 3 wiring/audit/trigger repair, rollout or deploy. Keep the page flag false until those checks pass. No push.

## Exact CSP constants for this commit

Page bridge SHA-256 (base64): `B2ulZeMK2KxKxb3ie21fkM7KGq1m+evtSd/eKHRRV4Q=`. Diagram bootstrap also changes because its shared validator factory changed: `rJhQpKKTfQ3xy2//IBauP6SG9pSINyCiJFt76JUWQ10=`. Hashes are computed from the emitted server script bytes; production transforms may change function stringification, so verify actual response hashes in coordinator acceptance.

Preview HTTP CSP:

```text
sandbox allow-scripts; default-src 'none'; script-src 'sha256-B2ulZeMK2KxKxb3ie21fkM7KGq1m+evtSd/eKHRRV4Q='; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

Static file meta CSP (HTML-escaped in the actual meta attribute):

```text
default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'
```

Download/error HTTP CSP uses `sandbox; default-src 'none'; script-src 'none'` plus the renderer policy tail; saved files use existing `CANVAS_FILE_CSP` in `lib/canvas-file-access.ts` (scriptless sandbox, no resources, self-only framing). Wrapper/print HTTP framing policy remains `frame-ancestors 'none'` + `X-Frame-Options: DENY`.

Exact download/error HTTP CSP:

```text
sandbox; default-src 'none'; script-src 'none'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

Exact saved-file HTTP CSP:

```text
sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

Preview/error Permissions-Policy:

```text
camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=()
```
