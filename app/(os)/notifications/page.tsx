import { Shell } from "@/components/shell/Shell";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import { getNotificationsData } from "@/lib/notifications";

export default async function NotificationsPage() {
  const data = await getNotificationsData();

  return (
    <Shell breadcrumb="NOTIFICATIONS">
      <NotificationsClient data={data} />
    </Shell>
  );
}
