import { Shell } from "@/components/shell/Shell";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import { getNotificationsData } from "@/lib/notifications";
import { requireAccess } from "@/lib/dal";
import { listPendingApprovals } from "@/lib/approvals";

export default async function NotificationsPage() {
  // The feed is per-account now: the owner sees the company feed, a team member
  // only what's addressed to them (lib/notifications.ts).
  const user = await requireAccess("today");
  const data = await getNotificationsData(user);
  // Open asks are answered right on their card (owner only).
  const approvals = user.role === "owner" ? await listPendingApprovals({ limit: 40 }).catch(() => []) : [];

  return (
    <Shell breadcrumb="NOTIFICATIONS">
      <NotificationsClient data={data} approvals={approvals} />
    </Shell>
  );
}
