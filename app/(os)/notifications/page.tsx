import { Shell } from "@/components/shell/Shell";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import { getNotificationsData } from "@/lib/notifications";
import { requireAccess } from "@/lib/dal";
import { userPrincipal } from "@/lib/commands/db";
import { listPendingApprovals } from "@/lib/approvals";

export default async function NotificationsPage() {
  // The feed is per-account now: the owner sees the company feed, a team member
  // only what's addressed to them (lib/notifications.ts).
  const user = await requireAccess("today");
  const data = await getNotificationsData(user);
  // Show only asks this person can answer; the actions recheck authority.
  const approvals = await listPendingApprovals({ limit: 40, principal: userPrincipal(user) }).catch(() => []);

  return (
    <Shell breadcrumb="NOTIFICATIONS">
      <NotificationsClient data={data} approvals={approvals} />
    </Shell>
  );
}
