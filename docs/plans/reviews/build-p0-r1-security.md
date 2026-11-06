SCORES: design=10 completeness=10

Security BUILD round 1. Reviewed HEAD 10487eb4 against the supplied Phase 0 scope, AGENTS.md, shared context, requested security plan sections and build handoffs. Scores cover the built, disabled surface; they are **not** Browser runtime or production rollout acceptance.

## Verified-sound items

- **Web sessions:** `lib/session.ts:60`, `lib/web-sessions.ts:32`, and `proxy.ts:64` mint a new DB sid on authentication, revoke a replaced sid transactionally, preserve authAt/generation on renewal, and recheck active user, expiry and revocation. Cookies are HttpOnly, Secure in production, SameSite=Lax and path `/`. Logout revokes before clearing. Browser cookie verification requires issuer/audience and a sufficiently strong secret, has no Bearer fallback, and rejects sid-less JWTs. Ordinary legacy Ask access is intentionally retained; it does not create a DB sid. Browser launch is currently rejected, and no Browser review/Watch data endpoint is implemented. Ordinary RunReview remains thread-owner scoped.
- **Admission:** `lib/ask-run-admission.ts:34` reloads the person, validates current ai access, enforces owned live threads and resume identity, and derives the profile. Staff cannot obtain operator through requestedProfile. Mobile source is set by its trusted adapter; action JSON/headers do not select source. Narrow SQL cannot insert panel identities or mutate admitted identity fields. Unbound worker runs remain business/background. Explicit verified-owner Telegram support does not confer panel_web or browser authority.
- **Privacy:** `db/migrations/0105_ask_thread_ownership.sql:43` checks actual session_user, with FORCE RLS and immutable ownership. The shared readers, actions, mobile adapters, search, owner replies, TTS, steers, attachment extraction and run review use self-owner fences. Joe has no blanket staff-chat exception. Private writes and reads stop when journal authority is unavailable; retained tombstones and cancellation prevent ordinary resurrection. Definer functions pin search_path and revoke PUBLIC EXECUTE; narrow roles receive only the visibility predicate's EXECUTE, which still refuses them.
- **GUC threat model:** narrow logins can set custom GUCs, but neither a matching/empty/random ask_actor nor ask_purge=yes bypasses session_user. Verified this with actual agent, worker and readonly session identities. The website login is deliberately trusted: arbitrary SQL execution as that login could clear/change ask_actor. This is not a SQL-injection sandbox, and no injectable caller was identified in the reviewed parameterized paths.
- **Interaction bridge:** `lib/ask-thread-journal-transport.mjs:4` captures runner identity at construction. Actual HTTP bootstrap and HTTP ALS reject before fetch; tool arguments cannot replace context. The secret-authenticated internal route uses strict schemas and fixed errors. Its command repeats live run/person/profile/start/thread/source/revocation checks. Local interaction IDs are restricted to those created by the adapter. No raw narrow SQL fallback remains.
- **Network/contracts:** pure decisions reject numeric/hex/octal IP aliases, IPv6 literals/zones, trailing dots, invalid authority and non-global/mixed resolver answers. IDNA canonicalization yields exact origins, not visually confusable equivalence. CNAME chains, expiry, listener generations, socket address and CONNECT/Host/SNI bindings are checked. Successful containment explicitly still requires request authorization. Strict tool schemas reject extra identity/authority fields and private observations cannot contain public page text.
- **Renderer:** `lib/canvas-renderer.mjs:204` specifies opaque-origin HTTP sandbox plus iframe allow-scripts only, hash-only scripts, no outbound resources, no forms/base/frames/workers, no-store and no-referrer. Generated content is not interpolated into scripts. The vendored digest test passes. Inspection confirms the three comment-opener rewrites are two JS strings and one regex; `\x3C` preserves their semantics. README records upstream integrity and final digest; this review verified local final bytes, not a fresh registry download.
- **Grants:** manifest matches the private session/browser/maintenance tables' withheld narrow grants. Actual-login probes confirm no SELECT on sampled private tables and no EXECUTE on the privileged trigger/helper functions.
- **Paused/500 behavior:** missing journal configuration is converted to fixed paused text before private queries. Production Server Component errors are generic plus digest per the installed Next error guide and the app error boundary; ErrorPanel renders escaped text, not HTML or error causes. No private payload leak was found by inspection. No live HTTP/build/browser verification was performed.

## Vulnerabilities / gaps

No demonstrated exploitable or data-exposure gap requiring a source change in this built scope.

## REQUIRED fixes

None.

## Verification and optional follow-up

Single files run sequentially with disposable tag `p0r1sec-20261105-1745`:

| File | Passed |
| --- | ---: |
| ask-thread-access-db | 33 |
| web-sessions-db | 4 |
| ask-run-admission-db | 4 |
| ask-thread-recovery-db | 60 |
| browser-network | 94 |
| browser-contract | 23 |
| canvas-renderer | 7 |
| canvas-content | 51 |
| db-roles-manifest-db | 6 |
| browser-roles-db | 3 |
| db-roles-paths-db | 3 |

Additional inline adversarial DB assertions tested all three narrow session identities with matching/empty/random actor plus purge spoofing, private table privileges and definer EXECUTE denial; all passed. No test source file was written.

The first `db-roles-paths-db` invocation was interrupted by premature disposable-cluster cleanup. The isolated recheck passed all three tests and exited 0 after approximately 34 seconds, including its delayed process cleanup. The disposable cluster was stopped after completion.

Keep the handoffs' runtime gates: real isolated Chromium/gate/namespace fixtures, HTTP/Safari CSP enforcement, parent bridge integration, provenance, and production journal/restore acceptance remain unverified. Keep all relevant activation/deletion gates closed until those checks pass. In future route integration, supply the pinned Mermaid digest, not a freshly computed digest of arbitrary disk bytes.

No source edits, installs, Next processes, browsers, live/QA DB access or service changes. Only this report is committed.
