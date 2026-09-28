import { Shell } from "@/components/shell/Shell";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import { getNotificationsData } from "@/lib/notifications";
import { requireAccess } from "@/lib/dal";

export default async function NotificationsPage() {
  // The feed is per-account now: the owner sees the company feed, a team member
  // only what's addressed to them (lib/notifications.ts).
  const data = await getNotificationsData(await requireAccess("today"));

  return (
    <Shell breadcrumb="NOTIFICATIONS">
      <NotificationsClient data={data} />
    </Shell>
  );
}
