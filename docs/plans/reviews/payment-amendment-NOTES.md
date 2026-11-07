# Payment amendment P1 — change inventory (2026-11-07)

Baseline requested: `a33f9d22`; only the Browser plan and this new notes file are owned by this documentation task. Parallel builder commits are outside this change. No push, source edits, runtime tests, browsers, servers or deployment.

Every added/replaced body sentence is reproduced verbatim below, grouped by its complete paragraph, list item or table/wireframe row, with its section and final plan line. Unchanged surrounding sentences within a paragraph are retained for readability. This inventory excludes the wholly new Amendment P1, which is linked separately, and the unchanged historical Appendices.

New normative amendment: [Amendment P1](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4304), P1.1–P1.7.

Choice made explicit: the security code is stored encrypted with the card; P1.1 states the added compromise risk and distinguishes this implementation rule from Joe’s verbatim request. No new question needs Joe. The existing deferred first portal recommendation remains the city with the next real application, after generic acceptance.

Validation: full-plan card/CVV/payment and related pre-click/dependency/flag sweeps, body-versus-amendment consistency review, whitespace/diff and authorized-path checks. Proposed tests are not claimed to pass. Phase 1 being built now is unaffected.

## 1. In-app agent browser — implementation plan — line 3

[Plan, line 3](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3)

```text
Status: design for review; no implementation or deployment authorized by this file.
Revision baseline: `t3/in-app-browser-agent-tools`, HEAD `2c321665`, 2026-11-05.
Round-3 revision: design items 1–8 and engineering items 1–2, against HEAD
`fd640d04`; round-3 security 10/10 guarantees retained; owner decisions 1–9 govern. Proposed mechanisms
and release gates below are not claims of runtime verification.
Round-4 revision: design items 1–4 and engineering item 1 against HEAD
`c8aba006`; round-4 security 10/10 retained. Host H1–H5 re-adopted at
`85a7a5c6`, including the round-4 shell and explicit passive Watch exit.
Round-5 revision: design items 1–3 against HEAD `febc1e26`; round-5
engineering and security 10/10 contracts retained. Changes are layout, device
definitions, copy and proposed acceptance cases only; see Round-5 fixes appendix.
Payment amendment P1 (2026-11-07): round-4 payment decision governs Phase 3 only;
Phase 1 being built now is unaffected.
Normative owner decisions: `_context-agent-browser-canvas.md`, “Joe's decisions.”
This plan owns the browser; `ask-canvas-plan.md` owns Canvas. Both depend on the
shared host/auth prerequisites (§6.2); neither renderer requires the other enabled. Technical names below are implementation names, not UI copy.
```

## 2. 1. Joe's request and the result — line 28

[Plan, line 28](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:28)

```text
Joe has decided: **Joe and staff can use it; background agents cannot. Logins go in
an encrypted vault and people can take over for 2FA or CAPTCHA. Always stop before
final Submit / Pay / Sign. **Joe approves every company-committing final submit, sign and pay, including
staff runs. Saved logins are shared per site with named staff who never see
the password.** Pick the
first city later.** These are requirements, not questions awaiting another decision. Joe also chose
securely stored company payment details, with permission right before every use
(Amendment P1, Phase 3); payment cards are owner-only, never shared logins.
```

## 3. Words used — line 62

[Plan, line 62](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:62)

```text
| Saved logins / Save a login / Fill login | Login vault list, entry form, server-side login fill |
```

## 4. Words used — line 63

[Plan, line 63](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:63)

```text
| Payment card / Add card / Replace card / Remove card | Joe-only settings, Phase 3 Amendment P1; never a Fill card button |
```

## 5. Words used — line 64

[Plan, line 64](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:64)

```text
| Pays with Visa ending 4242 | Joe-only saved-card line on the exact Pay review, Amendment P1 |
```

## 6. 5.1 Vault contents and encryption — line 815

[Plan, line 815](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:815)

```text
Root provisions `/etc/sjcos-browser/vault-keys.json`, root:service 0640, directory
0750, read only by the browser service through systemd `LoadCredential`. The
repository, `.env.local`, app/CLI env, database and backups of application data
contain **no vault key**. Website receives metadata and boolean login/profile results only (the separately authorized
confirmed-business-fact hand-off projection is specified below). Local controller RPC encrypts Save a login over Unix socket; web process handles
submitted secret transiently but must never stringify/log it or write agent rows.
Entry form is a direct authenticated API request, not a chat message or generic
Server Action result that echoes a submitted value. Password fields have
`type=password`, `autocomplete=new-password`; no password reveal/copy API, no
secret in analytics, error reports, request-body logs or APM. TLS and no-store
for the web form. Manual login secrets use the private input endpoint, not a
chat composer. Never store 2FA seeds or recovery codes. Stored company card
number, expiry, cardholder name, billing address/ZIP and security code use only
Amendment P1's separate owner-only `payment_card` purpose in Phase 3; the login
vault and its named-staff sharing rules never contain or authorize a card.
```

## 7. Envelope format (normative for every private artifact) — line 865

[Plan, line 865](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:865)

```text
| payment_card (Phase 3, Amendment P1) | card_id, owner_user_id, card_revision, installation_id; own independent KEK; no mutable merchant origin on a reusable stored card |
```

## 8. 5.2 Visibility and filling — line 885

[Plan, line 885](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:885)

```text
This subsection describes login entries; Amendment P1 alone governs payment
card ownership, visibility, fill and the additional sticky payment dependency.
Each login entry belongs to one SJC OS user. Staff creates/updates/deletes only their
own entries. Joe manages Joe-owned entries and can grant named staff **use** of selected
company entries, with required areas. Joe can disable delegated access, but does
not get a “show staff password” feature. Staff never enumerates another user's
private entry; list results contain label + exact site, visibility, last-used,
never username/password/cookies. Joe-owned company credentials shared with staff
get per-staff saved state, but **delegated-secret mode is stricter than ordinary
private mode**. Staff never receive arbitrary pixels, DOM, page titles, account
settings/reveal controls, downloads or remote pointer/keyboard from a shared-secret
context, before or after filling/restoring. Joe alone can view that private context
via explicit owner join; even Joe's pixels never enter model context. Staff see
“Login from Joe. Only this site's supported steps are available.” with reviewed
business controls and released fixed-schema outputs, not a remote image. Account
settings, reveal links, generic takeover and raw artifact exports/uploads are
unavailable to staff; masking a password input is not the boundary.
```

## 9. 5.2 Visibility and filling — line 937

[Plan, line 937](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:937)

```text
Vault dependency is authoritative and separate from privacy. Persist on each
runtime context `vault_dependency=none|fill|restore`, login ID and credential/
profile revision plus context generation (P1 adds a separate payment dependency
only in Phase 3). `none` here means no login/profile dependency;
only a service guarded transition under the context lock can set fill/restore,
**before decrypt/restore** and before any secret can affect the context. It is
sticky for that context, even if fill fails or fields/cookies are cleared. It
cannot be set/reset by a client/model or inferred from whether inputs look secret.
A fresh anonymous context alone resets dependency to none after destroying/fencing
the old context (§6.1). Disabled vault denies login/profile decrypt/fill/restore/profile save;
on disable, revoke proofs and close all fill/restore-dependent contexts, including
delegated_secret, within 5 s. A `none` anonymous context with no P1 payment
dependency, made permanently private by manual take-over, continues with no
model observation and all effective write/
file flags enforced. Never enable vault merely to obtain take-over or turn a
manual context public. This permits Phase 1 with vault/files/final flags off.
```

## 10. 5.2 Visibility and filling — line 1027

[Plan, line 1027](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:1027)

```text
This is a deliberate v1 product limit, not a claim that regex redaction makes any
hostile page safe. It still permits generic manual account entry and later
reviewed city adapters that fill known permit fields. An adapter declares fixed
locators, field types, safe request patterns and receipt checks; model-controlled
code is never an adapter. Private downloads can save to project files for people,
but model-read APIs/attachments must honor the file's restricted provenance (§8).
**All** manual inputs use the no-log private endpoint regardless of field type;
no detection-after-typing exception. The service rejects attempts to type into
password/OTP/card/account-secret fields via ordinary `browser_act`; it redirects
to private Take over, or to Amendment P1's Joe-only Pay review for a saved card.
Don't solicit secrets in chat.
```

## 11. 5.3 Origin binding and sites — line 1041

[Plan, line 1041](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:1041)

```text
Bind to canonical HTTPS origin (scheme, IDNA host, port=443), not substring,
eTLD+1, wildcard or a matching page title. `city.example.evil`, userinfo URLs,
trailing-dot tricks, alternate ports and subdomains are different. Validate
origin again immediately before fill under the same serialized context lock;
navigation epoch changes abort. No login fill into a cross-origin iframe, even
if a popup resembles the saved login; the separately reviewed payment-processor
iframe exception is only Amendment P1, never a login exception. SSO is an explicit
list of individually reviewed
HTTPS origins; each credential belongs only to its IdP origin, and no passwords
are copied across origins. Cookie domain scope must not broaden beyond an
approved chain. Redirect to an unapproved site pauses before request; saved
password never follows it. Sharing one provider's origin across unrelated
tenants requires tenant binding in the credential mapping; unsupported tenant
identification means Take over, not autofill.
```

## 12. 6.3 Wireframes and complete start/task/review flows — line 1719

[Plan, line 1719](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:1719)

```text
│                                    │ Pays with Visa ending 4242              │
```

## 13. 6.3 Wireframes and complete start/task/review flows — line 1779

[Plan, line 1779](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:1779)

```text
**Stored-card Pay review (Phase 3):** Joe sees **“Pays with Visa ending 4242”**
under payee/amount in Joe's own-task §6.3 layouts, including 820 and short landscape;
expiry and approved processor origin are in Review details (Amendment P1).
The action stays **[Pay $125.00 once] [Don't pay]**; no separate fill or remembered
permission. Staff never see the saved-card line or any card metadata. Joe's
owner layer on a staff task has no saved-card option; P1.1 requires hand-off
to a fresh Joe task and a new review before stored-card use.
```

## 14. 6.4 Saved logins, field mapping and private file save — line 1996

[Plan, line 1996](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:1996)

```text
Joe-only **Payment card** settings are separate from Saved logins: Amendment
P1.4 specifies the 360/820/1280 screens, entry, replacement and removal; no staff
sharing control, card row in Saved logins or Fill card button.
```

## 15. 6.5 States, exact copy and recovery — line 2284

[Plan, line 2284](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2284)

```text
| Key unavailable | “Saved logins are unavailable. You can sign in yourself.” | Take over; Save/Fill disabled; no plaintext fallback; payment key errors use Amendment P1.4 |
```

## 16. 6.5 States, exact copy and recovery — line 2285

[Plan, line 2285](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2285)

```text
| Stored-card Pay / settings (Phase 3) | Joe: “Pays with Visa ending 4242”; all add/replace/remove/empty/error/success states in Amendment P1.4 | Exact Pay once / Don't pay only; staff “Waiting for Joe”, no card details; P1 expiry/drift never autofills |
```

## 17. 7.1 Detection is layered; heuristics are not a guarantee — line 2397

[Plan, line 2397](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2397)

```text
A pending intercepted request lives only in **gate memory**, maximum 60 s from
headers including body collection and review, with secret review manifests
encrypted if durably retained. Controller holds only its bounded control handle;
CDP may continue it into the closed gate for full-body collection, never upstream. Only a pre-click adapter approval card can
last longer (§7.3); an expired network request is **not replayed**. A card depending on that buffered
request becomes stale at 60 s (display shorter countdown); a pre-click adapter
review can last 5 min and create its request only after approval (Phase 4);
Amendment P1's narrow Phase 3 stored-card review instead expires within 60 s. Rebuild
the review from the current page; require a new person click if the live request
was lost. Server must never “test click” a final button against a live site just
to discover its behavior. Unknown bodies, ambiguous submission semantics or
multiple unbounded mutation requests mean **Take over / unsupported**, not an
unreviewed macro. The later Phase 4 pre-click adapter contract, and only the
narrow Phase 3 stored-card exception in Amendment P1, allow **one** final request
per review. Any earlier prepare/save request is a separate exact review/action; read-only prerequisites
need their own read manifest. No multi-mutation macro or wildcard subordinate
approval; reject a second mutation even if sent to the same endpoint.
```

## 18. 7.2 Who approves which step — line 2448

[Plan, line 2448](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2448)

```text
A deliberate final click by the controlling person is the decision-3 exception
to an **agent** approval card only when a reviewed adapter can establish the
exact fixed endpoint/value manifest **before** the event, not a blanket bypass.
It uses the approved pre-click arm→actual-bind protocol, without a second grant. The input handler first
pauses the final event, derives the same action snapshot, binds an authenticated
human-input nonce (5 s, target + control/document epochs), and verifies that
the on-screen action, amount/payee and category are determinable. It records
`approval_method=direct_person_click` and uses the web-only approval command.
For Joe's company payment/sign/submit it mints and consumes the same exact owner
grant; no second agent approval is needed, except stored-card use always
requires Amendment P1's explicit first-party Pay review before any fill. For
staff owner-only actions it creates Waiting for Joe and transmits nothing. If the snapshot is ambiguous,
show the first-party review card; never infer permission from arbitrary keydown,
a programmatic site click, a hidden element or stale human input. A site-driven
request without the correlated human nonce remains guarded as an agent request.
```

## 19. 7.3 Review snapshot, token, expiry and one execution — line 2466

[Plan, line 2466](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2466)

```text
Review card contains server-derived canonical origin/payee, task + project,
action type, full plain summary, field/value manifest excluding login secrets,
attachments with file hashes, amount in integer cents + displayed currency,
terms/attestation text when relevant, **protected human-only screenshot** and
time. Stored-card Pay adds Amendment P1's card revision, processor/frame/field
bindings and saved-card line, never card values. Unknown fee is “Fee: not shown,”
never $0. Human-only screenshot of a private context is never a model image attachment or ordinary files row. Page
strings are untrusted; render escaped text only and visibly distinguish them
from trusted origin/amount/accounting labels. Agent summary is supplemental,
never the sole source of payment amount. Login/action secret fields are omitted
from summary and blurred for retained human review when reliably locatable;
if not, do not retain pixels, show live protected private view and require
human take-over. Review requires both an available image/live view and a summary.
```

## 20. 7.3 Review snapshot, token, expiry and one execution — line 2544

[Plan, line 2544](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2544)

```text
Approval/execution protocol: **two general paths**, no remote I/O inside SQL, no automated final click
before human approval and no live “test click.” Both keep the gate closed until
an actual request is bound and exact evidence anchored. Amendment P1.3 is the
sole Phase 3 stored-card extension: consume before decrypt/fill, then bind the
actual request once without a second consume; its dedicated functions and
executing state supersede the generic arm/bind ordering only for that path.
```

## 21. 8.2 Download, upload and file provenance — line 2865

[Plan, line 2865](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2865)

```text
Upload is only a person-picked existing project file, freshly authorized at
selection and transmission, ≤25 MiB, with stable file hash. Service receives a
stream via authenticated internal bridge, not filesystem path or reusable
signed URL. Never permit `/etc`, HOME, repo files or `file://`. Review **“Send
{name} to {origin}?”**, exact site/attachment hash once; if part of a final form,
bind upload manifest to that action. Joe's buttons **[Send once] [Don't send]**;
denial **“Not sent.”**; staff uses §6.3's waiting template. Client/vendor-facing document send or
company attestation requires Joe's grant under §7; a company upload, including a draft upload,
requires Joe's exact release approval. Browser cannot send private files to another
site without person review and appropriate owner authority. Payment card entry
is Joe-only: private manual take-over, or Amendment P1's Phase 3 encrypted
stored-card form and exact approved Pay execution; never model extraction,
transcript entry, file upload or ordinary login fill.
```

## 22. 8.3 Prompt injection — line 2994

[Plan, line 2994](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:2994)

```text
Web text is data. Public snapshots wrap it as `untrusted_page`, separate from
trusted instructions; truncate to 32 KiB and strip active markup, hidden inputs,
password/OTP/payment values and URL tokens. Model may follow the person's task,
not page instructions to change sites, credentials, tools, permissions or project.
Model outputs are escaped; page text cannot manufacture a first-party review
card. Tools don't accept executable selectors/code, arbitrary DB/HTTP requests,
allowlist edits, grant decisions or secret payloads. New referenced file/site is
an ask to the person. Browser profile's SJC tool allowlist prevents page injection
from exfiltrating via email/knowledge capture or creating another privileged run.
Standard owner-grant gates apply in addition to browser gates, never instead.
Amendment P1.6 adds payment-page injection, look-alike origin, hidden field,
script exfiltration and replay cases; page instructions never authorize card use.
```

## 23. 9. Schema, migrations and database authority — line 3014

[Plan, line 3014](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3014)

```text
Round-2 read-only inventory checked `origin/main` (`10063e5e`) and all **118** currently available
`refs/remotes/origin/*` migration tree (no fetch/live DB). `origin/main` now has
`0110_phone_lines.sql` and `0111_sms_threads_per_line.sql`; no 0100–0109 file is
present in available refs. `db/migrate.mjs:32–39,54–57,76–108` applies every missing
number transactionally and rejects duplicates/checksum edits; a higher applied
number does not prohibit additive lower reserved migrations.
Unpushed branches cannot be discovered. Reserve **0100–0104 for Browser**,
leave **0105–0109 to Canvas**. Recheck before implementation/merge, coordinate
by feature filename; never renumber an applied migration. No migrations created
by this planning task; copy canonical DDL to `db/schema.sql` during the build.
Amendment P1.5 reserves a later additive Phase 3 payment migration, **number
assigned at Phase 3 build**; never add its tables/columns to Phase 1 migrations.
```

## 24. 9.2 Protected writes and narrow-role matrix — line 3082

[Plan, line 3082](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3082)

```text
Amendment P1.5 extends this catalog only in Phase 3: website-only payment-card
management, no narrow direct access, and a dedicated service one-use execution
proof; `browser_read_secret` never accepts `payment_card`.
```

## 25. 9.2 Protected writes and narrow-role matrix — line 3246

[Plan, line 3246](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3246)

```text
**Atomic grant SQL implementation (general buffered/pre-click paths only):**
Amendment P1.3 uses separate payment begin/take/bind functions: consume before
decrypt, require executing proof and once-bind actual bytes without a second
grant use; generic arm/bind functions reject its payment_card review mode.
`browser_bind_consume_action` locks task, action,
then exact owner_grants row and, for a hand-off company action, its bound effect.
Verify effect eligibility/evidence revision and CAS executing in the same consume
transaction, so new runs/CSRF cannot bypass a received/unresolved effect. Check web-approved action and approver session,
initiator session/device attendance, immutable original run/task association,
snapshot/document/control/listener epochs, active user/areas, expiration,
review_mode, actual request digest/flow nonce/listener generation, read manifest
revision/digest, request readiness/deadline, hashed token, grant status/action/target=browser_action:A,
run_id=action.run_id, snapshot digest, amount/currency/payee, max_uses=1 and uses=0.
Reject `*`, null scope, wrong run and general Express grants. For buffered mode supplied bindings must match preapproved exact flow;
for pre-click require armed, immutable manifest proof, once-dispatched arm command/nonce with no prior bound flow
and actual full-request HMAC validated by attested service under the context lock.
Bind previously-null actual fields once using CAS; prohibit later overwrite.
In that same SQL
transaction set grant uses=1/used_at, append grant use evidence, consume token,
set executing+command UUID and write chained consume audit/outbox. No TypeScript
`consumeGrantRun` inside SQL; browser-specific SQL implements this exact narrow
branch and parity tests compare invariants with grantCovers. No network I/O in
transaction. Subsequent outcome and grant result logging are transactional browser
records; best-effort generic recordGrantResult is supplementary only.
```

## 26. 9.3 Retention and audit ownership — line 3301

[Plan, line 3301](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3301)

```text
Live frames: memory only, erased on replacement/disconnect. Hand-off confirmed-
answer ciphertext/draft expires after 30 days or thread deletion, whichever first;
purge through the guarded cleanup path and disable pending acceptance. Retain only
IDs/fixed outcome/audit after expiry; a new hand-off requires fresh confirmation.
Immutable hand-off/attempt/effect/action IDs, evidence verdicts and one fixed
source outcome follow the two-year action/audit retention; draft/answer payloads
still expire at 30 days. Expired hand-offs cannot accept/restart; safe history
never becomes a fresh submission path. Joe-owned chat/thread deletion follows
H5 fences and never revives an old draft or attempt. Review images/body
manifests: encrypted private artifacts, delete after outcome or expiry + **24 h**,
never ordinary project files/backups of temp dirs. Quarantine: delete on reject,
or at session close + 1 h, absolute 24 h; total disk quota enforced. Commands
safe results: 30 days, then keep only IDs/state/digests. Action nonsecret summary,
digest, approver, amount, portal reference and content-free audit: **2 years**;
project receipts saved to files follow existing project file retention. Saved
login: until user deletes, or Joe disables a departed staff account; encrypted
profile: 30-day max renewed only by explicit use, immediate purge on revocation.
Deleted vault ciphertext and unused wrapped keys purged within 24 h. Backup
copies age under the existing backup policy; deletion cannot erase old backups
instantly. Exclude runtime/tmpfs/quarantine directories from backup inventories;
DB ciphertext may be backed up, key escrow separately. Restore starts off.
Amendment P1.5 sets stricter card-bearing request retention, content-free card
audit, replacement/removal purge and disabled-on-restore payment behavior.
```

## 27. 10.2 Web API and components — line 3432

[Plan, line 3432](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3432)

```text
Amendment P1.4–P1.5 adds Phase 3 owner-only `/browser/payment-card` settings and
`/api/agent-browser/payment-card` management routes; no payment-card MCP tool or
model-visible values, card list, fill endpoint or decrypt API.
```

## 28. Phase 3 — exact final-step approvals — line 3921

[Plan, line 3921](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3921)

```text
Enable final review execution and owner-grant extensions from 0102; apply 0104
settings/catalog/runbook seed, plus Amendment P1's later reserved payment
migration (number assigned at Phase 3 build). Make existing permission surfaces
browser-aware before enabling dispatch. Stored-card management and exact Pay execution ship
only in Phase 3 under P1; Phase 1 being built now and Phase 2 scope are unaffected.
Still no chosen city automation and no unattended use.
```

## 29. Phase 3 — exact final-step approvals — line 3985

[Plan, line 3985](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3985)

```text
* `tests/browser-payment-card-db.test.mjs`: P1 owner-only management/metadata,
  real-login denials, immutable envelope/card revision, dedicated one-use execution
  proof, consume-before-decrypt and actual-bind-without-second-consume; removal/
  replacement/disable/expiry races, zero approval authority in service functions.
```

## 30. Phase 3 — exact final-step approvals — line 3989

[Plan, line 3989](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3989)

```text
* `tests/browser-payment-card.test.mjs`: P1 origin/processor/field/amount/payee/
  epoch drift, hidden/ambiguous fields, script exfiltration, injection/look-alikes,
  replay and all execution crash boundaries; zero fill before fresh Joe approval,
  no public/delegated fill or secret in any output/retained image/profile/body.
  Runtime canaries must exercise the pinned gate/controller, not only mocks.
```

## 31. Phase 3 — exact final-step approvals — line 3994

[Plan, line 3994](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3994)

```text
* `tests/browser-payment-card-ui.test.mjs`: P1.4 at 360/820/1280 and existing
  short-landscape review, add/replace/remove/empty/error/success/unsaved states,
  owner Pay line/refusal/expiry, staff Waiting for Joe with no card metadata,
  varied runtime names, focus/keyboard/48 px targets and no app/service-browser
  card persistence.
```

## 32. Phase 3 — exact final-step approvals — line 3999

[Plan, line 3999](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:3999)

```text
* `tests/browser-payment-card-crypto.test.mjs`: independent payment KEK/AAD
  substitution/tamper/counters, rotation interruption, lost key, backup inventory
  and disabled restore; deletion never resurrects a card or proof.
```

## 33. Phase 3 — exact final-step approvals — line 4002

[Plan, line 4002](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4002)

```text
* `tests/browser-flags-db.test.mjs` P1 extension: payment/final/vault/global
  flags off at entry/save/review/approve/begin/decrypt/fill/bind/transmit, sticky
  payment dependency, close/clear fence and no replay on re-enable.
```

## 34. Phase 3 — exact final-step approvals — line 4005

[Plan, line 4005](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4005)

```text
* `tests/browser-retention.test.mjs`: P1 card/request purge and content-free audit
  plus 24 h artifacts/quarantine, 30-day profiles/
  safe results, two-year audit, tombstone/unlink crash, no temp backup, stale
  cleanup disables fill/download admission.
```

## 35. Phase 3 — exact final-step approvals — line 4010

[Plan, line 4010](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4010)

```text
Gate: sandbox payment/submit/sign fixtures with both owner/staff roles; no real
company charge. Joe confirms UI role matrix by using exact final cards on phone
while initiating staff/tablet remains present. Payment buttons state amount and
recipient, with Joe-only “Pays with Visa ending 4242” for P1. Its sandbox gates
include the stored-card hand-off into a fresh Joe task and every P1.6 abuse case;
only a verified remote receipt yields Paid.
```

## 36. Required regression and runtime gate additions by phase — line 4040

[Plan, line 4040](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4040)

```text
| 3 `tests/browser-payment-card-db.test.mjs` + `tests/browser-payment-card.test.mjs` | P1 owner-only roles/one-use executing proof; consume before fill, actual flow bind once, no second consume; wrong card/action/revision/origin/payee/amount/currency/epoch/image digest/processor/field refused; staff/public/delegated/hidden/ambiguous fields denied; injection, look-alike, script exfil, replay, removal and all crash races with upstream canaries. |
```

## 37. Required regression and runtime gate additions by phase — line 4041

[Plan, line 4041](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4041)

```text
| 3 `tests/browser-payment-card-ui.test.mjs` | P1.4 360/820/1280 settings and Pay reviews; empty/error/success/replacement/removal/unsaved, masked entry/no reveal, sticky decisions/focus/refusal, plain runtime names; staff Waiting for Joe receives zero card metadata. |
```

## 38. Required regression and runtime gate additions by phase — line 4042

[Plan, line 4042](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4042)

```text
| 3 `tests/browser-payment-card-crypto.test.mjs` + `tests/browser-flags-db.test.mjs` + `tests/browser-retention.test.mjs` | Independent payment KEK and immutable AAD; rotation/escrow/lost key/restore disabled; no plaintext persistence or card-bearing retained artifacts, immediate proof revocation and ≤24 h ciphertext purge; payment flag default OFF and conjunction with final/vault/global, every boundary rechecked, dependent context closed, no replay. |
```

## 39. Observability — line 4082

[Plan, line 4082](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4082)

```text
Structured **content-free** events: admission/queue, runtime start/stop/crash,
network blocked, private entered, fill attempt/success, control transfer, review
created/invalidated/denied/expired, approval/grant consumed, request dispatched,
result confirmed/unknown, file committed, ciphertext/profile purged. Include
correlation task/run/action/command IDs, boot ID, safe code and durations.
Do not put full URLs, usernames, text, bodies, passwords, image base64, tokens
or cookie headers in stdout/journal/analytics/traces; Amendment P1 also excludes
card numbers, security codes, cardholder and billing fields. Test failure paths too.
User sees the relevant durable outcome; owner sees redacted event history through
Open review; staff only own. No viewer/input recording “for debugging.”
```

## 40. Flags and activation — line 4104

[Plan, line 4104](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4104)

```text
Owner-owned app settings (no narrow writes), default false:
`browser.enabled`, `browser.staff_enabled`, `browser.vault_enabled`,
`browser.files_enabled`, `browser.final_steps_enabled`, `browser.payment_card_enabled`,
`browser.permit_handoff_enabled`. Optional named-user pilot allowlist and global
resource/admission latch live in owner-only configuration. Environment
`SJC_BROWSER_ENABLED=0` is an overriding emergency off switch, not a model input.
Service rechecks effective flags at admission/every action; live kill switch
invalidates controls/approvals and closes contexts within 5 s. Staff flag off
closes only staff execution contexts; accepted independent Joe hand-offs keep
Joe's own authorization and do not transfer staff attendance. Vault flag off denies
login/profile decrypt/fill/restore/profile save and closes **vault-dependent**
fill/restore contexts (§5.2 sticky binding), including delegated_secret; in
Phase 3 it also fences/closes P1 payment-dependent contexts. Anonymous
manual-only private contexts (login dependency none and no P1 payment dependency)
continue with no model observation;
privacy never becomes public and Phase 1 never needs vault enabled. Files and
final dispatch flags still apply inside them. Final-steps off denies creation,
approval, arm, bind/consume and transmission and cancels all undispatched
**company-release kinds: lookup/save_page/upload/submit/pay/sign**, including
company GET/Next/autosave, plus unknown-category releases. Every flag-sensitive
function and independent gate rechecks; no delayed replay when enabled later.
Consumed or possibly transmitted actions stay unknown for reconciliation.
Phase 2's only write exception while final steps are off is a strictly typed,
exact **personal-login** direct-person Sign in; Phase 4 may add reviewed named
delegated **login-only** under its own gates. Neither exception authorizes
personal_contact/company account change, business values, write or charge.
Unsupported/ambiguous login refuses; no broad phase/name-based exemption.
Phase 1 permits neither login submits nor any other outside writes.
`browser.payment_card_enabled` defaults **OFF**, Phase 3 only, and is meaningful
only with `browser.final_steps_enabled` (also requires global/vault enabled);
Amendment P1.7 specifies management/decrypt/fill/transmit fences and immediate
proof revocation/closure on disable. No Phase 1/2 card capability or migration.
File flag off denies new download/upload/save; existing authorized project files
still readable by people. No historical backfill of browser profiles/tasks.
```

## 41. 14. Remaining business decisions and known limits — line 4263

[Plan, line 4263](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4263)

```text
No new business question is introduced; no business answer blocks the generic build. Decisions 1–9 govern this
plan, together with Joe's round-4 payment decision in Amendment P1. Securely
stored company card details, including security code under P1's explicit risk
rule, are owner-only Phase 3; permission is required right before every use.
Phase 1 being built now is unaffected. Decision 5 is settled: saved logins are shared **per site with named staff**,
default Only me; Joe's share sheet says “Let these people use this login” / “They
can sign in without seeing the password.” Decision 6 is settled: **Joe approves
every final step committing the company**, even “nonbinding” staff requests and
direct take-over clicks. No staff-signing or company-submit authority is being
asked for in v1. Required areas are derived, not a Joe setup chore.
```

## 42. 14. Remaining business decisions and known limits — line 4278

[Plan, line 4278](/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be/docs/plans/agent-browser-plan.md:4278)

```text
Known visible limits: no unattended/Telegram browser; phone views/approves but
remote input needs iPad/computer; generic authenticated forms are filled by the
person using Your answers; delegated staff login works only with reviewed safe
controls and outputs, otherwise Joe finishes or staff use their own authorized
account; no arbitrary model private-page vision; no password reveal/export;
WebSocket/pinned-TLS/unknown request portals may remain unsupported. Amendment
P1 adds no virtual cards, bank accounts or staff card use: unsupported payment
fields/processors remain manual Joe-only work, and saved-card use cannot bypass
the exact Pay review or the private-context/no-model boundary. Read-only
Phase 1 blocks even POST search. The reviewed TLS gate, session/thread prerequisites,
common resource hierarchy and independent audit sink are deploy gates, not claims
that existing infrastructure already provides them. PDF filing stays off if the
bounded mandatory sanitizer/scanner gate cannot be met.
```
