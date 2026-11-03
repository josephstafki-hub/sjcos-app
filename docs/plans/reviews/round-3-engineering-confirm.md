SCORES: sub-agreements design=9 completeness=9 | discovery-call design=10 completeness=10 | in-home-consult design=9 completeness=9

Narrow confirmation of S6, C4 and the identified accompanying edits against the existing contracts. Read-only review except for this file. No tests, typechecks, builds, servers, browsers, database access, service operations, paid model calls, commits or stashes.

## Sub-agreements — S6 partially satisfied

§10.1c now distinguishes paper evidence from electronic packets and supplies scan/hash, signer names/dates, importer/time, optional witness provenance, owner-only import, retry semantics, signed/current adoption and named tests. The proposed method is sound, but its integration remains incomplete.

Remaining required fix — finish the paper-import contract in these specific places:

1. **Bind the scope agreement before marking signed.** §10.1b permits `sub_scope_versions.agreement_id` to be NULL only in draft/ready; §10.5 prevents agents from setting it, and §10.1 says electronic signing sets it. Paper-import step 2 only checks that an agreement exists; step 5 never assigns it. Require the import transaction to select/lock/revalidate and set the same-sub signed agreement before changing the scope state. Explicitly propagate the paper WC basis to the agreement field consumed by §10.4, or specify readiness's authoritative paper-evidence lookup; merely storing it on `sub_paper_signings` does not define that connection. Keep these writes under §10.5's shared lock order and test a draft with NULL agreement linkage and a paper no-employees statement without a WC certificate.
2. **Define a writable paper audit destination.** Step 5 calls for `kind='paper_imported'` with no packet id, but §10.1's only defined signing-event table requires `packet_id NOT NULL` and excludes that kind. Specify either a separate append-only paper-event relation or an explicit schema extension with validated paper-versus-packet ownership; include its grants/manifest and atomic retry behavior. A “sub_packet_events-style” row alone leaves the required write without a schema.
3. **Make the promised scan download reachable.** §10.1c promises the scan as the signed-copy download, but §14.3's exhaustive sub-file route admits only packet files or change-request attachments, and its HMAC scope requires `packet_id`. Paper imports deliberately have neither. Extend classification and the scoped download/link contract to a validated paper-signing identity, same-sub ownership and applicable current assignment, preserving generic signed-link denial. Add own-sub scan success and other-sub/client/generic-link denial to the named access tests.

The §10.1c special transition can supplement §10.3's electronic state-machine description; method-agnostic signed/current readiness and shared supersession helper are otherwise compatible. The §9.B/§9.D wording edits introduce no additional required engineering fix.

## Discovery-call — confirmed

No remaining required fix. The consent negative-pattern changes preserve the fail-closed ambiguous path; the unknown-voices row picker retains person attestation to a selected recorded response. These changes do not alter contract v3 or the shared retention authority. Score remains 10/10.

## In-home-consult — C4 partially satisfied

The suggestion-owned relation fixes the original checklist-item/FK collision. Its per-suggestion ordinal, suggestion/session FK, consult-session equality guard and unique `consults.session_id` agree with discovery v3. Use/Edit/Reject, correction invalidation, derived-answer lineage, migration 0076, adapter registration and named cases are now specified. The revised consent playback flow also agrees with discovery's batch-audio exception.

Remaining required fix — finish the new suggestion-reference SQL/function contract:

1. **Make redaction representable.** §9.3 requires offsets to be cleared to a sentinel, but `quote_start`/`quote_end` are NOT NULL with `quote_start >= 0` and `quote_end > quote_start`. NULL, negative and empty-range sentinels all fail. Define a conditional CHECK with an explicit redacted representation (for example, both offsets NULL iff `redacted_at IS NOT NULL`), or preserve content-free numeric offsets and remove the clearing requirement. Redact the actual suggestion/answer JSON quotes atomically and retain content-free segment tombstones or remove refs before physical segment deletion, consistent with discovery §14. Test the actual redaction UPDATE against the constraints.
2. **Supply the required worker authority.** The new executable signature `consult_suggestion_create(p_consult, p_suggestion, p_operation_key)` has no signed context or fenced job token, although §§9.2/11.3 require discovery §8.4's verifier and fresh scoped worker leases. Specify that input and enforce job/session/lease, revision and capture/deletion-epoch checks before inserting suggestion, refs and purge lineage. Worker-login EXECUTE plus an unspecified assignment check cannot establish the job's authority. Include forged/cross-session job and stale lease/epoch denial in the named access cases.

No unrelated review issues added. The remaining requirements above are confined to completing S6/C4 without contradictory writes or authorization paths.
