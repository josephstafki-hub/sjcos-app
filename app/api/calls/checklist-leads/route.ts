import { can, getCurrentUser } from "@/lib/dal";
import { searchChecklistLeads } from "@/lib/checklist-lead-search";

// GET /api/calls/checklist-leads?q=&phone= — the checklist's lead picker.
// A route handler, not a server action: server actions on the Calls page run
// one at a time behind the checklist's sync, and the picker must show its first
// page at once (plan §4.2 step 2). Calls access only; read only.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, code: "SIGNED_OUT" }, { status: 401, headers });
  if (!can(user, "comms")) return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403, headers });
  const url = new URL(request.url);
  const leads = await searchChecklistLeads(url.searchParams.get("q") ?? "", url.searchParams.get("phone"));
  return Response.json({ ok: true, leads }, { headers });
}
