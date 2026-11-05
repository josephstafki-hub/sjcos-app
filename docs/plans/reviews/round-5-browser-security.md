SCORES: design=10 completeness=10

Round-4 guarantees: still hold

New mechanisms: sound

Reviewed AGENTS.md, the shared context and owner decisions, my round-4 review at `2dfea1216e6f70f40f4912cdbde9ff1131907b56`, and the browser plan at `1a9e936a`, including the intervening path-scoped diff, Round-4 fixes appendix and §13. This is a plan-level security judgment, not runtime or deployment acceptance.

### Round-4 guarantees reverified

1. Delegated credentials remain use-only: no arbitrary staff pixels, DOM, controls, downloads or exports; unsupported adapters refuse (§5.2, §8.2).
2. Every manual input still requires the irreversible private transition and observer drain before forwarding. Done, navigation and vault-off cannot restore model observation (§5.2, §6.1).
3. Browser-profile tools, process credentials, CLI histories and thread ownership remain isolated; neither owner review nor the new invitation grants staff transcript access (§4).
4. Origin admission still grants no company-data release authority. Exact recipient, values, provenance and manifest revision require Joe's action-specific approval, including GET lookups and draft saves (§7–8).
5. Namespace-only CDP, target barriers, SSRF/DNS/peer enforcement and the independent full-request gate remain prerequisites; upstream bytes wait for exact consume and independent audit acknowledgment (§3.2, §7.3).
6. Fresh cookie sid, record/area rights, CSRF, device/viewer epochs and separate initiator attendance remain authoritative. Links and passive viewers confer no approval or control (§4.1, §6.1).
7. Service/model/narrow database roles gain no direct private-table access, approval authority or general decrypt oracle. New hand-off relations and functions require manifest/revoke and actual-login tests (§9.2).
8. Purpose-separated encryption and immutable canonical AAD remain intact. Mutable current-attempt pointers do not change the hand-off answer envelope's immutable source bindings (§5.1, §9.1).
9. Actual-flow binding, atomic one-use consumption and independent audit anchoring still precede transmission. Unknown outcomes cannot automatically retry, refund or clear consumed grants (§7.3, §9.3).
10. Hostile-file sanitization, human-only readers, reserved-ID lifecycle, rollback protection, flag dependencies and bounded aggregate memory gates remain mandatory. New views and outcomes provide no artifact-export bypass (§8.2, §12–13).

### New mechanisms reviewed

1. **Invitation, notification and Safari routing (§6.4, §10.2): sound.** Notifications carry trusted task facts and a non-capability ID, not answers, secrets, frames or grants. Authorized invitation GET creates no conversation/task/run and does not select staff chat. Acceptance creates one Joe-owned draft; execution requires separate attended Sites review/Open browser. Native routing validates and rebuilds the configured HTTPS destination, rejects mixed/extra/duplicate keys and adds no Bearer write, token exchange or approval callback. Native decline opens the cookie-authenticated web confirmation. The sign-in return allowlist remains unchanged, with honest post-login navigation through Asked to finish.
2. **Asked to finish and outcomes (§6.4, §9.2, §10.2): sound.** Pending/accepted rows require Joe's fresh cookie and current record rights; unauthorized, deleted and expired entries cannot disclose labels or be accepted. Source staff receive only their fixed outcome, not Joe's history. Don't finish, Mark finished and Didn't finish require explicit confirmation and guarded POST. Accepted outcomes bind the current attempt/revision, fence any live destination, and refuse unresolved execution across all attempts. Terminal CAS plus a unique outbox event prevents duplicate outcomes; no outcome resumes staff or certifies a portal result.
3. **Private Watch (§6.1–6.3, §9): sound.** Show the page explicitly authorizes Joe as a human viewer under fresh owner/record/session/device checks, rotates/fences the stream and requires durable audit acknowledgment before the first private frame. Public-to-private transition clears/drains the image and requires new consent; replacement contexts inherit none. Staff see “Joe is watching.” for any live owner viewer, removed only after the last leaves/expires/is revoked. This is Joe's explicit viewing consent with staff-visible access, not a newly invented staff approval requirement. Frames remain restricted to authorized human viewers; no model, transcript, log or replay receives them. Delegated-secret mode still supplies pixels only to Joe. Viewing neither takes control nor substitutes for staff attendance; passive exits revoke only Joe's viewer.
4. **Waiting and public Done states (§5.2, §6.3, §6.5): sound.** Waiting notices derive from fresh authorized revisions, disclose only permitted status, ignore late events and preserve final/unknown precedence. They grant no continuation or approval. The persistent public-takeover Done state remains private and paused, with fresh human takeover or fenced anonymous replacement as explicit choices; phone instructions add no remote-input path.
5. **Restart, reconciliation and duplicate effects (§3.4, §6.4, §7.3, §9): sound.** One immutable conversation/initial reservation, guarded current-attempt pointer, admission locks, revision CAS and canonical idempotency prevent duplicate launches and stale outcomes. Restart creates a new task/context/run without resetting terminal identities or reusing launch intent, command, token or grant. Every executing/unknown effect across history blocks restart/outcome. Reconciliation is a separately audited Joe-only human fact requiring affirmative, authorized evidence; absence of a receipt is insufficient and private evidence retains its reader/sanitizer restrictions. Logical-effect identity excludes incidental run/context/CSRF changes, requires human history review when equivalence is ambiguous, and is rechecked under the effect lock at consume. Received effects refuse repeat dispatch; verified-not-received permits only a new exact review/grant. Original unknown actions and consumed approvals remain unchanged.

### Required to reach 10

None. No required exploitable or data-exposure gap identified in the revised plan.

The §12 release gates remain required, including private-frame canaries, viewer authorization/audit/revocation races, notification/native routing, all-attempt effect reconciliation, restart-versus-outcome concurrency, real-login denials and independent gate/audit failures. No browser, server, build, database, service operation or deployment was run. Only this review file was written and staged; unrelated workspace changes were left untouched.
