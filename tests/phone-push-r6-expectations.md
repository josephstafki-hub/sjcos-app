# R6 expectations — written before implementation and execution

Joe's 2026-11-05 decision replaces R5's owner-only web draft rule. Keep the
R5 real-DAL matrix, snapshot/send assertions, stale bindings and cleanup coverage:
area-enabled staff and owners succeed, staff without the area and revoked or
demoted-without-access sessions fail before mutation. Decisions require fitting
approval authority; grant decisions remain nondelegable. Polling must expose
only approvals the viewer can answer. Stale staff pages must refuse exactly as
owner pages do, with the existing recovery copy and no send.

Fresh cases (real DB/JWT/webhook, fake outbound effects; UI via actual compiled
card functions and JSX inspection, without a browser):

1. Engine-only staff can approve Engine/popup drafts, but cannot approve Ops.
2. Today-only staff can approve Ops drafts, but cannot approve Engine/popup.
3. Staff without decision authority cannot resolve decisions, even with areas;
   with matching authority they can approve, reject and request changes.
4. Staff authority for an ordinary decision never authorizes a grant decision;
   direct/popup approve/reject/change paths preserve all evidence on refusal.
5. Telegram bound Approve/Reject, legacy Reject and decision Approve/Changes/Hold
   refuse when the sole owner is deactivated, with no approval/snapshot/send.
6. The same Telegram matrix refuses when that owner is demoted to staff.
7. The same matrix refuses when no owner user exists in the database.
8. Active-owner Telegram bound Approve sends the displayed frozen draft once;
   bound/legacy Reject and decision actions still succeed.
9. Long matching internal lead Ops approval text remains fully readable when
   its duplicate draft box is suppressed; Approve uses its displayed binding.
10. Project Ops has the same full-text and binding behavior, including fallback
    bodies without a receipt.
11. Short internal duplicate suppression, distinct receipt content, email and
    portal preview boxes remain intact; staff without Today have no controls.
12. Engine staff with Engine access retain Approve/Reject even without assignment
    authority; their retained Approve handler submits the displayed binding.

Run each changed test file separately, then phone-push-*-db twice on each file's
same migrated database; requested approval, Telegram, portal-Telegram and DB-role
regressions one file at a time. Only the uniquely tagged disposable cluster is
created/stopped; no live/QA-push services or databases are used.
