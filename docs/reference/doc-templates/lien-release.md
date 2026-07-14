# Canonical text — Waiver and Release of Mechanic's Lien (Lien Release)

Drafted new (2026-07-10) in the SJC house style, matching the tone/structure of Joe's contract
documents. One template with a `waiver_type` field covering the four standard variants:

| `waiver_type` | Use when |
|---|---|
| `partial_conditional` | Progress payment promised but not yet cleared |
| `partial_unconditional` | Progress payment received and cleared |
| `final_conditional` | Final payment promised but not yet cleared |
| `final_unconditional` | Final payment received and cleared — full release |

The renderer emits ONLY the paragraphs for the selected variant (marked below). This supersedes
the simpler `renderLienWaiverPdf` in `lib/documents.ts` once implemented.

**This is a draft for attorney review — Minnesota does not prescribe statutory waiver forms
(unlike e.g. California), but conditional/unconditional distinctions and notarization practice
should be confirmed.**

---

## Document header (house style)

> **{{company_name}}**
> {{company_address}} · {{company_phone}} · {{company_email}}
> License {{company_license}}
>
> # {{waiver_title}}
> *(one of: "Partial Conditional Waiver and Release of Lien", "Partial Unconditional Waiver and
> Release of Lien", "Final Conditional Waiver and Release of Lien", "Final Unconditional Waiver
> and Release of Lien")*
>
> | PROJECT / JOB | DATE |
> |---|---|
> | {{project_name}} | {{document_date}} |

| | |
|---|---|
| Claimant (Contractor) | {{company_name}}, {{company_address}} |
| Property Owner | {{owner_name}} |
| Property Address | {{property_address}} |
| Legal Description (if known) | {{legal_description}} |
| Original Contract Ref. # | {{contract_number}} |

---

## Body

### PAYMENT

| | |
|---|---|
| Payment amount covered by this waiver | {{payment_amount}} |
| For labor/materials furnished through | {{through_date}} |
| Invoice / draw reference | {{invoice_reference}} |

### WAIVER AND RELEASE

**[partial_conditional]**
Upon receipt and clearance of payment in the amount of {{payment_amount}}, the undersigned
Claimant waives and releases any and all mechanic's lien, claim, or right to lien under
Minnesota Statutes chapter 514 upon the real property and improvements identified above, on
account of labor, services, materials, or equipment furnished by Claimant for the project
through {{through_date}} only. **This waiver is conditioned on actual receipt and clearance of
the payment identified above and is of no force or effect until that condition is satisfied.**
This waiver does not cover: (a) labor, services, materials, or equipment furnished after
{{through_date}}; (b) retainage; (c) amounts owing under executed but unbilled Change Orders;
or (d) claims for disputed work identified in writing before the date of this waiver.

**[partial_unconditional]**
The undersigned Claimant acknowledges receipt of payment in the amount of {{payment_amount}},
and in consideration of that payment waives and releases any and all mechanic's lien, claim, or
right to lien under Minnesota Statutes chapter 514 upon the real property and improvements
identified above, on account of labor, services, materials, or equipment furnished by Claimant
for the project through {{through_date}} only. This waiver does not cover: (a) labor, services,
materials, or equipment furnished after {{through_date}}; (b) retainage; (c) amounts owing
under executed but unbilled Change Orders; or (d) claims for disputed work identified in
writing before the date of this waiver.

**[final_conditional]**
Upon receipt and clearance of final payment in the amount of {{payment_amount}}, the
undersigned Claimant waives, releases, and relinquishes any and all mechanic's lien, claim, or
right to lien under Minnesota Statutes chapter 514 upon the real property and improvements
identified above, on account of any and all labor, services, materials, or equipment furnished
by Claimant for the project. **This waiver is conditioned on actual receipt and clearance of
the payment identified above and is of no force or effect until that condition is satisfied.**

**[final_unconditional]**
For and in consideration of final payment in the amount of {{payment_amount}}, the receipt and
sufficiency of which is hereby acknowledged, the undersigned Claimant does hereby
unconditionally waive, release, and relinquish any and all mechanic's lien, claim, or right to
lien it has under Minnesota Statutes chapter 514 upon the real property and improvements
identified above, on account of any and all labor, services, materials, or equipment furnished
by Claimant for the project. This waiver and release is unconditional and covers all work
performed through {{through_date}}.

### SUBCONTRACTORS AND SUPPLIERS

**[all variants]**
Claimant warrants that all subcontractors, laborers, and material suppliers engaged by Claimant
for the work covered by this waiver have been paid in full, or will be paid in full from the
payment identified above, for labor and materials furnished through {{through_date}}. Lien
waivers from subcontractors and suppliers who provided pre-lien notice are available to the
Owner upon written request, consistent with the notice provisions of the Agreement and Minn.
Stat. § 514.011.

### AMOUNTS *(auto-generated summary table)*

| | |
|---|---|
| Total contract price (incl. executed Change Orders) | {{contract_total}} |
| Total paid to date (incl. this payment if unconditional) | {{paid_to_date}} |
| Balance remaining after this payment | {{balance_remaining}} |

### SIGNATURE

The person signing below is authorized to execute this waiver on behalf of Claimant.

- {{company_name}} — signature / printed name & title / date

### NOTARIZATION *(optional — include when the recipient requires a sworn waiver)*

State of Minnesota, County of ______________. Subscribed and sworn before me this ____ day of
____________, 20____. Notary Public: ____________________________

---

*Footer (all variants): standard `LEGAL_DISCLAIMER` from `lib/documents.ts` — generated by SJC
OS to assist SJ Carpentry LLC; not legal advice; review with your attorney before sending,
serving, or filing.*

---

## Drafting notes for the attorney

- The four-variant structure mirrors common national practice; Minnesota has no statutory
  waiver form, so the exact conditional language ("of no force or effect until…") should be
  confirmed.
- Exclusions on partial waivers (retainage, post-date work, unbilled COs, noticed disputes)
  protect SJC from over-waiving on progress draws — confirm scope.
- The sub/supplier payment warranty aligns with the § 514.011 owner-notice language already in
  the construction contract.
- Notary block is optional by design: MN lien waivers generally don't require notarization, but
  some title companies and lenders ask for it.
