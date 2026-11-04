import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { getLeadsData } from "@/lib/leads";

// GET /api/mobile/leads — leads pipeline for the iOS app (owner only).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "leads")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getLeadsData();
  const { rows } = await query<{ slug: string; email: string | null; phone: string | null; next_due: string | null }>(`SELECT l.slug, l.email, l.phone, (SELECT to_char(min(t.due_date), 'YYYY-MM-DD') FROM lead_tasks t WHERE t.lead_id = l.id AND NOT t.done) AS next_due FROM leads l WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id)`);
  const contacts = new Map(rows.map(r => [r.slug, r]));
  return NextResponse.json({ ...data, leads: data.leads.map(l => ({ ...l, temperatureLabel: ({ hot: "Hot", cooling: "Cooling", declined: "Declined", active: "Active" } as const)[l.temperature], phone: contacts.get(l.slug)?.phone ?? null, email: contacts.get(l.slug)?.email ?? null, nextTaskDue: contacts.get(l.slug)?.next_due ?? null })) });
}
