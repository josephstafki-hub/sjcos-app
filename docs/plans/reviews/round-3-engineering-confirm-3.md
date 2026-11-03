SCORES: sub-agreements design=10 completeness=9 | discovery-call design=10 completeness=10 | in-home-consult design=10 completeness=10

S6: actor design satisfied. §10.1c now enforces an owner user for `paper_imported` and a worker identity for `paper_superseded`. The latter is derived from verified worker context inside SECURITY DEFINER `sub_packet_complete`, consistent with withholding direct event INSERT from the worker. One previously required test specification remains incomplete: §17 still only says the electronic replacement appends `paper_superseded`; it does not require worker-login execution or assert the corrected actor fields.

Required fix (exact): extend §17's `tests/sub-agreements-paper-db.test.mjs` electronic-supersedes-paper case to execute completion as `sjcos_worker` without an owner session, assert `actor_user IS NULL` and `actor_worker` equals the verified worker context's `worker_id:job_id`, and assert the event identifies the replacing packet. This closes the worker-attribution regression case required in confirm-2.

C4: fully satisfied. §9.3 explicitly requires both offsets non-NULL when unredacted, retains ordered nonnegative offsets, and permits only NULL offsets when redacted. §17 retains the redaction UPDATE and unredacted-NULL rejection case.

Additions: the required `no_handwritten_changes` column, true-only CHECK, import evidence validation, screen tick and rejection test agree. The refusal-copy table uses the import's existing codes and introduces no incompatible return codes. It omits `not_owner`, which is an authorization refusal for an owner-only screen rather than an actionable evidence field; no required fix on that basis. No inconsistency introduced by either addition.

Discovery-call: unchanged, confirmed 10/10. Review restricted to the requested items; no code or plan edits and no execution checks performed.
