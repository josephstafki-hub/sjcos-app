# Round 3: second confirmation check (Design & field UX, Contractor & MN legal)

This is a narrow check of the two required fixes left by `round-3-design-legal-confirm.md`, the two optional items, and the §10.1c edits made since then (binding under locks, WC basis copy/match, `sub_paper_events`, the sub's scan download). I read the plans and did not edit them.

SCORES (Design): sub-agreements design=10 completeness=10 | discovery-call design=10 completeness=10 | in-home-consult design=10 completeness=10
SCORES (Legal): sub-agreements design=10 completeness=10 | discovery-call design=10 completeness=10 | in-home-consult design=10 completeness=10

---

## Required fixes from the last check

| Item | Status | Evidence |
|---|---|---|
| Legal: paper import uses the same preconditions as Joe signs | FIXED | §10.1c step 2 (line 907): an agreement must be in `draft` with an approved template and complete fields. A scope must be in `ready` with the current `draft_hash`, a complete §14 validator and a signed, effective agreement (`agreement_missing`, `agreement_ended`, `not_ready`, `template_unapproved`, `packet_open`). It says outright that a draft scope is refused and cites §6 item 2. The preconditions are checked again under the locks, and the parent's `draft_hash` is recorded in the event. |
| Legal: Phase 1 wording | FIXED | §17 Phase 1 (line 1139) now reads "the ready version he printed (or, for a Sub agreement, the agreement draft)". |
| Legal: test | FIXED | `tests/sub-agreements-paper-db.test.mjs` (line 1147): a scope still in `draft` → `not_ready` and an unapproved template → `template_unapproved`, "nothing written". |
| Design: date format | FIXED | Line 917 shows **Signed on paper · Nov 4, 2026** (the later of the two written dates) and the portal example `Sub agreement  ✓ Done · Signed on paper · Nov 4, 2026  [Download]`. This matches §9.D's `✓ Done · Signed Nov 2, 2026`. |

## Optional items from the last check

| Item | Status |
|---|---|
| Consult §3 "Ambiguous recorded answer" row | Removed (grep finds nothing). |
| Discovery §6.3 "client-side segments" | The wireframe now says "recent segments as rows to pick" (line 307), which matches the prose at line 204. |

## Edits to §10.1c since the last check

- **Scope binding under locks.** The scope's `agreement_id` is set inside the import transaction, using the shared sub → agreement → scope → version lock order, before the state change. This means a paper scope is always tied to the signed agreement in force, just like an electronic one. That is legally correct: the scope is a job order under one master agreement, and it cannot float free of it.
- **WC basis.** On an agreement import, the basis is copied to `sub_agreements.wc_basis`, which is what readiness reads. On a scope import, the basis must match the agreement or the import is refused with `wc_basis_mismatch`, and a change of basis needs a new agreement. This fails safe for § 176.215 (uninsured-sub liability). A sub who takes on an employee can't be recorded on paper as still having no employees, and the no-employees statement still clears `wc_missing` only through the agreement. The "a change of basis needs a new agreement" rule is clear. Optional wording for the error message is below.
- **`sub_paper_events`.** This is an append-only, content-free audit table. It holds the owner actor from the verified session, the parent `draft_hash`, and the same operation key as the import, so a retry cannot log twice. Later electronic replacement logs `paper_superseded`. This gives the paper path the same proof trail that `sub_packet_events` gives the electronic path. The grants are sound: the website login only, and SELECT for readonly. Legally sound.
- **The sub downloads the scan.** It goes only through `/sub-portal/files/[id]`, with `paper_signing_id` as the one-of-two field in the scoped HMAC, a ≤10-minute TTL, and a recheck on every fetch. Agreement scans are tied to the sub. Scope scans also need the current assignment. Clients, other subs, Projects-only staff and generic `fileSignature` links are refused, and there are tests for each. The sub gets their own signed copy, which clause 24 promises ("may download or print a signed copy"). The portal line reads correctly, and the download is the scan.

Every new edit reads correctly for Joe and the subs, and none weakens the legal position.

## Remaining required fixes

None.

## Optional (not required for 10)

- **Handwritten changes on paper.** The import records the paper against the printed `draft_hash`, but the Add paper copy screen never asks whether anyone wrote on the terms. Suggested: add a required tick to the screen, "No terms were crossed out or written in on the paper". If someone did write on the terms, don't import: fix the draft and print it again. Also mention it in the §17 Phase 1 screen sentence. The scan stays the controlling copy either way, so this only keeps the app's text honest.
- **Refusal wording.** Give the paper-import refusal codes plain wording in the screen's error summary, for example `wc_basis_mismatch` → "The workers' comp answer doesn't match this sub's Sub agreement. If it changed, sign a new Sub agreement first." and `not_ready` → "This Scope of work isn't ready to sign yet. Finish it in the builder."
