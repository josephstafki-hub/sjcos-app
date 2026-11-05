# R4 approval-to-view expectations (written before implementation/tests)

Use real isolated PostgreSQL, real claim/dispatcher/web actions/Telegram webhook,
separate connections for races, and fake outbound providers. Every refusal must
leave approval requested, create no approved snapshot and send nothing.

1. Judge repro: display Old $100, edit to New $9900, record replacement alert;
   old phone refuses and old web view refuses with the reload message.
2. Opening that replacement and approving sends New $9900 exactly once.
3. No phone card: a displayed web draft edited before approval is refused.
4. No phone card: a fresh web draft approves and sends its displayed payload.
5. Missing binding refuses even when a current replacement alert exists.
6. Empty/forged binding refuses even when there are no phone cards.
7. Engine board/work-item read returns draft text and its matching binding;
   editing and recording a new card cannot authorize the old Engine action.
8. Project Ops read/action refuses its old displayed draft after an edit.
9. Lead Ops read/action refuses its old displayed draft after an edit.
10. Today/notifications/popup pending approval read/action carries the displayed
    binding and refuses an old view after edit plus replacement alert.
11. Fresh pending approval read/action sends the displayed draft once.
12. Concurrent edit while web approval waits for the work-item lock refuses
    even when the edit also creates a replacement alert.
13. Recipient-only change invalidates an otherwise identical web draft.
14. Replacing the selected draft receipt invalidates the displayed web draft.
15. Unmapped legacy Telegram card after edit refuses without approving or sending.
16. Unmapped legacy Telegram card with unchanged content also refuses: no saved
    revision means we cannot prove what Joe saw. The reply directs him to Today.
17. Mapped Telegram card lacking a binding refuses even with unchanged content.
18. Bound Telegram card still sends exactly its frozen displayed draft; a web
    edit after approval commit cannot replace the payload.

Legacy policy: do not guess the displayed draft from timestamps or the newest
card, and do not automatically send another alert. Refuse unbound approval and
link Today, where Joe can review and approve a freshly bound web draft. Decline
keeps its existing behavior. Phone and bound Telegram action contracts stay intact.
