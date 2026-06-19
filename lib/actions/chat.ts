"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { query } from "@/lib/db";
import { ai } from "@/lib/ai";

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

/** Generate Claude's reply from recent channel context and post it. Called
 *  after a message that @-mentions claude. Slow (CPU Qwen), so the client
 *  shows a "Claude is typing" state while it runs. */
export async function askClaudeInChannel(
  channelKey: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  await requireRole("owner");
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
    const { suggestions } = await ai.suggest({
      kind: "chat-reply",
      context:
        `You are Claude, a teammate in the "${channelKey}" channel of a ` +
        `remodeling company's chat. Reply to the latest message helpfully and ` +
        `concisely (1-3 sentences). Use only what's in the transcript.\n\n${transcript}`,
    });
    const reply = suggestions.join(" ").trim() || "On it — I'll follow up shortly.";
    await query(
      `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
       VALUES ($1, 'ai', 'Claude', 'CL', $2)`,
      [channelKey, reply],
    );
    revalidatePath("/chat");
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
