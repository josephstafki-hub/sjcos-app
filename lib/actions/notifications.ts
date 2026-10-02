"use server";

// Notification write paths (Phase 7-A CRUD). Reads stay in lib/notifications.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireAccess } from "@/lib/dal";

/** Mark every notification in MY feed read. Writes notification_reads rows
 *  rather than the old global `read` flag — clearing the bell is a personal act,
 *  and the flag made it everyone's. Scoped to what this account can see, so a
 *  staff member clearing their feed can't touch the owner's. */
export async function markAllNotificationsRead() {
  const user = await requireAccess("today");
  await query(
    `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1 FROM notifications n
        WHERE ${user.role === "owner" ? "(n.audience_user_id IS NULL OR n.audience_user_id = $1)" : "n.audience_user_id = $1"}
     ON CONFLICT DO NOTHING`,
    [user.id],
  );
  revalidatePath("/notifications");
}

/** Mark a single notification read — for me, and only if it's in my feed. */
export async function markNotificationRead(id: string) {
  const user = await requireAccess("today");
  await query(
    `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $2 FROM notifications n
        WHERE n.id = $1
          AND ${user.role === "owner" ? "(n.audience_user_id IS NULL OR n.audience_user_id = $2)" : "n.audience_user_id = $2"}
     ON CONFLICT DO NOTHING`,
    [id, user.id],
  );
  revalidatePath("/notifications");
}
