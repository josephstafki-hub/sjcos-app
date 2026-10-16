Daily SJ Carpentry invoice, receipt and rebate email pass. (Hermes cron job
`eb93c48c19e3`, 06:00 daily. Source of truth for this prompt:
`deploy/hermes/invoice-job-prompt.md` in the sjcos-app repo. Rewritten
2026-10-15 so SJC OS is the filing cabinet instead of `/home/joe/SJC OS Temp`.)

SJC OS is where every emailed invoice, receipt and rebate ends up. Never save
copies under `/home/joe/SJC OS Temp` or Google Drive, and don't write reports
there.

How to call SJC OS: from `/home/joe/sjcos-app`, pipe the JSON arguments on
stdin: `printf '%s' '<json>' | node mcp/call-tool.mjs <tool>`. Never put the
arguments in a double-quoted shell word (it eats `$` amounts). Use Gmail
(google-workspace skill) only to find messages and set labels.

Start: `get_skill file-invoice-receipt-rebate` and follow it (`record_skill_used`).

1. Joe's notes first. `list_unsorted_documents` with
   `{"statuses":["needs_agent"]}`. Each one has Joe's `owner_note` saying where
   it goes. Carry it out with `file_unsorted_document` (`agent: "hermes"`). If
   a note is still ambiguous, leave it and list it in your summary.

2. Find new mail since the last run: invoices, bills, statements, payment
   requests, receipts, payment confirmations, order confirmations and rebates
   (Menards etc.). Include anything already labeled `Invoices`. Open each one:
   read the body and its attachments before deciding.

3. Decide for each message, using its Gmail message id:
   - Sure of the project → `file_email_document` with `project_slug`.
     Sure means: the client's name or the job address is on it, an
     invoice/order/PO number already tied to one project, the same Gmail
     thread as a document already filed there, or Joe forwarded it naming the
     job. `list_projects` / `search` to find the slug. Vendor, date or card
     alone is NOT sure.
   - Clearly company overhead (software and subscriptions like Google
     Workspace, Anthropic, OpenAI, Telnyx; phone; insurance; loan, tax or IRS
     payments; utilities) → `file_email_document` with `target: "overhead"`.
   - Not sure → `stage_unsorted_document` with your 1–3 best project
     guesses (`suggestions`, each with a short reason Joe reads), set
     `overhead_likely` when it might be overhead, and one line of
     `why_unsure`. Joe sorts these on the Unsorted page.
   - Not a business document at all (marketing, a shipping notice with no
     amount, a duplicate reminder of something already filed) → skip it.
   Always pass `kind`, `vendor`, `amount_cents` (integer cents), `doc_date`,
   `doc_number` when the document shows them, a one-line `summary`, and
   `agent: "hermes"`.

4. Costs. Filing an invoice or receipt with an amount logs the cost on the
   job. Before filing, check `get_project_financials` costs[] for the same
   vendor and amount (or a purchase order it pays): if it's already there,
   pass `log_cost: false` so it never counts twice. A reminder for an invoice
   you already filed is not a new invoice — skip it.

5. Gmail labels, as before: true invoices/payment requests keep `Invoices`
   and their read/unread state (never mark them read). Receipts and payment
   confirmations get `Receipts` (remove `Invoices`). Rebates get `Rebates` +
   `Unclaimed Rebates` and may be marked read.

6. One-time backfill, until `/home/joe/.hermes/state/sjcos-filing-backfill-done`
   exists: the old run saved files under
   `/home/joe/SJC OS Temp/project_files/`, and the 16-hex Gmail message id is
   in each filename (`INV_<id>_…`, `RCT_<id>_…`). For every distinct id:
   - in a project folder (e.g. `Libby_Mahowald/Invoices`) →
     `file_email_document` to that project, checking costs first (step 4);
   - in `_Unmatched_Email_Review` → decide as in step 3 (overhead, sure, or
     stage it for Joe).
   Skip ids already in `list_unsorted_documents` with statuses filed/dismissed.
   When all are done, create the marker file. Don't delete the old folders.

7. Proof: `record_agent_run` with counts, then reply to Joe with a short
   summary: filed to jobs (by job), overhead, waiting for him on the Unsorted
   page, Joe's notes carried out, skipped, errors. If nothing new, say so in
   one line.

Safety: never send email, never delete or change email content, never file
from vendor/date/card alone. If an SJC OS call fails, report it and continue
with the rest.
