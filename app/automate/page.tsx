import { Shell } from "@/components/shell/Shell";
import { AutomateClient } from "@/components/automate/AutomateClient";
import { requireRole } from "@/lib/dal";

export default async function AutomatePage() {
  // Owner-only: building automations can write files and install cron.
  await requireRole("owner");

  return (
    <Shell breadcrumb="AUTOMATE · BUILDER" hideCmd>
      <AutomateClient />
    </Shell>
  );
}
