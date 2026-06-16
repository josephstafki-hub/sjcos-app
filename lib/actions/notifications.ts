"use server";

// Notification write paths (Phase 7-A CRUD). Reads stay in lib/notifications.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

/** Mark every notification read. */
export async function markAllNotificationsRead() {
  await query(`UPDATE notifications SET read = true WHERE read = false`);
  revalidatePath("/notifications");
}

/** Mark a single notification read. */
export async function markNotificationRead(id: string) {
  await query(`UPDATE notifications SET read = true WHERE id = $1`, [id]);
  revalidatePath("/notifications");
}
