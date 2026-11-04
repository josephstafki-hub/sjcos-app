import { requireAccess } from "@/lib/dal";
import { listVisits } from "@/lib/consult/ui/server";
import { VisitList } from "@/components/consult/field/VisitList";

export const dynamic = "force-dynamic";

/** /consult/ — the canonical list (plan §4, §6.3). Owner sees all; staff only their assigned visits. */
export default async function ConsultListPage() {
  const user = await requireAccess("projects");
  const visits = await listVisits(user);
  return (
    <div className="consult-root min-h-dvh bg-paper text-ink">
      <VisitList visits={visits} owner={user.role === "owner"} />
    </div>
  );
}
