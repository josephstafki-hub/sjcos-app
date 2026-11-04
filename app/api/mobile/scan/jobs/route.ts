import { getUserFromRequest } from "@/lib/api-auth";
import { runDirect } from "@/lib/commands/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({error: "Unauthorized"}, {status: 401});
  if (user.role !== "owner" && user.role !== "staff") return Response.json({error: "Forbidden"}, {status: 403});
  try {
    const jobs = await runDirect<{slug: string; name: string; client_name: string | null}>(`SELECT slug, name, client_name FROM projects WHERE status <> 'warranty' ORDER BY updated_at DESC`);
    return Response.json({jobs});
  } catch (error) { console.error("[mobile-scan] jobs failed", error); return Response.json({error: "Something went wrong. Please try again."}, {status: 500}); }
}
