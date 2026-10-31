// Joe answers a portal message from Telegram (2026-10-31, migration 0062).
//
// A client (or sub) writes in the portal → lib/notify-owner.ts
// notifyPortalMessage pushes the message to Joe's phone and remembers the
// push in telegram_reply_targets (portal_channel_key). When Joe swipes-to-reply
// on it (or on his own earlier reply, or the bot's "Posted" line),
// lib/decisions/telegram.ts calls recordPortalReply here and his words land in
// the portal thread as him. Only an explicit reply ever posts; a loose message
// to the bot never reaches a client.
//
// Kept apart from owner-replies.ts on purpose: only the webhook (website login)
// posts portal messages, and the worker, which imports owner-replies through
// notify-owner, must not.
//
// Pure over run(sql, params) — the webhook calls it inside its transaction.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";

export interface PortalReply {
  /** The chat_messages row Joe's reply became. */
  messageId: string;
  channelKey: string;
  /** Who it went to ("Tom Tierney"), for the acknowledgement. */
  recipient: string;
  /** Owner page for the thread (project / lead Client portal tab, or /chat). */
  href: string;
  /** Project / lead slug behind a client thread, so the caller can refresh it. */
  scope: { kind: "project" | "lead"; slug: string } | null;
}

/** The project / lead behind a client portal channel key (portal:<slug>,
 *  portal:lead:<slug>); null for a sub DM (dm:<slug>). */
export function portalScopeOfChannel(channelKey: string): { kind: "project" | "lead"; slug: string } | null {
  if (!channelKey.startsWith("portal:")) return null;
  const rest = channelKey.slice("portal:".length);
  return rest.startsWith("lead:") ? { kind: "lead", slug: rest.slice("lead:".length) } : { kind: "project", slug: rest };
}

/** Joe replied on Telegram to a portal message push: post his words into that
 *  portal thread as him (the same row the Client portal tab's composer
 *  writes). Joe is typing to the client himself, so this is his send, not an
 *  agent's. A lead thread renamed onto its project on conversion is followed.
 *  Pure over run — the webhook calls it inside its transaction. */
export async function recordPortalReply(
  run: Run,
  input: { channelKey: string; text: string; principal: Principal },
): Promise<PortalReply> {
  let channelKey = input.channelKey;
  let scope = portalScopeOfChannel(channelKey);
  if (scope?.kind === "lead") {
    // The lead became a project after the push went out: its thread moved.
    const [moved] = await run<{ slug: string }>(
      `SELECT p.slug FROM projects p JOIN leads l ON l.id = p.lead_id WHERE l.slug = $1 ORDER BY p.created_at DESC LIMIT 1`,
      [scope.slug],
    );
    if (moved) {
      const [left] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM chat_messages WHERE channel_key = $1`, [channelKey]);
      if (!left?.n) {
        scope = { kind: "project", slug: moved.slug };
        channelKey = `portal:${moved.slug}`;
      }
    }
  }
  const userId = input.principal.kind === "user" ? input.principal.userId : null;
  const [me] = userId ? await run<{ name: string; initials: string }>(`SELECT name, initials FROM users WHERE id = $1`, [userId]) : [];
  const [row] = await run<{ id: string }>(
    `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body, author_user_id)
     VALUES ($1, 'owner', $2, $3, $4, $5) RETURNING id::text AS id`,
    [channelKey, me?.name || "Joe", me?.initials || "JS", input.text, userId],
  );
  // Who it reached: the last person (not Joe) who wrote in this thread.
  const [them] = await run<{ author_name: string }>(
    `SELECT author_name FROM chat_messages WHERE channel_key = $1 AND author_kind = 'user' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [channelKey],
  );
  const recipient = them?.author_name || (scope ? "the client" : "the sub");
  const href = scope ? `${scope.kind === "project" ? "/projects" : "/leads"}/${scope.slug}?tab=${encodeURIComponent("Client portal")}&focus=message-${row.id}` : "/chat";
  if (scope) {
    // The client-activity ledger, same as a portal send (best-effort: the
    // reply itself is what matters).
    await run(
      `INSERT INTO client_activity (lead_id, project_id, kind, summary, detail, entity_kind, entity_id, actor_name, href)
       SELECT ${scope.kind === "lead" ? "id" : "NULL"}, ${scope.kind === "project" ? "id" : "NULL"}, 'message', 'Joe replied in the portal (from Telegram)', $2, 'message', $3, $4, $5
         FROM ${scope.kind === "project" ? "projects" : "leads"} WHERE slug = $1`,
      [scope.slug, input.text.slice(0, 500), row.id, me?.name || "Joe", href],
    );
  }
  return { messageId: row.id, channelKey, recipient, href, scope };
}
