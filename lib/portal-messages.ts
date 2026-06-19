// Portal messaging reader (Review-round-3 S6). Both the client and sub portals
// have a "Message Joe" thread. They persist to the existing chat_messages table
// under a portal channel key, so there is one message store for the whole app:
//   • sub portal    → dm:<sub-slug>     (Joe reads/replies in /chat DMs)
//   • client portal → portal:<slug>     (Joe is notified; reply surface is /chat)
// Writes + the owner notification live in lib/actions/portal.ts.

import { query } from "./db";

export type PortalAuthor = "owner" | "ai" | "user";

export interface PortalMessage {
  id: number;
  author: PortalAuthor;
  name: string;
  initials: string;
  body: string;
  /** Deterministic time label (avoids hydration drift). */
  when: string;
}

/** The channel key for a portal surface + identity slug. */
export function portalChannel(surface: "client" | "sub", slug: string): string {
  return surface === "sub" ? `dm:${slug}` : `portal:${slug}`;
}

/** Recent messages in a portal thread, oldest-first. */
export async function getPortalThread(channelKey: string): Promise<PortalMessage[]> {
  const { rows } = await query<{
    id: number;
    author_kind: PortalAuthor;
    author_name: string;
    author_initials: string;
    body: string;
    when: string;
  }>(
    `SELECT id, author_kind, author_name, author_initials, body,
            to_char(created_at, 'Mon FMDD · HH12:MI AM') AS when
       FROM chat_messages
      WHERE channel_key = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 20`,
    [channelKey],
  );
  return rows
    .map((r) => ({
      id: r.id,
      author: r.author_kind,
      name: r.author_name,
      initials: r.author_initials,
      body: r.body,
      when: r.when,
    }))
    .reverse();
}
