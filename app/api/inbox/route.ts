import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/dal";
import { getInboxData } from "@/lib/inbox";

// GET /api/inbox — smart views + channels + thread list + readers, for the
// SIGNED-IN user's mailbox (lib/mailbox.ts). /api/* is outside proxy.ts's
// matcher, so the access check has to happen here: this payload carries real
// mail, and before per-user mailboxes it would answer an anonymous caller with
// whatever GMAIL_REFRESH_TOKEN pointed at.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "inbox")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getInboxData(user);
  return NextResponse.json(data);
}
