// SJC OS — MCP tools for emailed invoices / receipts / rebates (Unsorted
// documents). Wired from sjcos-mcp.mjs:
//
//   registerFilingTools(server, { json, filingCall, strippedDollarError });
//
// The flow (skill `file-invoice-receipt-rebate` v2):
//   • sure which job it is      → file_email_document (project_slug)
//   • clearly company overhead  → file_email_document (target "overhead")
//   • not sure                  → stage_unsorted_document with 1–3 guesses;
//                                 Joe sorts it on /unsorted with one tap
//   • Joe typed a note instead  → list_unsorted_documents (needs_agent) →
//                                 file_unsorted_document
//   • a file Joe dropped into the Ask window → the same tools with file_paths
//   • your answer on a doc      → reply_on_unsorted_document (a question hands
//                                 it back to Joe)
//
// Sorting on /unsorted also wakes a small agent run at once (trigger kind
// 'filing', cheap model): it carries out Joe's note, or files the cost he just
// logged under the right trade / PO, and answers with reply_on_unsorted_document.
//
// Every call goes through the app (app/api/internal/filing): the app reads the
// Gmail message itself and stores the email body + attachments as project
// files, so an agent passes a message id, never file bytes. Internal records
// only — nothing is sent to anyone, so no owner grant is involved. Filing
// logs the cost through the same writers as add_expense / record_sub_invoice,
// keyed on the email, so filing the same email twice never counts it twice.

import { z } from "zod";

const KINDS = ["invoice", "receipt", "rebate", "statement", "other"];

export function registerFilingTools(server, { json, filingCall, strippedDollarError }) {
  const cents = z.number().int().describe("integer cents");
  const docFields = {
    gmail_message_id: z.string().optional().describe("Gmail message id (the 16-hex id). The app pulls the email body and every attachment from the company mailbox itself."),
    kind: z.enum(KINDS).describe("invoice = a bill SJC owes; receipt = proof SJC paid; rebate; statement (repeats invoices — never a cost); other."),
    vendor: z.string().optional().describe("Who it's from, as it should read on the job (e.g. 'Menards', '10 Electric')."),
    amount_cents: cents.optional().describe("Total on the document, integer cents. Negative for a refund/return."),
    doc_date: z.string().optional().describe("YYYY-MM-DD on the document (invoice/receipt date)."),
    doc_number: z.string().optional().describe("Invoice / order / receipt number."),
    summary: z.string().optional().describe("One line: what this is and what it's for."),
    agent: z.string().optional().describe("Your agent key, e.g. 'hermes'. Shown to Joe as who staged / filed it."),
    source_ref: z.string().optional().describe("Only when there is no Gmail id: your own stable key for this document."),
    file_paths: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("Files you were handed instead of an email: the absolute path of a file Joe dropped into the Ask window (uploads/ai-chat/…). The app reads and stores it; nothing outside the allowed folders is read."),
    body_text: z.string().optional().describe("Only when there is no Gmail id: the email/document text."),
    attachments: z
      .array(z.object({ filename: z.string(), mime_type: z.string(), base64: z.string() }))
      .optional()
      .describe("Only when there is no Gmail id: PDFs / images as base64 (≤20 MB each)."),
  };
  const textsOf = (a) => [a.vendor, a.summary, a.why_unsure, a.note, ...(a.suggestions ?? []).map((s) => s.reason)];

  server.registerTool(
    "stage_unsorted_document",
    {
      title: "Put an emailed invoice/receipt in Joe's Unsorted tray",
      description:
        "For an invoice, receipt or rebate you can't tie to ONE project with certainty. It lands on the Unsorted page " +
        "(main sidebar), where Joe sees the document and the email and files it with one tap. Give your best 1–3 " +
        "project guesses (`suggestions`, best first, each with a short reason Joe reads), set `overhead_likely` when it " +
        "may be company overhead, and say in `why_unsure` what's missing. Idempotent per Gmail message: staging it " +
        "again refreshes your read; a document Joe already filed is never re-opened. Never force a match from " +
        "vendor, date or card alone — that's what this tray is for.",
      inputSchema: {
        ...docFields,
        suggestions: z
          .array(z.object({ project_slug: z.string(), reason: z.string() }))
          .max(5)
          .optional()
          .describe("Best guesses first. project_slug from list_projects."),
        overhead_likely: z.boolean().optional(),
        why_unsure: z.string().optional().describe("One line on what would have made it certain."),
      },
    },
    async (a) => strippedDollarError(...textsOf(a)) ?? json(await filingCall("stage", a)),
  );

  server.registerTool(
    "file_email_document",
    {
      title: "File an emailed invoice/receipt to a project (or overhead)",
      description:
        "For an invoice, receipt or rebate whose project you're SURE of: the client's name or the job address is on " +
        "it, an invoice/order/PO number already tied to one project, the same Gmail thread as something already filed " +
        "there, or Joe forwarded it naming the job. Pulls the email + attachments from Gmail, attaches them to the " +
        "project's Files (tagged INVOICE/RECEIPT/REBATE · Email), and logs the cost: an invoice as owed (a sub/vendor " +
        "bill), a receipt as spent (an expense). Pass `log_cost: false` when the cost is already entered (a PO payment, " +
        "an invoice recorded by hand) so it never counts twice; rebates and statements never log a cost. " +
        "`target: 'overhead'` files company overhead (software, phone, insurance, loan/tax payments) with no job. " +
        "Every filing shows on the Unsorted page's Filed list, where Joe can Undo it. Not sure? Use " +
        "stage_unsorted_document instead.",
      inputSchema: {
        ...docFields,
        target: z.enum(["project", "overhead"]).optional().describe("Default 'project' when project_slug is given."),
        project_slug: z.string().optional(),
        log_cost: z.boolean().optional().describe("Default: true for an invoice or receipt with an amount."),
      },
    },
    async (a) => strippedDollarError(...textsOf(a)) ?? json(await filingCall("file_email", a)),
  );

  server.registerTool(
    "reply_on_unsorted_document",
    {
      title: "Answer on a document in the Unsorted tray",
      description:
        "Leave one plain line on a tray document that Joe sees on the Unsorted page: where you put its cost (\"Filed under Electrical, pays PO-004\"), " +
        "that it looks like a duplicate of an earlier bill, or a question when his note doesn't say where it goes. " +
        "`give_back: true` returns a document waiting on the agent to Joe's tray with your question — use it instead of guessing.",
      inputSchema: {
        id: z.number().int().positive(),
        message: z.string(),
        give_back: z.boolean().optional(),
      },
    },
    async (a) => strippedDollarError(a.message) ?? json(await filingCall("reply", a)),
  );

  server.registerTool(
    "list_unsorted_documents",
    {
      title: "List documents in the Unsorted tray",
      description:
        "Default: everything still open — 'pending' (waiting on Joe) and 'needs_agent' (Joe typed where it goes in " +
        "`owner_note` instead of picking a project: act on it with file_unsorted_document). Ask for 'filed' / " +
        "'dismissed' to see what was put away and where (filed_project_slug, cost_source/cost_id). Receipts " +
        "photographed on a phone (source_ref 'scan:…') or texted in ('sms:…') carry Claude's read in `extracted` " +
        "(vendor, location, date, items with qty/description/amount, totals, job_hint written on it) plus " +
        "`sender_note` / `sender_project_slug` from whoever sent it.",
      inputSchema: {
        statuses: z.array(z.enum(["pending", "needs_agent", "filed", "dismissed"])).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (a) => json(await filingCall("list", a)),
  );

  server.registerTool(
    "file_unsorted_document",
    {
      title: "File a document from the Unsorted tray",
      description:
        "Put away a tray document by `id` (from list_unsorted_documents): to a project (`project_slug`), to " +
        "`overhead`, or `dismiss` (not a business cost). Same filing as file_email_document — files move onto the " +
        "project and the cost is logged unless `log_cost: false`. Use it to carry out Joe's `owner_note` on a " +
        "needs_agent document; if the note is ambiguous, ask_owner instead of guessing. You may correct the kind, " +
        "amount or vendor while filing.",
      inputSchema: {
        id: z.number().int().positive(),
        target: z.enum(["project", "overhead", "dismiss"]),
        project_slug: z.string().optional(),
        log_cost: z.boolean().optional(),
        kind: z.enum(KINDS).optional(),
        amount_cents: cents.nullable().optional(),
        vendor: z.string().optional(),
        note: z.string().optional().describe("Short note kept with the record (e.g. what Joe's note meant)."),
        agent: z.string().optional(),
      },
    },
    async (a) => strippedDollarError(...textsOf(a)) ?? json(await filingCall("file", a)),
  );
}
