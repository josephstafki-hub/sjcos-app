// SJC OS — MCP owner-grant tools (express permission for sends).
//
// THE LINE, restated: on their own, agents draft and stage; they do not send
// client- or vendor-facing email. What this module adds is the way the OWNER
// moves that line for one specific thing — an "owner grant" (lib/owner-grants.ts):
//
//   request_owner_permission  → agent asks ("send bid package 12 to the subs
//                               because Joe said the plans are final") → a
//                               Decision notification; Joe approves/denies on
//                               /engine/permissions.
//   check_owner_permission    → poll a request; list_owner_permissions → what
//                               is currently granted.
//   send_* / release_* tools  → each REQUIRES owner_grant_id. The app spends
//                               the grant for exactly that action + target
//                               (atomic, audited), then runs the same send
//                               core the owner's button uses. A grant that
//                               doesn't cover the call is refused with a
//                               reason the agent can relay.
//
// Grants also come from the owner directly: the Ask window's "Express
// permission" checkbox mints a run-scoped '*' grant that Claude is told about
// in its prompt, and /engine/permissions lets Joe hand one to any MCP client.
//
// Without a grant id, nothing here transmits anything.

import { z } from "zod";

const GATED = [
  "send_bid_package",
  "send_purchase_order",
  "send_invoice",
  "release_newsletter_issue",
  "release_newsletter_outbox_item",
  "send_document_for_signature",
  "send_email",
  "send_sms",
  "place_call",
];

export function registerGrantTools(server, { json, grantsCall }) {
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
  const uuid = z.string().uuid().describe("The owner_grant_id Joe gave you (or that check_owner_permission showed approved).");

  // Who is asking — the MCP client's declared name (Claude Code, claude-ai,
  // Hermes, …) or an env override; purely for the audit line + notification.
  const agentName = () => {
    try {
      const c = server.server.getClientVersion?.();
      if (c?.name) return String(c.name).slice(0, 40);
    } catch {
      /* pre-initialize */
    }
    return process.env.SJCOS_AGENT_NAME || "agent";
  };

  const perform = async (gated_action, payload) => {
    try {
      const r = await grantsCall("perform", { gated_action, agent: agentName(), ...payload });
      return json(r);
    } catch (e) {
      return fail(e);
    }
  };

  // ── asking / checking ──────────────────────────────────────────────────────

  server.registerTool(
    "request_owner_permission",
    {
      title: "Ask Joe for permission to send",
      description:
        "Ask the owner for express permission to do ONE gated send (email a bid package, PO, " +
        "invoice, document, newsletter, or a one-off email). Creates a permission request Joe " +
        "sees as a Decision notification and approves on /engine/permissions. Returns the grant " +
        "id — poll it with check_owner_permission, then pass it as owner_grant_id to the send " +
        "tool. Be specific in `reason` (what, to whom, why now). If Joe already gave you a " +
        "grant id in this conversation, use that instead of asking again.",
      inputSchema: {
        action: z.enum(GATED).describe("Which gated send you want to perform."),
        target_id: z
          .string()
          .optional()
          .describe("The record id (bid package / PO / invoice / draft / issue / outbox row id), for send_email the recipient address, for send_sms / place_call the +E.164 phone number."),
        reason: z.string().describe("What you want to send and why, in one or two sentences — Joe reads this."),
        conversation_id: z.string().uuid().optional().describe("Ask-window thread id, if you know it."),
      },
    },
    async ({ action, target_id, reason, conversation_id }) => {
      try {
        return json(await grantsCall("request", { gated_action: action, target_id, reason, conversation_id, agent: agentName() }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "check_owner_permission",
    {
      title: "Check a permission request",
      description:
        "Status of one owner grant: requested (waiting on Joe), approved (live → use it), denied, " +
        "revoked, or spent/expired. Includes its audit trail.",
      inputSchema: { grant_id: z.string().uuid() },
    },
    async ({ grant_id }) => {
      try {
        return json(await grantsCall("check", { grant_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_owner_permissions",
    {
      title: "List live permissions",
      description: "Owner grants that are pending or currently usable, so you can see what you're already allowed to send.",
      inputSchema: {},
    },
    async () => {
      try {
        return json(await grantsCall("list"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── gated sends — every one needs owner_grant_id ──────────────────────────

  server.registerTool(
    "send_bid_package",
    {
      title: "Send a bid package (needs owner grant)",
      description:
        "Email the bid request + packet files to every unsent sub on the package and mark them sent. " +
        "REQUIRES owner_grant_id — Joe's express permission for this package. Stage the package " +
        "first (files, invites, notes) and confirm with get_bid_package; the send is real email.",
      inputSchema: { package_id: z.number().int().positive(), owner_grant_id: uuid },
    },
    async ({ package_id, owner_grant_id }) => perform("send_bid_package", { target_id: String(package_id), grant_id: owner_grant_id }),
  );

  server.registerTool(
    "send_purchase_order",
    {
      title: "Send a purchase order (needs owner grant)",
      description:
        "Email a draft/queued PO to its vendor and mark it sent. REQUIRES owner_grant_id. " +
        "Check the lines with get_purchase_order first; the vendor needs an email on file.",
      inputSchema: { po_id: z.number().int().positive(), owner_grant_id: uuid },
    },
    async ({ po_id, owner_grant_id }) => perform("send_purchase_order", { target_id: String(po_id), grant_id: owner_grant_id }),
  );

  server.registerTool(
    "send_invoice",
    {
      title: "Send an invoice (needs owner grant)",
      description:
        "Email a draft invoice to the project's client and mark it sent. REQUIRES owner_grant_id. " +
        "The project must have an active client login with an email.",
      inputSchema: { invoice_id: z.number().int().positive(), owner_grant_id: uuid },
    },
    async ({ invoice_id, owner_grant_id }) => perform("send_invoice", { target_id: String(invoice_id), grant_id: owner_grant_id }),
  );

  server.registerTool(
    "release_newsletter_issue",
    {
      title: "Release a newsletter issue (needs owner grant)",
      description:
        "Release every queued outbox row for one issue — this is the real send to every recipient. " +
        "REQUIRES owner_grant_id. Queue the issue first (queue_newsletter_issue); rows that fail are " +
        "left 'failed' to retry.",
      inputSchema: { issue_id: z.number().int().positive(), owner_grant_id: uuid },
    },
    async ({ issue_id, owner_grant_id }) => perform("release_newsletter_issue", { target_id: String(issue_id), grant_id: owner_grant_id }),
  );

  server.registerTool(
    "release_newsletter_outbox_item",
    {
      title: "Release one outbox row (needs owner grant)",
      description:
        "Release a single parked newsletter outbox row (a greeting or one recipient of an issue). " +
        "REQUIRES owner_grant_id. See list_newsletter_outbox for ids.",
      inputSchema: { outbox_id: z.number().int().positive(), owner_grant_id: uuid },
    },
    async ({ outbox_id, owner_grant_id }) =>
      perform("release_newsletter_outbox_item", { target_id: String(outbox_id), grant_id: owner_grant_id }),
  );

  server.registerTool(
    "send_document_for_signature",
    {
      title: "Send a document for signature (needs owner grant)",
      description:
        "Submit a RENDERED document draft for signature (emails the signer a portal link when one is " +
        "on file). REQUIRES owner_grant_id. Render it first (render_document_draft) and resolve " +
        "missing fields; `override` pushes past the missing-fields gate only if Joe said so.",
      inputSchema: {
        draft_id: z.number().int().positive(),
        owner_grant_id: uuid,
        override: z.boolean().optional(),
      },
    },
    async ({ draft_id, owner_grant_id, override }) =>
      perform("send_document_for_signature", { target_id: String(draft_id), grant_id: owner_grant_id, override: Boolean(override) }),
  );

  server.registerTool(
    "send_email",
    {
      title: "Send an email from Joe's inbox (needs owner grant)",
      description:
        "Send a one-off plain-text email from the business Gmail. REQUIRES owner_grant_id; a grant " +
        "may be limited to one recipient address. Use for the specific email Joe asked you to send — " +
        "quote his wording where he gave it. Signs as Joe / SJ Carpentry only if the body does.",
      inputSchema: {
        to: z.string().email(),
        subject: z.string().max(200),
        body: z.string().min(1).max(20000).describe("Plain text."),
        owner_grant_id: uuid,
      },
    },
    async ({ to, subject, body, owner_grant_id }) =>
      perform("send_email", { grant_id: owner_grant_id, email: { to, subject, body } }),
  );

  // ── SMS + voice (Telnyx). Same line: no grant, nothing transmits. ────────

  server.registerTool(
    "send_sms",
    {
      title: "Send a text message (needs owner grant)",
      description:
        "Send ONE SMS from the business number to a client, sub or vendor. REQUIRES owner_grant_id " +
        "for action send_sms on that +E.164 number (a grant may be pinned to one number). The app " +
        "refuses opted-out contacts (STOP) with a clear reason, normalizes 10-digit US numbers to " +
        "+1, and files a work item on any provider failure — including '10DLC campaign not yet " +
        "approved' while carrier review is pending. Keep it short and plain; include 'Reply STOP to " +
        "opt out' on first contact. Read the thread first with get_sms_thread.",
      inputSchema: {
        to: z.string().describe("Recipient phone, +E.164 preferred (10-digit US accepted)."),
        body: z.string().min(1).max(1600).describe("Plain text. Portal links are fine."),
        owner_grant_id: uuid,
      },
    },
    async ({ to, body, owner_grant_id }) => perform("send_sms", { grant_id: owner_grant_id, sms: { to, body } }),
  );

  server.registerTool(
    "place_call",
    {
      title: "Place a phone call for Joe (needs owner grant)",
      description:
        "Click-to-call: the OS rings JOE'S CELL FIRST; when he answers it dials the number and " +
        "bridges them, recording + transcribing the call and producing AI call notes afterwards. " +
        "REQUIRES owner_grant_id for action place_call on that +E.164 number. Only use when Joe " +
        "asked to be connected to someone now — never to 'check in' on your own initiative.",
      inputSchema: {
        to: z.string().describe("Number to dial, +E.164 preferred."),
        contact_name: z.string().max(120).optional().describe("Who it is, for the call record and the spoken 'no answer' line."),
        owner_grant_id: uuid,
      },
    },
    async ({ to, contact_name, owner_grant_id }) =>
      perform("place_call", { grant_id: owner_grant_id, call: { to, contact_name: contact_name ?? null } }),
  );
}
