"use server";

import { revalidatePath } from "next/cache";
import { requireAccess, requireRole, type CurrentUser } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { askHermes, chatReplyClaude } from "@/lib/dev-agents";
import type { DevAgent } from "@/lib/dev-agents-meta";
import {
  initialsOf,
  internalDmKey,
  teamDmParties,
  dmTeamKey,
  type TeamMember,
  type ClientMember,
} from "@/lib/chat";
import {
  enqueuePortalDeliveries,
  releaseDelivery,
  skipDelivery,
  type PortalOutboxItem,
} from "@/lib/portal-delivery";

/** How each AI teammate signs its chat posts. */
const AGENT_IDENTITY: Record<DevAgent, { name: string; initials: string }> = {
  claude: { name: "Claude", initials: "CL" },
  qwen: { name: "Qwen", initials: "QW" },
  hermes: { name: "Hermes", initials: "HM" },
};

// ─── Who may act where ───────────────────────────────────────────────────────
// Channel keys arrive from the client, so lib/chat.ts filtering the rail is not
// enough on its own: posting and AI-asking re-check here. Mirrors the read rules
// documented at the top of lib/chat.ts.

/** This account's team_members slug (their DM identity), or null. */
async function teamSlugOf(userId: string): Promise<string | null> {
  const row = await queryOne<{ slug: string }>(
    `SELECT slug FROM team_members WHERE user_id = $1 AND active`,
    [userId],
  );
  return row?.slug ?? null;
}

/** The owner's team_members slug — needed to read a single-slug team DM key. */
async function ownerTeamSlug(): Promise<string | null> {
  const row = await queryOne<{ slug: string }>(
    `SELECT t.slug FROM team_members t JOIN users u ON u.id = t.user_id
      WHERE u.role = 'owner' AND t.active ORDER BY u.created_at LIMIT 1`,
  );
  return row?.slug ?? null;
}

/** May this person post in / read this channel?
 *
 *  Owner: anywhere. Staff: every bare channel, a room they've been added to, and
 *  an internal DM they're a party to. Never a sub or client DM — those are the
 *  outward-facing threads. */
async function mayOpenChannel(user: CurrentUser, channelKey: string): Promise<boolean> {
  if (user.role === "owner") return true;
  if (!channelKey.includes(":")) return true; // bare channel — company-wide
  const slug = await teamSlugOf(user.id);
  if (!slug) return false;
  if (channelKey.startsWith("room:")) {
    const row = await queryOne<{ one: number }>(
      `SELECT 1 AS one FROM chat_team_members WHERE channel_key = $1 AND member_slug = $2`,
      [channelKey, slug],
    );
    return Boolean(row);
  }
  if (channelKey.startsWith("dm:team:")) {
    return teamDmParties(channelKey, await ownerTeamSlug()).includes(slug);
  }
  return false;
}

/** Make sure an internal DM exists as a row, named for the OTHER person, so it
 *  lists on both rails. Idempotent. */
async function ensureDmRecorded(channelKey: string, sender: CurrentUser): Promise<void> {
  if (!channelKey.startsWith("dm:team:")) return;
  const mySlug = await teamSlugOf(sender.id);
  const parties = teamDmParties(channelKey, await ownerTeamSlug());
  const otherSlug = parties.find((p) => p !== mySlug) ?? parties[0];
  if (!otherSlug) return;
  const other = await queryOne<{ name: string; role_label: string }>(
    `SELECT name, role_label FROM team_members WHERE slug = $1`,
    [otherSlug],
  );
  await query(
    `INSERT INTO chat_dms (key, party_type, party_slug, name, subtitle)
     VALUES ($1, 'team', $2, $3, $4)
     ON CONFLICT (key) DO NOTHING`,
    [channelKey, otherSlug, other?.name ?? otherSlug, other?.role_label || "Team"],
  );
}

/** Tell the other party about a DM. A DM has no rail to watch, so without this a
 *  message to a team member sits unseen until they happen to open /chat. */
async function notifyDmRecipient(channelKey: string, sender: CurrentUser, text: string): Promise<void> {
  if (!channelKey.startsWith("dm:team:")) return;
  const parties = teamDmParties(channelKey, await ownerTeamSlug());
  const mySlug = await teamSlugOf(sender.id);
  const otherSlug = parties.find((p) => p !== mySlug);
  if (!otherSlug) return;
  const other = await queryOne<{ user_id: string | null }>(
    `SELECT user_id FROM team_members WHERE slug = $1 AND active`,
    [otherSlug],
  );
  if (!other?.user_id || other.user_id === sender.id) return;
  await emit({
    kind: "mention",
    tag: "Message",
    accent: "accent",
    icon: "chat",
    title: `${sender.name} messaged you`,
    subline: text.slice(0, 90),
    href: "/chat",
    audienceUserId: other.user_id,
  });
}

/** Post a message to a channel as the signed-in person, and mark it read for
 *  them. Refuses a channel they can't open — the key comes from the client. */
export async function sendChatMessage(
  channelKey: string,
  body: string,
): Promise<{ ok: boolean; queued?: PortalOutboxItem[]; error?: string }> {
  const user = await requireAccess("chat");
  const text = body.trim();
  if (!text) return { ok: false, error: "Message is empty." };
  if (!(await mayOpenChannel(user, channelKey))) {
    return { ok: false, error: "You're not in that conversation." };
  }

  const { rows } = await query<{ id: number }>(
    `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body, author_user_id)
     VALUES ($1, $5, $2, $3, $4, $6)
     RETURNING id`,
    // A staff post is a teammate's ('user'), so it counts toward Joe's unread.
    [channelKey, user.name || "Joe", user.initials || "JS", text, user.role === "owner" ? "owner" : "user", user.id],
  );
  await markRead(channelKey, user.id);
  // Persist the conversation the first time someone speaks in it. A staff
  // member's rail can offer a DM with Joe before any row exists (lib/chat.ts
  // seeds it so their rail isn't empty), and without this the message would
  // land in chat_messages with nothing in chat_dms — leaving it invisible on
  // Joe's side, which is exactly how it failed the first time through.
  await ensureDmRecorded(channelKey, user);
  // A DM has exactly one other party and no rail to watch, so tell them. Only
  // internal DMs: sub/client DMs go out through the gated portal outbox, and
  // there is no internal account on the far end to notify.
  await notifyDmRecipient(channelKey, user, text);
  // Wire portal delivery for room/client-DM messages — PARKED (queued only,
  // never auto-sent). Best-effort: a delivery hiccup must not fail the post.
  let queued: PortalOutboxItem[] = [];
  try {
    queued = await enqueuePortalDeliveries(rows[0].id, channelKey);
  } catch {
    /* delivery is best-effort; the message is posted regardless */
  }
  revalidatePath("/chat");
  return { ok: true, queued };
}

/** Generate an AI teammate's reply from recent channel context and post it.
 *  Called after a message that @-mentions an agent. `agent` selects the model:
 *  claude → headless CLI (no tools, ~3s), hermes → local Hermes model, qwen →
 *  Ollama. The client shows a "typing" state while it runs. */
export async function askAgentInChannel(
  channelKey: string,
  agent: DevAgent = "qwen",
): Promise<{ ok: boolean; reply?: string; queued?: PortalOutboxItem[]; error?: string }> {
  const user = await requireAccess("chat");
  if (!(await mayOpenChannel(user, channelKey))) {
    return { ok: false, error: "You're not in that conversation." };
  }
  const id = AGENT_IDENTITY[agent] ?? AGENT_IDENTITY.qwen;
  // A bare sub DM (dm:<slug>) IS the sub's live portal thread — an AI reply here
  // would push unreviewed machine-generated content straight to a real sub with
  // no Release step (P1-D4's gate). Refuse it. Joe's own typed messages still
  // flow (his explicit act on the direct-messaging surface); the AI stays out.
  // Team/client DMs (dm:team:/dm:client:) are internal or outbox-gated, so they
  // are unaffected.
  if (
    channelKey.startsWith("dm:") &&
    !channelKey.startsWith("dm:team:") &&
    !channelKey.startsWith("dm:client:")
  ) {
    return {
      ok: false,
      error: `${id.name} can't reply in a sub DM — it's the sub's live portal thread.`,
    };
  }
  // AI membership is independent per bare channel (P1-D1): a model only responds
  // if it's been added. Rooms and DMs keep AI implicit, so they skip the gate.
  if (!channelKey.includes(":")) {
    const { rows } = await query<{ one: number }>(
      `SELECT 1 AS one FROM chat_ai_members WHERE channel_key = $1 AND agent = $2`,
      [channelKey, agent],
    );
    if (rows.length === 0) {
      return {
        ok: false,
        error: `${id.name} isn't in this channel — add them from the participants menu.`,
      };
    }
  }
  try {
    const { rows } = await query<{ author_name: string; body: string }>(
      `SELECT author_name, body FROM chat_messages
       WHERE channel_key = $1 ORDER BY created_at DESC LIMIT 8`,
      [channelKey],
    );
    const transcript = rows
      .reverse()
      .map((r) => `${r.author_name}: ${r.body}`)
      .join("\n");
    const brief =
      `You are ${id.name}, a teammate in the "${channelKey}" channel of a ` +
      `remodeling company's chat. Reply to the latest message helpfully and ` +
      `concisely (1-3 sentences). Use only what's in the transcript.\n\n${transcript}`;

    let reply: string;
    if (agent === "claude") {
      reply = (await chatReplyClaude(brief)).trim();
    } else if (agent === "hermes") {
      reply = (await askHermes(brief, undefined, `chat-${channelKey}`)).trim();
    } else {
      const { suggestions } = await ai.suggest({ kind: "chat-reply", context: brief });
      reply = suggestions.join(" ").trim();
    }
    if (!reply) reply = "On it — I'll follow up shortly.";

    const { rows: aiRows } = await query<{ id: number }>(
      `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
       VALUES ($1, 'ai', $2, $3, $4)
       RETURNING id`,
      [channelKey, id.name, id.initials, reply],
    );
    // AI replies in a room / client DM are "communications here" too — queue them
    // for portal delivery, PARKED (never auto-sent). Best-effort.
    let queued: PortalOutboxItem[] = [];
    try {
      queued = await enqueuePortalDeliveries(aiRows[0].id, channelKey);
    } catch {
      /* delivery is best-effort */
    }
    await emit({
      kind: "mention",
      tag: "Mention",
      accent: "ai",
      icon: "chat",
      title: `${id.name} replied in ${channelKey.startsWith("dm:") ? "a direct message" : `#${channelKey}`}`,
      subline: reply.slice(0, 90),
      href: "/chat",
    });
    revalidatePath("/chat");
    revalidatePath("/notifications");
    return { ok: true, reply, queued };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Managing the place (owner only) ────────────────────────────────────────
// Everything from here to the DM section is a company decision, not a chat
// action: who is in a channel, which channels exist, which AI models answer,
// which clients are in a room, and whether a parked portal message actually
// goes out. Holding the Team chat area lets a staff member talk; it does not let
// them re-wire the workspace or release something to a client. Hence
// requireRole("owner") rather than requireAccess("chat").

/** Add a sub to a channel's membership. No-op-safe (idempotent). */
export async function addChannelMember(
  channelKey: string,
  subSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (channelKey.startsWith("dm:")) return { ok: false, error: "DMs have no members." };
  try {
    await query(
      `INSERT INTO chat_members (channel_key, sub_slug) VALUES ($1, $2)
       ON CONFLICT (channel_key, sub_slug) DO NOTHING`,
      [channelKey, subSlug],
    );
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove a sub from a channel's membership. */
export async function removeChannelMember(
  channelKey: string,
  subSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await query(
      `DELETE FROM chat_members WHERE channel_key = $1 AND sub_slug = $2`,
      [channelKey, subSlug],
    );
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Channel create / remove (P1-D1) ────────────────────────────────────────

const AI_AGENTS: DevAgent[] = ["claude", "qwen", "hermes"];

/** Slugify a channel name into a key: lowercase, non-alphanumerics → hyphens.
 *  Strips `:` so a name can never collide with the room:/dm: key namespaces. */
function channelKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Create a bare channel. Recreating an archived channel's name un-archives it
 *  (restoring its transcript). Rejects empty/duplicate names. */
export async function createChannel(
  name: string,
): Promise<{ ok: boolean; channel?: { key: string; name: string; description: string }; error?: string }> {
  await requireRole("owner");
  const clean = name.trim();
  const key = channelKeyFromName(clean);
  if (!key) return { ok: false, error: "Enter a channel name." };
  try {
    const existing = await query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM chat_channels WHERE key = $1`,
      [key],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].archived_at === null) {
        return { ok: false, error: "A channel with that name already exists." };
      }
      // Archived → restore it (transcript comes back with it).
      await query(
        `UPDATE chat_channels SET archived_at = NULL, name = $2 WHERE key = $1`,
        [key, key],
      );
    } else {
      await query(
        `INSERT INTO chat_channels (key, name, sort_order)
         VALUES ($1, $1, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM chat_channels))`,
        [key],
      );
    }
    revalidatePath("/chat");
    return { ok: true, channel: { key, name: `# ${key}`, description: "" } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove a bare channel — soft archive so the transcript survives. Also clears
 *  its read marker so a stale message can't keep lighting the nav badge. */
export async function archiveChannel(
  channelKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireRole("owner");
  if (channelKey.includes(":")) {
    return { ok: false, error: "Only bare channels can be removed." };
  }
  try {
    await query(
      `UPDATE chat_channels SET archived_at = now()
        WHERE key = $1 AND archived_at IS NULL`,
      [channelKey],
    );
    await markRead(channelKey, owner.id);
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Add an AI model to a bare channel's membership. Idempotent. */
export async function addChannelAgent(
  channelKey: string,
  agent: DevAgent,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (channelKey.includes(":")) return { ok: false, error: "AI is implicit here." };
  if (!AI_AGENTS.includes(agent)) return { ok: false, error: "Unknown model." };
  try {
    await query(
      `INSERT INTO chat_ai_members (channel_key, agent) VALUES ($1, $2)
       ON CONFLICT (channel_key, agent) DO NOTHING`,
      [channelKey, agent],
    );
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove an AI model from a bare channel's membership. */
export async function removeChannelAgent(
  channelKey: string,
  agent: DevAgent,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await query(
      `DELETE FROM chat_ai_members WHERE channel_key = $1 AND agent = $2`,
      [channelKey, agent],
    );
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Team-member roster + membership (P1-D1) ────────────────────────────────

/** Add a team member to a channel's membership. No-op-safe (idempotent). */
export async function addChannelTeamMember(
  channelKey: string,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (channelKey.startsWith("dm:")) return { ok: false, error: "DMs have no members." };
  try {
    await query(
      `INSERT INTO chat_team_members (channel_key, member_slug) VALUES ($1, $2)
       ON CONFLICT (channel_key, member_slug) DO NOTHING`,
      [channelKey, slug],
    );
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove a team member from a channel's membership. */
export async function removeChannelTeamMember(
  channelKey: string,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await query(
      `DELETE FROM chat_team_members WHERE channel_key = $1 AND member_slug = $2`,
      [channelKey, slug],
    );
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Create a team member (the roster starts empty — the owner builds it inline
 *  from the participants menu). Recreating a deactivated slug reactivates it.
 *  If `channelKey` is given (and isn't a DM), also add them to that channel in
 *  the same round trip — the create-and-add flow. Returns the full member so the
 *  client can update state without a refetch. */
export async function createTeamMember(
  name: string,
  roleLabel: string = "",
  channelKey?: string,
): Promise<{ ok: boolean; member?: TeamMember; error?: string }> {
  await requireRole("owner");
  const cleanName = name.trim();
  const cleanRole = roleLabel.trim();
  const slug = channelKeyFromName(cleanName);
  if (!slug) return { ok: false, error: "Enter a name." };
  try {
    const existing = await query<{ active: boolean }>(
      `SELECT active FROM team_members WHERE slug = $1`,
      [slug],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].active) {
        return { ok: false, error: "A teammate with that name already exists." };
      }
      // Deactivated → reactivate with the latest name/role.
      await query(
        `UPDATE team_members SET active = true, name = $2, role_label = $3 WHERE slug = $1`,
        [slug, cleanName, cleanRole],
      );
    } else {
      await query(
        `INSERT INTO team_members (slug, name, role_label) VALUES ($1, $2, $3)`,
        [slug, cleanName, cleanRole],
      );
    }
    if (channelKey && !channelKey.startsWith("dm:")) {
      await query(
        `INSERT INTO chat_team_members (channel_key, member_slug) VALUES ($1, $2)
         ON CONFLICT (channel_key, member_slug) DO NOTHING`,
        [channelKey, slug],
      );
    }
    revalidatePath("/chat");
    return {
      ok: true,
      member: { slug, name: cleanName, initials: initialsOf(cleanName), roleLabel: cleanRole },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Add a client to an entity room, manually (P1-D2 — "clients can be added but
 *  manually only"). Create-only, room-scoped: there's no clients table to pick
 *  from, so the owner types the name (and optional email). Recording a duplicate
 *  name updates the email instead of erroring. This records membership ONLY —
 *  there is deliberately NO outward delivery here (portal delivery is gated,
 *  P1-D4). Returns the full row so the client updates without a refetch. */
export async function addClientToRoom(
  roomKey: string,
  name: string,
  email: string = "",
): Promise<{ ok: boolean; client?: ClientMember; error?: string }> {
  await requireRole("owner");
  if (!roomKey.startsWith("room:")) {
    return { ok: false, error: "Clients can only be added to an entity room." };
  }
  const cleanName = name.trim();
  const cleanEmail = email.trim();
  if (!cleanName) return { ok: false, error: "Enter a client name." };
  try {
    const open = await query(
      `SELECT 1 FROM chat_rooms WHERE key = $1 AND closed_at IS NULL`,
      [roomKey],
    );
    if (open.rows.length === 0) {
      return { ok: false, error: "That room is closed or no longer exists." };
    }
    const res = await query<{ id: number }>(
      `INSERT INTO chat_room_clients (room_key, name, email) VALUES ($1, $2, $3)
       ON CONFLICT (room_key, name) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [roomKey, cleanName, cleanEmail],
    );
    revalidatePath("/chat");
    return {
      ok: true,
      client: {
        id: res.rows[0].id,
        name: cleanName,
        email: cleanEmail,
        initials: initialsOf(cleanName),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove a manually-added client from an entity room. */
export async function removeClientFromRoom(
  roomKey: string,
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await query(`DELETE FROM chat_room_clients WHERE room_key = $1 AND id = $2`, [roomKey, id]);
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Direct messages (P1-D3) ────────────────────────────────────────────────

const DM_PARTY_TYPES = ["sub", "team", "client"] as const;
type DmPartyType = (typeof DM_PARTY_TYPES)[number];

/** Open (or re-open) a direct message after the person-lookup picks someone.
 *  Persists the DM in chat_dms so it survives reload before its first message,
 *  and denormalizes the display name/subtitle (a client DM has no backing table
 *  to re-resolve from). Idempotent: reopening an existing DM is a clean no-op.
 *  This records the conversation ONLY — there is NO outward delivery here
 *  (portal delivery of chat is the separate gated item, P1-D4). Returns the DM
 *  so the client seeds the rail + view without a refetch. */
export async function openDirectMessage(
  partyType: DmPartyType,
  slug: string,
  displayName: string,
  subtitle: string = "",
): Promise<{
  ok: boolean;
  dm?: { key: string; fullName: string; initials: string; subtitle: string };
  error?: string;
}> {
  const user = await requireAccess("chat");
  if (!DM_PARTY_TYPES.includes(partyType)) return { ok: false, error: "Unknown person type." };
  // Sub and client DMs are outward-facing: `dm:<sub>` IS that sub's live portal
  // thread and a client DM delivers through the gated outbox. Staff open team
  // DMs only.
  if (partyType !== "team" && user.role !== "owner") {
    return { ok: false, error: "Only Joe can open a DM with a sub or client." };
  }
  const cleanName = displayName.trim();
  if (!cleanName) return { ok: false, error: "Enter a name." };
  const cleanSlug = channelKeyFromName(slug || cleanName);
  if (!cleanSlug) return { ok: false, error: "Enter a name." };
  const cleanSubtitle = subtitle.trim() || (partyType === "client" ? "Client" : "Team");

  try {
    // Guard against orphan keys from a stale roster: subs/team must exist.
    if (partyType === "sub") {
      const { rows } = await query(`SELECT 1 FROM subs WHERE slug = $1`, [cleanSlug]);
      if (rows.length === 0) return { ok: false, error: "That sub no longer exists." };
    } else if (partyType === "team") {
      const { rows } = await query(
        `SELECT 1 FROM team_members WHERE slug = $1 AND active`,
        [cleanSlug],
      );
      if (rows.length === 0) return { ok: false, error: "That teammate no longer exists." };
    }

    const key = await teamDmKeyFor(user, partyType, cleanSlug);
    if (!key) {
      return { ok: false, error: "You don't have a chat identity yet — ask Joe to set one up." };
    }

    await query(
      `INSERT INTO chat_dms (key, party_type, party_slug, name, subtitle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING`,
      [key, partyType, cleanSlug, cleanName, cleanSubtitle],
    );
    revalidatePath("/chat");
    return {
      ok: true,
      dm: { key, fullName: cleanName, initials: initialsOf(cleanName), subtitle: cleanSubtitle },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** The channel key for a DM the CALLER is opening.
 *
 *  Owner↔person keeps the original `dm:team:<their-slug>` form so existing
 *  transcripts stay addressable. Two staff members get the sorted pair key from
 *  internalDmKey(), so whoever opens it first, both land on the same
 *  conversation. Returns null when a staff caller has no roster identity to be
 *  the other end of it. */
async function teamDmKeyFor(
  user: CurrentUser,
  partyType: DmPartyType,
  targetSlug: string,
): Promise<string | null> {
  if (partyType === "sub") return `dm:${targetSlug}`;
  if (partyType === "client") return `dm:client:${targetSlug}`;
  if (user.role === "owner") return dmTeamKey(targetSlug);
  const mySlug = await teamSlugOf(user.id);
  if (!mySlug) return null;
  if (mySlug === targetSlug) return null; // no DM with yourself
  const ownerSlug = await ownerTeamSlug();
  return internalDmKey(
    { slug: mySlug, isOwner: false },
    { slug: targetSlug, isOwner: targetSlug === ownerSlug },
  );
}

// ─── Portal-delivery outbox (P1-D4) ─────────────────────────────────────────

/** RELEASE a queued portal delivery — the gated outbound. This is the ONLY path
 *  that pushes a team-chat message to a real client/sub portal, and it runs only
 *  when the owner clicks Release. Nothing auto-invokes it. */
export async function releasePortalDelivery(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await releaseDelivery(id);
    revalidatePath("/chat");
    revalidatePath("/client-portal");
    revalidatePath("/sub-portal");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** SKIP a queued portal delivery — drop it without ever sending. */
export async function skipPortalDelivery(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await skipDelivery(id);
    revalidatePath("/chat");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Mark a channel read FOR ME (clears my unread badge, nobody else's). */
export async function markChannelRead(channelKey: string): Promise<void> {
  const user = await requireAccess("chat");
  await markRead(channelKey, user.id);
  revalidatePath("/chat");
}

async function markRead(channelKey: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO chat_reads_by_user (channel_key, user_id, last_read_at) VALUES ($1, $2, now())
     ON CONFLICT (channel_key, user_id) DO UPDATE SET last_read_at = now()`,
    [channelKey, userId],
  );
}
