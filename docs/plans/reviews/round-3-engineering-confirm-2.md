SCORES: sub-agreements design=9 completeness=9 | discovery-call design=10 completeness=10 | in-home-consult design=9 completeness=9

Narrow second confirmation of S6 and C4 only. No code or plan edits, tests, typechecks, builds, servers, browsers, database access, paid model calls, service operations, commits or stashes.

## S6 — partially satisfied

- Scope/agreement binding and WC basis: satisfied. §10.1c requires ready/validated scope and approved-template agreement preconditions, rejects draft scopes, locks and revalidates in §10.5 order, binds the same-sub signed agreement before transition, copies agreement WC basis and rejects scope basis mismatch. §17 names the corresponding cases.
- Paper audit destination: the separate append-only relation, import atomicity/idempotency and migration/grants requirements are supplied. One worker integration inconsistency remains: `sub_paper_events.actor` is a NOT NULL users FK specified as a “verified owner session,” but §10.1c also requires the electronic completion transaction to append `paper_superseded`, and §10.5/§11.2 execute that transaction as the worker. That execution has no verified owner session.
  Required fix: define a representable, truthful actor for worker-generated `paper_superseded` events. For example, use an explicit actor kind with a nullable user FK: imports require the verified owner user; supersessions generated inside `sub_packet_complete` record worker identity and the replacing packet ID, derived inside the function. Alternatively specify a persisted authorizing owner separately from the executing worker. Update the schema/comment and the named electronic-supersedes-paper test to exercise the worker-login completion and its audit row. Do not fabricate an owner session or require the worker to obtain one.
- Scoped scan download: satisfied. §10.1c and §14.3 admit the paper scan via its validated parent, use the paper-signing alternative in the HMAC, enforce same-sub/current scope assignment and retain generic-link/client denial. §17 names positive and negative access cases.

## C4 — partially satisfied

- Redaction representation and purge lineage: redacted NULL offsets are now representable; atomic suggestion/derived-answer JSON quote redaction and retained segment identities agree with discovery §14. However, the conditional CHECK does not enforce the promised unredacted shape: PostgreSQL accepts CHECK results of NULL. With `redacted_at IS NULL` and both offsets NULL, its first branch is NULL, its second is FALSE, and the whole CHECK is NULL, so the row passes. This directly contradicts §17's required “unredacted NULL offset fails” case.
  Required fix: add `quote_start IS NOT NULL AND quote_end IS NOT NULL` to the unredacted branch of §9.3's CHECK, retaining the existing comparisons and redacted branch. The complete expression must be:

  ```sql
  CHECK (
    (redacted_at IS NULL
      AND quote_start IS NOT NULL AND quote_end IS NOT NULL
      AND quote_start >= 0 AND quote_end > quote_start)
    OR
    (redacted_at IS NOT NULL
      AND quote_start IS NULL AND quote_end IS NULL)
  )
  ```

  Keep §17's actual redaction UPDATE case and require rejection of either or both NULL offsets while unredacted.
- Worker authority: satisfied. The new function takes discovery §8.4's signed worker context and job/lease/base revision; checks signature/expiry, current lease/worker generation, session, permitted shared `live`/`finalize` phases, revision and capture/deletion epochs; validates evidence/target and atomically registers refs and purge lineage. §§9.2/11.3 retain the shared verifier/assignment/consent boundary. §17 names forged/cross-session/stale lease/revision/epoch denials. No incompatible shared phase or alternate context was introduced.

## Discovery-call — confirmed

Design/completeness remain 10/10. These edits do not change discovery's contract; its worker context, shared phases and content-free segment tombstones support the corrected consult integration. No remaining required discovery fix.
