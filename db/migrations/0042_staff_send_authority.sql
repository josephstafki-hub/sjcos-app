-- 0042 — A team member's send is filed as theirs, not Joe's (2026-10-30).
--
-- A staff member with delegated authority (authority_grants, Settings › Team)
-- who clicks Send invoice was recorded as policy_ref 'owner:staff:…' and bound
-- as kind 'owner', and the dispatcher never re-checked the authority. Now the
-- intent carries policy_ref 'staff:<user id>/authority:<grant id>' and the
-- dispatcher binds it as kind 'staff' after checking the account is still an
-- active team member and the authority grant is not revoked — on the first
-- dispatch and on every retry (lib/dispatch/authority.ts).

ALTER TABLE intent_authority DROP CONSTRAINT IF EXISTS intent_authority_kind_check;
ALTER TABLE intent_authority ADD CONSTRAINT intent_authority_kind_check
  CHECK (kind IN ('decision','grant','policy','owner','staff'));
