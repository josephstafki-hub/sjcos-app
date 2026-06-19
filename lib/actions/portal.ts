"use server";

// Portal write paths (Review-round-3 S6). The client + sub portals let the
// counterparty message Joe. The message persists to chat_messages (one store
// for the app) and emits a notification so Joe sees it. The channel is derived
// server-side from the authenticated identity — never trusted from the form —
// so a portal user can only post into their own thread.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { portalChannel } from "@/lib/portal-messages";
import { emit } from "@/lib/notify";

const PREVIEW_SLUG = { client: "henderson", sub: "marco" } as const;

export async function sendPortalMessage(formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const surfaceInput = String(formData.get("surface") ?? "");
  const surface: "client" | "sub" = surfaceInput === "sub" ? "sub" : "client";

  const user = await requireRole("owner", "client", "sub");

  // Resolve the channel from identity. A real client/sub is pinned to their own
  // linkSlug; an owner previewing falls back to the showcase thread.
  const slug =
    user.role === "owner" ? PREVIEW_SLUG[surface] : user.linkSlug;
  if (!slug) return;
  const channelKey = portalChannel(surface, slug);

  const authorKind = user.role === "owner" ? "owner" : "user";
  const name = user.name || (surface === "sub" ? "Sub" : "Client");

  await query(
    `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [channelKey, authorKind, name, user.initials || "", body],
  );

  // Let Joe know (best-effort). Subs route to /chat (a real DM surface);
  // clients route to the notification feed.
  await emit({
    kind: "mention",
    tag: "Portal",
    icon: "chat",
    accent: "ai",
    title: `${name} sent a message`,
    subline: body.length > 120 ? `${body.slice(0, 117)}…` : body,
    href: surface === "sub" ? "/chat" : "/notifications",
  });

  revalidatePath(surface === "sub" ? "/sub-portal" : "/client-portal");
  revalidatePath("/chat");
  revalidatePath("/notifications");
}
