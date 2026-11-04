Daily SJ Carpentry invoice, receipt and rebate email pass. (Hermes cron job
`eb93c48c19e3`, 06:00 daily. Source of truth for this prompt:
`deploy/hermes/invoice-job-prompt.md` in the sjcos-app repo. Rewritten
2026-10-15 so SJC OS is the filing cabinet instead of `/home/joe/SJC OS Temp`.)

SJC OS is where every emailed invoice, receipt and rebate ends up. Never save
copies under `/home/joe/SJC OS Temp` or Google Drive, and don't write reports
there.

How to call SJC OS: write the JSON arguments to a file with your file tool
(e.g. `/tmp/sjcos-args.json`), then from `/home/joe/sjcos-app` run
`node mcp/call-tool.mjs <tool> < /tmp/sjcos-args.json`. Don't pipe into node
or use heredocs / `node -e` — the cron security scan blocks those — and never
put the arguments in a double-quoted shell word (it eats `$` amounts). Use
Gmail (google-workspace skill) only to find messages and set labels.

Start: `get_skill file-invoice-receipt-rebate` and follow it (`record_skill_used`).

1. Joe's notes first. `list_unsorted_documents` with
   `{"statuses":["needs_agent"]}`. Each one has Joe's `owner_note` saying where
   it goes. Carry it out with `file_unsorted_document` (`agent: "hermes"`). If
   a note is still ambiguous, leave it and list it in your summary.

2. Find the mail: invoices, bills, statements, payment requests, receipts,
   payment confirmations, order confirmations and rebates (Menards etc.). Joe
   clears his inbox with Gmail's "Move to" a label, so most of this mail is no
   longer in the inbox: never add `in:inbox`, and don't rely on keywords alone.
   Run both searches every pass:
   a. Everything recent: `newer_than:2d -from:me`. Go through every result's
      sender, subject and snippet. Anything that could be one of the documents
      above is a candidate, even without those words (a "Fwd:" with a PDF, a
      sub's note with an attachment).
   b. Mail Joe moved into a filing label, including older mail he moved there
      after it arrived: run `gmail labels` and take `Invoices`, `Receipts`,
      `Rebates`, and every label under `Projects/` or `Commercial/`. Search
      `newer_than:14d -from:me {label:invoices label:receipts label:rebates
      label:projects-mahowald …}`. Gmail search spells a nested label
      lowercase with dashes (`Projects/Edina Condo` →
      `label:projects-edina-condo`); `label:Projects` by itself matches
      nothing.
   Skip what SJC OS already has: call `list_unsorted_documents` once with
   `{"statuses":["pending","needs_agent","filed","dismissed"],"limit":200}`
   and drop any message whose `gmail_message_id` is in it. Open each remaining
   candidate: read the body and its attachments before deciding.

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

5. Gmail labels and inbox cleanup:
   - True invoices/payment requests keep `Invoices` and their read/unread state
     (never mark them read).
   - Receipts and payment confirmations get `Receipts` (remove `Invoices`).
   - Menards is a special paired-email case. For each order, use the Menards
     `Order Confirmation` from `order@orders.menards.com` only when that exact
     message has both the receipt/order details in its body AND a real rebate
     attachment (normally a PDF). That combined message gets `Receipts` +
     `Rebates` + `Unclaimed Rebates`, is marked read, and has the `INBOX` label
     removed so it leaves the inbox. Verify those labels and the absence of
     `INBOX` on the exact message after modifying it.
   - The separate Menards email that merely shows the rebate in the email body
     and has no rebate attachment is not the filing copy. Archive it by removing
     `INBOX`, but do not add `Receipts`, `Rebates`, or `Unclaimed Rebates`, and
     do not file it in SJC OS. Verify that it is out of the inbox.
   - For any other retailer's rebate, require the actual claimable rebate
     document/form (attachment or explicit claim artifact) before applying
     `Rebates` + `Unclaimed Rebates`; do not treat a rebate mention alone as a
     claimable rebate.

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
