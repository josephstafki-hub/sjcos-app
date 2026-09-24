// SJC OS — MCP decision tools (A10 one-tap decisions).
//
// THE LINE, restated for decisions: agents STAGE review cards; people
// RESOLVE them. A card is derived from the exact payload the agent hands
// over (recipients, inclusions, exclusions, quantities, attachments, gaps,
// changes since last review, exact effect of approving) and its hash is over
// that same payload, so what Joe approves is what goes out. One decision id
// is shown in SJC OS (/engine/decisions) and on Joe's phone (Telegram
// buttons); the first answer wins everywhere. Nothing in this module can
// approve anything.
//
//   stage_decision          → stage (or re-find) a card; returns the id.
//   get_decision            → read one.
//   list_pending_decisions  → what is waiting.
//   wait_for_decision       → long-poll until it is answered (≤ 25 s/call).
//
// The transitional owner-grant tools (mcp/grants-tools.mjs) keep working:
// a request_owner_permission is mirrored as a decision of kind 'grant'.
//
// Registration (integration owner): registerDecisionTools(server, { json,
// decisionsCall }) where decisionsCall(action, payload) posts to
// /api/internal/decisions with CRON_SECRET — same shape as grantsCall. When
// no decisionsCall is supplied this module builds one from APP_INTERNAL_URL
// + CRON_SECRET (process.env or ../.env.local).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    const m = env.match(new RegExp(`^${key}=(.+)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

export async function defaultDecisionsCall(action, payload = {}) {
  const base = envValue("APP_INTERNAL_URL") || "http://127.0.0.1:3017";
  const secret = envValue("CRON_SECRET");
  if (!secret) return { ok: false, error: "CRON_SECRET not set — cannot reach the app decisions route." };
  try {
    const res = await fetch(`${base}/api/internal/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `App not reachable at ${base} (${e.message}). Is the sjcos service running?` };
  }
}

const recipient = z.object({
  name: z.string().min(1),
  address: z.string().optional().describe("Email address (or +E.164). Omit when none is on file — the card says so."),
  role: z.string().optional().describe("Trade / supplier role, e.g. 'Electrical sub'."),
  ref: z.union([z.string(), z.number()]).optional().describe("Per-recipient record id (bid invite id, outbox row id)."),
});

const packageSchema = z.object({
  kind: z.enum(["bid_package", "pricing_request", "selection_package", "mood_board", "newsletter_issue", "document", "other"]),
  id: z.union([z.string(), z.number()]),
  title: z.string().min(1),
  revision: z.union([z.string(), z.number()]).describe("The artifact revision this card is for; a new revision needs a new approval."),
  projectName: z.string().optional(),
  recipients: z.array(recipient).min(1),
  inclusions: z.array(z.string()).describe("Plain-language lines: what work / content is included."),
  exclusions: z.array(z.string()).optional().describe("Important exclusions."),
  retained: z.array(z.string()).optional().describe("Work Joe keeps for himself (shown as an exclusion)."),
  quantities: z.array(z.object({ label: z.string(), qty: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  attachments: z.array(z.object({ label: z.string(), filename: z.string().optional(), revision: z.string().optional(), fileId: z.string().optional() })).optional(),
  assumptions: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional().describe("Missing information the recipient will have to assume or ask about. Show them even if they make the package look worse."),
  dueDate: z.string().optional(),
  message: z.string().optional().describe("The message text recipients get."),
  previous: z.any().optional().describe("The last reviewed revision (same shape) so the card can list what changed."),
  extra: z.record(z.string(), z.any()).optional(),
});

export function registerDecisionTools(server, { json, decisionsCall } = {}) {
  const call = decisionsCall ?? defaultDecisionsCall;
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
  const agentName = () => {
    try {
      const c = server.server.getClientVersion?.();
      if (c?.name) return String(c.name).slice(0, 40);
    } catch {
      /* pre-initialize */
    }
    return process.env.SJCOS_AGENT_NAME || "agent";
  };

  server.registerTool(
    "stage_decision",
    {
      title: "Stage a review card for Joe (cannot approve)",
      description:
        "Stage ONE exact decision for the owner (or an authorised delegate): a package release (bid package, " +
        "pricing request, selection/mood package, newsletter issue, document) or any other exact action. " +
        "Pass `package` and the card is BUILT from it — recipients and role, included work, exclusions " +
        "(incl. Joe's retained work), quantities/units, attachment revisions, assumptions/gaps, changes " +
        "since the last review, and the exact effect of approving. Or pass `content` (the exact object) " +
        "with your own `summary`. Same dedupe_key + same content returns the existing card (no duplicate " +
        "alert); changed content supersedes it. Returns the decision id — then wait_for_decision. Approval " +
        "wakes the intents staged under decision_id; it never sends by itself. Keep copy factual: no " +
        "invented calls, visits or feelings.",
      inputSchema: {
        kind: z.enum(["package_release", "proposal", "purchase", "payment", "refund", "publication", "schedule", "funding", "markup", "change_order", "design_package", "other"]),
        decision_action: z.string().describe("The gated action the consumer will present, e.g. send_bid_package, send_purchase_order, release_newsletter_outbox_item, send_email."),
        title: z.string().max(300).optional(),
        package: packageSchema.optional(),
        content: z.record(z.string(), z.any()).optional().describe("Exact object being approved when not a package."),
        summary: z.record(z.string(), z.any()).optional().describe("Card fields when `content` is used: recipients, inclusions, exclusions, quantities, attachments, assumptions, gaps, changes, effect."),
        target_kind: z.string().optional(),
        target_id: z.string().optional(),
        recipient: z.string().optional().describe("Single recipient (normalized) when the decision is for one address."),
        amount_cents: z.number().int().optional(),
        project_id: z.string().uuid().optional(),
        lead_id: z.string().uuid().optional(),
        work_item_id: z.string().uuid().optional().describe("Work item to wake when the decision is answered."),
        href: z.string().optional().describe("App path to the full artifact."),
        dedupe_key: z.string().optional().describe("One pending decision per key (default: <package kind>:<id>)."),
        expires_in_minutes: z.number().int().positive().optional(),
        max_uses: z.number().int().positive().optional().describe("Defaults to the recipient count for packages, else 1."),
      },
    },
    async (input) => {
      try {
        return json(await call("stage", { ...input, agent: agentName() }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_decision",
    {
      title: "Read one decision",
      description: "Status and card of one decision: pending / approved / rejected / expired / revoked / superseded / consumed, who answered, via which channel, and the note.",
      inputSchema: { decision_id: z.string().uuid() },
    },
    async ({ decision_id }) => {
      try {
        return json(await call("get", { decision_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_pending_decisions",
    {
      title: "List pending decisions",
      description: "Every decision still waiting on a person (optionally for one project), including held ones.",
      inputSchema: { project_id: z.string().uuid().optional() },
    },
    async ({ project_id }) => {
      try {
        return json(await call("list_pending", { project_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "wait_for_decision",
    {
      title: "Wait for a decision to be answered",
      description:
        "Long-poll one decision for up to 25 seconds per call; returns settled=true with the final status once " +
        "it leaves 'pending'. Call again while settled=false. On 'approved' the app dispatches the linked " +
        "action itself — do not send it by hand. On 'rejected' read decision_note (a 'Changes requested: …' " +
        "note means revise and stage a new revision).",
      inputSchema: { decision_id: z.string().uuid(), timeout_ms: z.number().int().min(1000).max(25000).optional() },
    },
    async ({ decision_id, timeout_ms }) => {
      try {
        return json(await call("wait", { decision_id, timeout_ms }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
