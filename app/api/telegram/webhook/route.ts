import { NextResponse } from "next/server";
import { withTransaction, runDirect } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { handleTelegramUpdate, verifyTelegramSecret, type TelegramUpdate } from "@/lib/decisions/telegram";
import { answerCallbackQuery, defaultTransport } from "@/lib/providers/telegram";
import { dispatchIntentsNow } from "@/lib/dispatch/db";

// POST /api/telegram/webhook — Telegram decision buttons (A10).
//
// Setup (owner, one-time; NOT done by code):
//   1. Put a random secret in .env.local as TELEGRAM_WEBHOOK_SECRET.
//   2. Register the webhook with the bot token (the secret becomes the
//      X-Telegram-Bot-Api-Secret-Token header on every update):
//        curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
//          -d url="https://os.sjcarpentryllc.com/api/telegram/webhook" \
//          -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
//          -d allowed_updates='["callback_query"]'
//   3. nginx must pass /api/telegram/webhook through to :3017 (the /api
//      prefix already is). Verify with getWebhookInfo.
//
// Every update is persisted (source_events + telegram_updates) BEFORE it is
// acted on; a repeated update_id is answered but never re-applied. Only a
// callback from TELEGRAM_OWNER_CHAT_ID by the owner principal (resolved from
// the users table) can resolve anything. Always answers 200 so Telegram does
// not retry-storm; the refusal is recorded in the update row.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerPrincipal(): Promise<Principal | null> {
  const rows = await runDirect<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role = 'owner' AND active = true ORDER BY created_at LIMIT 1`);
  const u = rows[0];
  return u ? { kind: "user", userId: u.id, role: "owner", name: u.name, permissions: [] } : null;
}

export async function POST(req: Request) {
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await withTransaction((run) =>
      handleTelegramUpdate(run, update, {
        ownerChatId: (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim(),
        ownerPrincipal,
        answer: (id, text) => answerCallbackQuery(id, text, defaultTransport),
        edit: async (chatId, messageId, text) => {
          await defaultTransport.call("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true }).catch(() => undefined);
        },
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com",
      }),
    );
    // Post-commit: an approval wakes its intents; dispatch them now.
    const woke = result.resolution?.ok && result.resolution.code === "approved" ? result.resolution.intentIds : [];
    if (woke.length) {
      try {
        await dispatchIntentsNow(woke);
      } catch (err) {
        console.error("[telegram] dispatch after approval failed (sweep will retry):", (err as Error).message);
      }
    }
    return NextResponse.json({ ok: true, handled: result.handled, duplicate: result.duplicate, outcome: result.outcome });
  } catch (err) {
    console.error("[telegram] webhook failed:", (err as Error).message);
    // 200 on purpose: Telegram would otherwise redeliver forever; the update
    // is either persisted (and will be inspected) or malformed.
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
