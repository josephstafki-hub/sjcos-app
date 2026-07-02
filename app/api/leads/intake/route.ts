import { NextResponse } from "next/server";
import { intakeTokenMatches } from "@/lib/lead-intake-token";
import { createInboundLead, type InboundLead } from "@/lib/intake";

// POST /api/leads/intake — the inbound lead funnel. The website's lead form
// (and any other external source) POSTs a submission here; the OS creates the
// lead, stores whatever fields were provided, and AI-scores it. Like the
// catalog clipper, this is cross-origin and sessionless, so it authenticates
// with a per-owner intake token (Authorization: Bearer <token>) — NOT the
// session cookie. The proxy matcher excludes /api, so no redirect fires.
// force-dynamic (writes, no caching); permissive CORS so a browser form on the
// marketing site can call it.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

/** CORS preflight. */
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Known fields we map onto the lead; everything else on the payload becomes a
// flexible "extra" intake row so the form can evolve without a code change.
const KNOWN = new Set([
  "name",
  "email",
  "phone",
  "project",
  "scope",
  "description",
  "budget",
  "timeline",
  "address",
  "message",
  "notes",
  "source",
  "token", // never echo a token into intake rows
]);

export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!(await intakeTokenMatches(token))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const str = (v: unknown, max = 400) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const name = str(body.name, 200);
  if (!name) return json({ error: "name is required" }, 400);

  // Any unrecognized string field is preserved as an extra intake row.
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (KNOWN.has(k)) continue;
    const value = str(v);
    if (value) extra[k] = value;
  }

  const lead: InboundLead = {
    name,
    email: str(body.email, 200) || null,
    phone: str(body.phone, 60) || null,
    project: str(body.project ?? body.scope ?? body.description, 400) || null,
    budget: str(body.budget, 120) || null,
    timeline: str(body.timeline, 120) || null,
    address: str(body.address, 200) || null,
    message: str(body.message ?? body.notes, 2000) || null,
    source: str(body.source, 120) || "Website form",
    extra,
  };

  try {
    const { slug, verdict } = await createInboundLead(lead);
    return json({ ok: true, slug, verdict }, 201);
  } catch (err) {
    console.error(`[intake] failed to create lead — ${(err as Error).message}`);
    return json({ error: "could not create lead" }, 500);
  }
}
