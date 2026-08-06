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
import { storeUpload } from "@/lib/upload-store";

const PREVIEW_SLUG = { client: "henderson", sub: "marco" } as const;

/** Client uploads a photo or document from their portal (Phase-3 5-depth). The
 *  project slug is derived from the session (never trusted from the form); the
 *  file is tagged with the client's slug so only they (and the owner) can view
 *  it. The owner sees it in the project Files tab (project_key = slug). */
export async function uploadClientFile(formData: FormData) {
  const user = await requireRole("owner", "client");
  const slug = user.role === "owner" ? PREVIEW_SLUG.client : user.linkSlug;
  if (!slug) return { ok: false, error: "No project linked to this account." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const stored = await storeUpload(file, {
    idPrefix: "client",
    projectKey: slug,
    tag: "CLIENT UPLOAD",
    subtitle: `Client upload · ${user.name || "client"}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  // Mark the file as the client's so the portal serve route authorizes them.
  await query(`UPDATE files SET client_slug = $1 WHERE id = $2`, [slug, stored.id]);

  if (user.role === "client") {
    await emit({
      kind: "job",
      tag: "Client upload",
      accent: "accent",
      icon: "project",
      title: `${user.name || "Client"} uploaded a file`,
      subline: file.name.slice(0, 90),
      href: `/projects/${slug}`,
    });
  }

  revalidatePath("/client-portal");
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Owner-side composer for the project Comms tab. Posts into the project's
 *  client portal thread (portal:<slug>) so owner ⇄ client talk in one place —
 *  the client sees it on their dashboard. Owner-gated. */
export async function sendProjectMessage(slug: string, formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const user = await requireRole("owner");
  const channelKey = portalChannel("client", slug);

  await query(
    `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
     VALUES ($1, 'owner', $2, $3, $4)`,
    [channelKey, user.name || "Joe", user.initials || "JS", body],
  );

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
}

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
  // clients route to the notification feed. Never for the owner's own posts —
  // Joe messaging a client must not notify Joe about his own message.
  if (authorKind !== "owner") {
    await emit({
      kind: "mention",
      tag: "Portal",
      icon: "chat",
      accent: "ai",
      title: `${name} sent a message`,
      subline: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      href: surface === "sub" ? "/chat" : "/notifications",
    });
  }

  revalidatePath(surface === "sub" ? "/sub-portal" : "/client-portal");
  revalidatePath("/chat");
  revalidatePath("/notifications");
}
