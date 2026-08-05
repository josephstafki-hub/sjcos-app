import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { PanelWindow } from "@/components/panel/PanelWindow";

export const dynamic = "force-dynamic";

/** The operator panel as a standalone window (two-monitor mode). Outside the
 *  (os) group on purpose: no Shell, no dock-in-a-dock — just the panel. */
export default async function PanelPage() {
  const user = await getCurrentUser();
  if (user?.role !== "owner") redirect("/");

  return <PanelWindow />;
}
