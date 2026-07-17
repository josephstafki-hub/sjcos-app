"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { query } from "@/lib/db";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { askHermes, chatReplyClaude } from "@/lib/dev-agents";
import type { DevAgent } from "@/lib/dev-agents-meta";

/** How each AI teammate signs its chat posts. */
const AGENT_IDENTITY: Record<DevAgent, { name: string; initials: string }> = {
  claude: { name: "Claude", initials: "CL" },
  qwen: { name: "Qwen", initials: "QW" },
  hermes: { name: "Hermes", initials: "HM" },
};

/** Post a message to a channel as the owner, and mark the channel read. */
export async function sendChatMessage(
  channelKey: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("owner");
  const text = body.trim();
  if (!text) return { ok: false, error: "Message is empty." };

  await query(
    `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
     VALUES ($1, 'owner', $2, $3, $4)`,
    [channelKey, user.name || "Joe", user.initials || "JS", text],
  );
  await markRead(channelKey);
  revalidatePath("/chat");
  return { ok: true };
}

/** Generate an AI teammate's reply from recent channel context and post it.
 *  Called after a message that @-mentions an agent. `agent` selects the model:
 *  claude → headless CLI (no tools, ~3s), hermes → local Hermes model, qwen →
 *  Ollama. The client shows a "typing" state while it runs. */
export async function askAgentInChannel(
  channelKey: string,
  agent: DevAgent = "qwen",
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  await requireRole("owner");
  const id = AGENT_IDENTITY[agent] ?? AGENT_IDENTITY.qwen;
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

    await query(
      `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
       VALUES ($1, 'ai', $2, $3, $4)`,
      [channelKey, id.name, id.initials, reply],
    );
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
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

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
  await requireRole("owner");
  if (channelKey.includes(":")) {
    return { ok: false, error: "Only bare channels can be removed." };
  }
  try {
    await query(
      `UPDATE chat_channels SET archived_at = now()
        WHERE key = $1 AND archived_at IS NULL`,
      [channelKey],
    );
    await markRead(channelKey);
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

/** Mark a channel read for the owner (clears its unread badge). */
export async function markChannelRead(channelKey: string): Promise<void> {
  await requireRole("owner");
  await markRead(channelKey);
  revalidatePath("/chat");
}

async function markRead(channelKey: string): Promise<void> {
  await query(
    `INSERT INTO chat_reads (channel_key, last_read_at) VALUES ($1, now())
     ON CONFLICT (channel_key) DO UPDATE SET last_read_at = now()`,
    [channelKey],
  );
}
