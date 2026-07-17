// Portal-delivery outbox (P1-D4). Plain server helpers (NOT "use server" — these
// are called from the already-owner-gated Server Actions in lib/actions/chat.ts).
//
// Team-chat messages posted in entity rooms (room:*) and client DMs
// (dm:client:*) are WIRED for delivery to the sub/client portals, but the actual
// delivery is PARKED: enqueue records the intent in portal_deliveries as
// 'queued', and nothing reaches a real client/sub until the owner clicks Release
// (releaseDelivery) — which copies the source message into the target portal
// thread. No code path auto-invokes releaseDelivery; that manual step IS the
// gate ("portal push" is an outbound send). Sub DMs (dm:<sub-slug>) are already
// the sub-portal thread and self-deliver, so they are never queued here; bare
// channels and team DMs are internal-only and excluded by design.
//
// Resolution snapshots membership at enqueue time; later membership changes don't
// retract queued rows (the owner skips stale ones). Enqueue is best-effort — its
// callers wrap it in try/catch so a delivery hiccup never blocks a chat post.

import { query } from "./db";
import { dmSlug } from "./chat";

export interface PortalTarget {
  recipientType: "sub" | "client";
  recipientLabel: string;
  portalChannel: string;
}

export interface PortalOutboxItem {
  id: number;
  sourceKey: string;
  sourceLabel: string;
  recipientType: "sub" | "client";
  recipientLabel: string;
  portalChannel: string;
  /** Short message preview (source body, truncated). */
  preview: string;
  authorName: string;
  /** Deterministic time label (avoids hydration drift). */
  queuedWhen: string;
}

/** Resolve which portal threads a message in `sourceKey` would be delivered to.
 *  Only entity rooms and client DMs resolve targets; everything else → none. */
export async function resolvePortalTargets(
  sourceKey: string,
): Promise<{ label: string; targets: PortalTarget[] }> {
  if (sourceKey.startsWith("room:")) {
    const room = await query<{ entity_type: string; entity_ref: string; name: string }>(
      `SELECT entity_type, entity_ref, name FROM chat_rooms WHERE key = $1`,
      [sourceKey],
    );
    if (room.rows.length === 0) return { label: "", targets: [] };
    const { entity_type, entity_ref, name } = room.rows[0];
    const targets: PortalTarget[] = [];

    // Subs on the room → each sub's own portal thread (dm:<sub-slug>).
    const subs = await query<{ sub_slug: string; sub_name: string }>(
      `SELECT cm.sub_slug, s.name AS sub_name
         FROM chat_members cm JOIN subs s ON s.slug = cm.sub_slug
        WHERE cm.channel_key = $1
        ORDER BY s.name`,
      [sourceKey],
    );
    for (const s of subs.rows) {
      targets.push({
        recipientType: "sub",
        recipientLabel: `${s.sub_name} · sub portal`,
        portalChannel: `dm:${s.sub_slug}`,
      });
    }

    // Clients on the room → the project's single client-portal thread. Only
    // project/warranty rooms have a portal (both key on the project slug =
    // entity_ref); lead rooms have no client portal. One target regardless of
    // how many client rows — it is one shared "Talk to Joe" thread.
    if (entity_type === "project" || entity_type === "warranty") {
      const clients = await query<{ name: string }>(
        `SELECT name FROM chat_room_clients WHERE room_key = $1 ORDER BY added_at LIMIT 1`,
        [sourceKey],
      );
      if (clients.rows.length > 0) {
        targets.push({
          recipientType: "client",
          recipientLabel: `${clients.rows[0].name} · client portal`,
          portalChannel: `portal:${entity_ref}`,
        });
      }
    }

    return { label: name, targets };
  }

  if (sourceKey.startsWith("dm:client:")) {
    const dm = await query<{ party_slug: string; name: string }>(
      `SELECT party_slug, name FROM chat_dms WHERE key = $1`,
      [sourceKey],
    );
    if (dm.rows.length === 0) return { label: "", targets: [] };
    const { party_slug, name } = dm.rows[0];

    // No clients table: match a project whose homeowner name slugifies to the
    // DM's party_slug. Prefer a project that actually has a client login,
    // newest-first as the tie-break. A lead-only client → no portal → no target.
    const projects = await query<{ slug: string; client_name: string }>(
      `SELECT slug, client_name FROM projects
        WHERE client_name <> '' ORDER BY created_at DESC`,
    );
    const matches = projects.rows.filter((p) => dmSlug(p.client_name) === party_slug);
    if (matches.length === 0) return { label: name, targets: [] };

    const accounts = await query<{ link_slug: string }>(
      `SELECT link_slug FROM users WHERE role = 'client' AND link_slug = ANY($1)`,
      [matches.map((m) => m.slug)],
    );
    const withAccount = new Set(accounts.rows.map((a) => a.link_slug));
    const chosen = matches.find((m) => withAccount.has(m.slug)) ?? matches[0];

    return {
      label: name,
      targets: [
        {
          recipientType: "client",
          recipientLabel: `${name} · client portal`,
          portalChannel: `portal:${chosen.slug}`,
        },
      ],
    };
  }

  return { label: "", targets: [] };
}

/** Queue portal deliveries for a freshly-posted message. No-op unless the source
 *  is an entity room or a client DM. Idempotent via UNIQUE(message_id,
 *  portal_channel). Returns the newly-queued rows so the caller can update the
 *  client without a refetch. */
export async function enqueuePortalDeliveries(
  messageId: number,
  sourceKey: string,
): Promise<PortalOutboxItem[]> {
  if (!sourceKey.startsWith("room:") && !sourceKey.startsWith("dm:client:")) return [];
  const { label, targets } = await resolvePortalTargets(sourceKey);
  if (targets.length === 0) return [];

  const inserted: PortalOutboxItem[] = [];
  for (const t of targets) {
    const res = await query<{ id: number; queued_when: string; preview: string; author_name: string }>(
      `WITH ins AS (
         INSERT INTO portal_deliveries
           (message_id, source_key, source_label, recipient_type, recipient_label, portal_channel)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (message_id, portal_channel) DO NOTHING
         RETURNING id, queued_at
       )
       SELECT ins.id,
              to_char(ins.queued_at, 'Mon FMDD · HH12:MI AM') AS queued_when,
              left(m.body, 90) AS preview,
              m.author_name
         FROM ins JOIN chat_messages m ON m.id = $1`,
      [messageId, sourceKey, label, t.recipientType, t.recipientLabel, t.portalChannel],
    );
    if (res.rows.length > 0) {
      const r = res.rows[0];
      inserted.push({
        id: r.id,
        sourceKey,
        sourceLabel: label,
        recipientType: t.recipientType,
        recipientLabel: t.recipientLabel,
        portalChannel: t.portalChannel,
        preview: r.preview,
        authorName: r.author_name,
        queuedWhen: r.queued_when,
      });
    }
  }
  return inserted;
}

/** The owner's review list — every delivery still awaiting a Release/Skip. */
export async function listQueuedDeliveries(): Promise<PortalOutboxItem[]> {
  const { rows } = await query<{
    id: number;
    source_key: string;
    source_label: string;
    recipient_type: "sub" | "client";
    recipient_label: string;
    portal_channel: string;
    preview: string;
    author_name: string;
    queued_when: string;
  }>(
    `SELECT d.id, d.source_key, d.source_label, d.recipient_type, d.recipient_label,
            d.portal_channel, left(m.body, 90) AS preview, m.author_name,
            to_char(d.queued_at, 'Mon FMDD · HH12:MI AM') AS queued_when
       FROM portal_deliveries d JOIN chat_messages m ON m.id = d.message_id
      WHERE d.status = 'queued'
      ORDER BY d.queued_at DESC
      LIMIT 50`,
  );
  return rows.map((r) => ({
    id: r.id,
    sourceKey: r.source_key,
    sourceLabel: r.source_label,
    recipientType: r.recipient_type,
    recipientLabel: r.recipient_label,
    portalChannel: r.portal_channel,
    preview: r.preview,
    authorName: r.author_name,
    queuedWhen: r.queued_when,
  }));
}

/** RELEASE — the gated outbound. Copies the source message into the target
 *  portal thread (where the real client/sub reads it) and marks the delivery
 *  released. Single-statement (atomic): the copy only inserts if the guarded
 *  queued→released transition wins, so a double-click / release-after-skip is a
 *  clean no-op. Room messages get a `[<room>] ` prefix so a message landing in
 *  the "Talk to Joe" thread carries its context; client-DM messages were already
 *  addressed to that client, so no prefix. The released copy is author-preserving
 *  (owner or ai) and will honestly light the owner's own unread badge for that
 *  thread — we deliberately do NOT touch chat_reads (that would swallow genuine
 *  unread portal replies). This is the ONLY code that pushes to a portal, and it
 *  runs solely from the owner-clicked releasePortalDelivery action. */
export async function releaseDelivery(id: number): Promise<{ released: boolean }> {
  const res = await query(
    `WITH released AS (
       UPDATE portal_deliveries
          SET status = 'released', released_at = now()
        WHERE id = $1 AND status = 'queued'
        RETURNING message_id, source_key, source_label, portal_channel
     )
     INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
     SELECT r.portal_channel, m.author_kind, m.author_name, m.author_initials,
            CASE WHEN r.source_key LIKE 'room:%'
                 THEN '[' || r.source_label || '] ' || m.body
                 ELSE m.body END
       FROM released r JOIN chat_messages m ON m.id = r.message_id
     RETURNING id`,
    [id],
  );
  return { released: (res.rowCount ?? 0) === 1 };
}

/** SKIP — drop a queued delivery without sending it. Kept as a 'skipped' audit
 *  row, never delivered. Guarded so a double-click is a no-op. */
export async function skipDelivery(id: number): Promise<{ skipped: boolean }> {
  const res = await query(
    `UPDATE portal_deliveries SET status = 'skipped'
      WHERE id = $1 AND status = 'queued'`,
    [id],
  );
  return { skipped: (res.rowCount ?? 0) === 1 };
}
