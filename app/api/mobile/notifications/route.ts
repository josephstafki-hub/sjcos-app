import { mobileRead } from "@/lib/mobile-rpc/reads";
import { getNotificationsData, getUnreadCount } from "@/lib/notifications";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileRead(req, false, async user => {
    const [data, unread] = await Promise.all([getNotificationsData(user), getUnreadCount(user)]);
    return { ...data, unread, notifications: new URL(req.url).searchParams.get("unread") === "1" ? data.notifications.filter(n => !n.read) : data.notifications };
  });
}
