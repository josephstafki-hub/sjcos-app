# Houzz exit (A21 · V30)

Joe replaces Houzz completely — online invoice payment links and the design
tool (DECISIONS.md). The transition tools are built; **cancellation is a
manual owner step** and never a consequence of merging or deploying code.

## Where to look

- `/engine/houzz-exit` — the live checklist: five retirement criteria scored
  from SJC OS evidence, open (sent, unpaid) invoices, imported Houzz history,
  designer counts, who sends what, and code that still references Houzz.
- `node scripts/houzz-export-inventory.mjs [--text]` — the same inventory from
  the shell, read-only, JSON or text.
- `lib/houzz-exit.ts` — the pure module both use.

## The five criteria (INTEGRATIONS.md)

| # | criterion | how SJC OS scores it |
|---|---|---|
| 1 | Card + bank payments live and reconciled (refunds, returns, existing invoices) | `feature.square` proven, Square credentials configured, `feature.qbo` enabled, A20 proven — all from `capability_status` |
| 2 | Full designer meets real workflows with saved/exported data | A21 proven (Joe's sign-off) + design/version/export counts |
| 3 | Houzz designs, invoices, payment history, client artifacts exported and linked | imported `expenses.source_ref 'houzz:*'`, staged Houzz lead imports, retainers; design files need Joe's manual export → **needs owner evidence** |
| 4 | Existing payment links / outstanding invoices have a finish-or-migrate path, no duplicate collection, no changed amount | every `invoices.status = 'sent'` row is listed; met only when the list is empty or each has a documented path |
| 5 | Old reminders, integrations and senders inventoried; one owner per outbound action | dispatcher lanes (`sends`, `payments`), Square configured?, Houzz marked owner-reported; the invoice template's Houzz-link wording is flagged |

`ready_to_cancel` is true only when every row is `met`.

## Rules during transition

- One system owns each outbound action. Until Houzz reminders are switched
  off, SJC OS invoice reminders for the same client must stay held (pause the
  `sends` lane or the routine-followup policy for that project).
- An outstanding Houzz invoice is finished **either** on its existing link
  **or** re-issued through SJC OS for the same amount, once. Never both.
- Imported Houzz payment history stays as evidence (`expenses.source_ref`);
  A14 QBO import matches it by external reference, never by amount.
- Design files that cannot be imported are archived on the job's Files tab and
  listed as unsupported; they are not presented as editable models.
