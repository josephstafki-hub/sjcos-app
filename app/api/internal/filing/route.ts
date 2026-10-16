// Internal bridge (MCP → app) for Unsorted documents. The MCP server runs in
// its own process and can't reach Gmail or the blob store's TS helpers, so its
// filing tools land here (mcp/filing-tools.mjs). Bearer-gated with CRON_SECRET
// like the other internal routes. Internal records only: nothing is sent.

import { NextResponse } from "next/server";
import { servicePrincipal, runDirect } from "@/lib/commands/db";
import {
  fileDocument,
  getDoc,
  listDocsByStatus,
  replyOnDocument,
  stageFromEmail,
  type DocStatus,
  type FileTarget,
  type StageFromEmailInput,
} from "@/lib/unsorted-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;
const str = (v: unknown) => (v == null ? undefined : String(v));
const cents = (v: unknown) => (v == null || v === "" ? null : Number(v));

function stageInput(b: Body): StageFromEmailInput {
  return {
    gmailMessageId: str(b.gmail_message_id),
    gmailThreadId: str(b.gmail_thread_id),
    sourceRef: str(b.source_ref),
    kind: String(b.kind ?? "invoice"),
    fromLabel: str(b.from),
    subject: str(b.subject),
    receivedAt: str(b.received_at),
    vendorLabel: str(b.vendor),
    amountCents: cents(b.amount_cents),
    docDate: str(b.doc_date),
    docNumber: str(b.doc_number),
    summary: str(b.summary),
    whyUnsure: str(b.why_unsure),
    suggestions: Array.isArray(b.suggestions) ? (b.suggestions as { project_slug: string; reason: string }[]) : [],
    overheadLikely: Boolean(b.overhead_likely),
    bodyText: str(b.body_text),
    attachments: Array.isArray(b.attachments) ? (b.attachments as StageFromEmailInput["attachments"]) : [],
    filePaths: Array.isArray(b.file_paths) ? b.file_paths.map(String) : [],
    stagedBy: str(b.agent) ?? "agent",
  };
}

function targetOf(b: Body): FileTarget | string {
  const t = String(b.target ?? (b.project_slug ? "project" : ""));
  if (t === "project") return b.project_slug ? { to: "project", projectSlug: String(b.project_slug) } : "project_slug is required to file to a project.";
  if (t === "overhead") return { to: "overhead" };
  if (t === "dismiss") return { to: "dismiss" };
  return "target must be 'project' (with project_slug), 'overhead' or 'dismiss'.";
}

function fileOpts(b: Body) {
  return {
    by: str(b.agent) ?? "agent",
    logCost: b.log_cost == null ? undefined : Boolean(b.log_cost),
    kind: str(b.kind),
    amountCents: b.amount_cents === undefined ? undefined : cents(b.amount_cents),
    vendorLabel: str(b.vendor),
    note: str(b.note),
  };
}

export async function POST(req: Request) {
  if (!servicePrincipal(req, "mcp:filing")) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    switch (String(body.action ?? "")) {
      case "stage":
        return NextResponse.json(await stageFromEmail(stageInput(body)));

      // Sure of the destination: stage (pulls the email + attachments) and file in one go.
      case "file_email": {
        const target = targetOf(body);
        if (typeof target === "string") return NextResponse.json({ ok: false, error: target });
        const staged = await stageFromEmail({ ...stageInput(body), whyUnsure: "" });
        if (!staged.ok) return NextResponse.json(staged);
        if (staged.status === "filed" || staged.status === "dismissed") {
          const doc = await getDoc(runDirect, staged.id);
          return NextResponse.json({ ok: true, id: staged.id, already: true, status: doc?.status, filed_to: doc?.filed_to, project_slug: doc?.filed_project_slug, note: "Already put away earlier — nothing changed." });
        }
        const filed = await fileDocument(staged.id, target, fileOpts(body));
        return NextResponse.json(filed.ok ? { ...filed, files: "files" in staged ? staged.files : 0, skipped_attachments: "skipped_attachments" in staged ? staged.skipped_attachments : [] } : { ...filed, id: staged.id, note: "The document is in the Unsorted tray; fix the input and file it with file_unsorted_document." });
      }

      case "file": {
        const target = targetOf(body);
        if (typeof target === "string") return NextResponse.json({ ok: false, error: target });
        return NextResponse.json(await fileDocument(Number(body.id), target, fileOpts(body)));
      }

      case "reply":
        return NextResponse.json(await replyOnDocument(Number(body.id), String(body.message ?? ""), Boolean(body.give_back)));

      case "list": {
        const allowed: DocStatus[] = ["pending", "needs_agent", "filed", "dismissed"];
        const wanted = (Array.isArray(body.statuses) ? body.statuses : ["pending", "needs_agent"]).map(String).filter((s): s is DocStatus => (allowed as string[]).includes(s));
        const docs = await listDocsByStatus(runDirect, wanted.length ? wanted : ["pending", "needs_agent"], Math.min(Number(body.limit) || 50, 200));
        return NextResponse.json({ ok: true, documents: docs });
      }

      case "get": {
        const doc = await getDoc(runDirect, Number(body.id));
        return NextResponse.json(doc ? { ok: true, document: doc } : { ok: false, error: "No such document." });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${String(body.action)}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
