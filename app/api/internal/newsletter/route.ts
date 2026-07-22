// Internal agent surface for the newsletter (MCP -> app bridge). The MCP server
// is plain JS and can't import the TS render/queue/drip modules, so it drives
// list + issue management THROUGH this route — one source of truth for the same
// logic the browser uses. Guarded by a bearer token (CRON_SECRET), a trusted
// local caller, not a browser session.
//
// SAFETY: this route exposes read/add/update/remove recipients, create/update/
// queue issues, the welcome-greeting text, and client-import only. It has NO
// 'release' and NO 'arm_sequence'
// action — sending to a real inbox and turning a drip on stay owner-gated in
// lib/actions/newsletter.ts and are unreachable from any agent. See the safety
// note at the top of lib/newsletter-agent.ts.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { readOutbox } from "@/lib/newsletter";
import { listSequences } from "@/lib/newsletter-drip";
import {
  agentListRecipients,
  agentAddRecipient,
  agentUpdateRecipient,
  agentRemoveRecipient,
  agentImportClientRecipients,
  agentListIssues,
  agentGetIssue,
  agentCreateIssue,
  agentUpdateIssue,
  agentQueueIssue,
  agentGetGreeting,
  agentUpdateGreeting,
} from "@/lib/newsletter-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/** Light audit so every agent mutation leaves a trace (mirrors doc-drafts). */
async function audit(action: string, summary: string) {
  try {
    await query(
      `INSERT INTO agent_runs (runtime_name, status, input_summary, output_summary, finished_at)
       VALUES ('mcp:newsletter','succeeded',$1,$2, now())`,
      [action.slice(0, 200), summary.slice(0, 500)],
    );
  } catch {
    /* audit is best-effort */
  }
}

const READ_ACTIONS = new Set([
  "list_recipients",
  "list_issues",
  "get_issue",
  "list_outbox",
  "list_sequences",
  "get_greeting",
]);

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const str = (v: unknown) => (v == null ? undefined : String(v));

  try {
    let result: { ok: boolean; error?: string; [k: string]: unknown };

    switch (action) {
      // ── Reads ──
      case "list_recipients":
        result = { ok: true, recipients: await agentListRecipients() };
        break;
      case "list_issues":
        result = { ok: true, issues: await agentListIssues() };
        break;
      case "get_issue": {
        const got = await agentGetIssue(Number(body.id));
        result = got.ok ? { ok: true, issue: got.data } : got;
        break;
      }
      case "list_outbox":
        result = { ok: true, outbox: await readOutbox() };
        break;
      case "list_sequences":
        result = { ok: true, sequences: await listSequences() };
        break;
      case "get_greeting": {
        const got = await agentGetGreeting();
        result = got.ok ? { ok: true, greeting: got.data } : got;
        break;
      }

      // ── Email-list writes ──
      case "add_recipient":
        result = await agentAddRecipient(String(body.email ?? ""), str(body.name) ?? "");
        break;
      case "update_recipient":
        result = await agentUpdateRecipient(
          { id: num(body.id), email: str(body.email) },
          { name: str(body.name), active: typeof body.active === "boolean" ? body.active : undefined },
        );
        break;
      case "remove_recipient":
        result = await agentRemoveRecipient({ id: num(body.id), email: str(body.email) });
        break;
      case "import_client_recipients":
        result = await agentImportClientRecipients();
        break;
      case "update_greeting": {
        const saved = await agentUpdateGreeting(str(body.subject) ?? "", str(body.body) ?? "");
        result = saved.ok ? { ok: true, greeting: saved.data } : saved;
        break;
      }

      // ── Issue writes ──
      case "create_issue":
        result = await agentCreateIssue(str(body.template_key));
        break;
      case "update_issue":
        result = await agentUpdateIssue(Number(body.id), {
          title: str(body.title),
          intro: str(body.intro),
          blocks: body.blocks,
        });
        break;
      case "queue_issue":
        result = await agentQueueIssue(Number(body.id));
        break;

      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }

    if (result.ok && !READ_ACTIONS.has(action)) {
      revalidatePath("/newsletter");
      await audit(action, JSON.stringify(result).slice(0, 500));
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    );
  }
}
