import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";

// POST /api/mobile/projects/[slug]/daily-log — add/update today's field log from
// the phone (owner only). Mirrors lib/actions/projects addProjectDailyLog, but
// reads JSON + Bearer auth instead of a FormData server action.

const LogSchema = z.object({
  body: z.string().min(1, "Log can't be empty."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed;
  try {
    parsed = LogSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { slug } = await params;
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(
    `INSERT INTO daily_logs (project_id, log_date, body)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3)
     ON CONFLICT (project_id, log_date) WHERE project_id IS NOT NULL
     DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
    [proj.id, parsed.data.date ?? null, parsed.data.body],
  );

  return NextResponse.json({ ok: true });
}
