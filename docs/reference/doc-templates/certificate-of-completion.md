# Canonical text — Certificate of Substantial Completion

Drafted new (2026-07-10) in the SJC house style. Supersedes the simpler
`renderCompletionCertificatePdf` in `lib/documents.ts` once implemented. Substantial Completion
is legally significant in Minnesota: it starts the Minn. Stat. § 327A statutory warranty clocks
and the § 337.10 retainage-release obligation, and it anchors the punch-list procedure in the
construction contract — so this certificate captures the date formally and gets
counter-signed by the client through the e-sign flow.

---

## Document header (house style)

> **{{company_name}}**
> {{company_address}} · {{company_phone}} · {{company_email}}
> License {{company_license}}
>
> # Certificate of Substantial Completion
> Formal record that the project below has reached Substantial Completion.
>
> | CERTIFICATE # | DATE ISSUED | ORIGINAL CONTRACT REF. # |
> |---|---|---|
> | {{certificate_number}} | {{document_date}} | {{contract_number}} |

| | |
|---|---|
| Project / Job | {{project_name}} |
| Project Address | {{project_address}} |
| Client / Owner | {{client_name}} |
| Contractor | {{company_name}} |

---

## Body

### CERTIFICATION

{{company_name}} ("Contractor") hereby certifies that the work performed for {{client_name}}
("Client") at {{project_address}} under the Agreement referenced above reached **Substantial
Completion on {{substantial_completion_date}}**. As defined in the Agreement, Substantial
Completion means the work is sufficiently complete in accordance with the Agreement so that
Client can occupy or utilize the project for its intended purpose, notwithstanding minor items
or corrective work remaining on the punch list.

### SUMMARY OF WORK

{{work_summary}}
*(AI-fillable narrative — 2–4 sentences summarizing the completed scope; grounded on the
project/SOW; never invents dates or figures.)*

### EFFECT OF SUBSTANTIAL COMPLETION

As of the Substantial Completion date stated above:

1. **Statutory warranties commence.** The warranty periods under Minn. Stat. § 327A begin to
   run: one (1) year for defects in workmanship and materials; two (2) years for defects in
   electrical, plumbing, heating, cooling, and ventilation systems; and ten (10) years for
   major construction defects, each as defined by statute and the Agreement.
2. **Retainage release.** Any retainage withheld under the Agreement shall be released no later
   than sixty (60) days after Substantial Completion, consistent with Minn. Stat. § 337.10.
3. **Punch list period begins.** Client has fourteen (14) calendar days from receipt of this
   Certificate to inspect the project and deliver a written punch list. Contractor will
   complete punch list items within fourteen (14) calendar days of receipt, or within a
   mutually agreed extended timeline for items requiring additional lead time. If no punch list
   is delivered within the fourteen-day period, the work is deemed accepted as substantially
   complete per the Agreement.
4. **Final payment.** The final payment balance under the Agreement is due upon Substantial
   Completion as set forth in the payment schedule.

### PUNCH LIST STATUS *(auto-generated)*

| | |
|---|---|
| Punch list items complete | {{punch_done}} |
| Punch list items open | {{punch_open}} |

{{punch_list_items}}
*(Optional: itemized open punch list pulled from project_punch, so the certificate doubles as
the written punch-list record.)*

### ACCOUNT SUMMARY *(auto-generated)*

| | |
|---|---|
| Total contract price (incl. executed Change Orders) | {{contract_total}} |
| Paid to date | {{paid_to_date}} |
| Final balance due | {{balance_due}} |

### WARRANTY CONTACT

Warranty claims should be submitted in writing to {{company_name}} at {{company_email}} or
{{company_address}}, per the Notice and Right to Cure provisions of the Agreement.

### ACKNOWLEDGMENT

This Certificate documents the Substantial Completion date for the purposes described above. It
does not waive Client's punch-list rights, statutory warranty rights, or Contractor's right to
final payment under the Agreement.

By signing below, the Parties acknowledge the Substantial Completion date stated above.

- {{company_name}} — signature / printed name / date
- Client — signature / printed name / date: {{client_name}}

---

## Drafting notes for the attorney

- The "Effect of Substantial Completion" section restates the contract's own §§ (warranties,
  retainage, punch list, final payment) so the certificate and contract can't drift apart —
  if the contract terms change, this template must change with them.
- Client counter-signature is deliberate: it fixes the § 327A warranty start date by mutual
  acknowledgment. Attorney should confirm the acknowledgment wording doesn't operate as a
  broader acceptance/waiver than intended.
- The punch-list itemization is optional per render; when included, this doc can serve as the
  written punch-list notice contemplated by the contract.
