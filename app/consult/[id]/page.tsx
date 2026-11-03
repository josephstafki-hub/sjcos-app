import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/dal";
import { bootFor, visitHead } from "@/lib/consult/ui/server";
import { ConsultApp } from "@/components/consult/field/ConsultApp";

export const dynamic = "force-dynamic";

/**
 * /consult/[id] — the field app (plan §6.3/§6.4). requireAccess("projects") plus
 * assignment: only the assigned visitor captures. Joe opening a visit someone else
 * is assigned to lands on the optional look-over page instead.
 */
export default async function ConsultVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("projects");
  const { id } = await params;
  const head = await visitHead(id.toLowerCase(), user);
  if (!head) notFound();
  if (!head.assigned) {
    if (user.role === "owner") redirect(`/projects/${head.slug}/consult/${head.id}`);
    notFound();
  }
  const boot = await bootFor(user, head);
  return <ConsultApp boot={boot} consultId={head.id} />;
}
