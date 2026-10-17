import { NextResponse } from "next/server";
import { withTransaction, runDirect } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { handleTelegramUpdate, verifyTelegramSecret, type TelegramUpdate } from "@/lib/decisions/telegram";
import { answerCallbackQuery, defaultTransport } from "@/lib/providers/telegram";
import { performApprovalEffects } from "@/lib/decisions/after-approval";
import { cardText } from "@/lib/decisions/cards";
import { approveWorkItemById, rejectWorkItemById } from "@/lib/approve-work-item";
import { describeApproval } from "@/lib/approved-draft-rules";

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

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}
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
    const answer = (id: string, text: string) => answerCallbackQuery(id, text.slice(0, 190), defaultTransport);
    const edit = async (chatId: string, messageId: number, text: string) => {
      await defaultTransport.call("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true }).catch(() => undefined);
    };
    const result = await withTransaction((run) =>
      handleTelegramUpdate(run, update, {
        ownerChatId: (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim(),
        ownerPrincipal,
        answer,
        edit,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com",
        deferApproveAnswer: true,
      }),
    );

    // Post-commit: an approval must DO the thing — dispatch the sends it
    // woke, email a first-draw invoice, perform a permission request's
    // staged send — and the phone is told what actually happened.
    const res = result.resolution;
    if (res?.ok && res.code === "approved" && res.decision) {
      const lines = await performApprovalEffects(res);
      const p = result.pendingAnswer;
      if (p) {
        await answer(p.callbackId, [res.reply, ...lines].join(" "));
        if (p.messageId != null) await edit(p.chatId, p.messageId, [cardText(res.decision, { appUrl: appUrl() }), ...lines].join("\n"));
      }
      if (lines.length) {
        await runDirect(`UPDATE telegram_updates SET outcome = $2 WHERE update_id = $1`, [update.update_id, [res.reply, ...lines].join(" ").slice(0, 300)]).catch(() => undefined);
      }
    } else if (result.pendingAnswer) {
      await answer(result.pendingAnswer.callbackId, res?.reply ?? "Done.");
    }

    // A work-item approval card (a staged draft): approve sends the draft
    // exactly as the app's Approve button does.
    if (result.workItem) {
      const w = result.workItem;
      let reply: string;
      if (w.verb === "approve") {
        const r = await approveWorkItemById(w.id);
        const d = describeApproval(r);
        reply = r.ok ? d.message : r.error;
      } else {
        const r = await rejectWorkItemById(w.id, "Telegram");
        reply = r.ok ? `Declined: ${r.title}` : r.error;
      }
      await answer(w.callbackId, reply);
      if (w.messageId != null) await edit(w.chatId, w.messageId, `[SJC OS] ${reply}\n${appUrl()}/today`);
      await runDirect(`UPDATE telegram_updates SET outcome = $2 WHERE update_id = $1`, [update.update_id, reply.slice(0, 300)]).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, handled: result.handled, duplicate: result.duplicate, outcome: result.outcome });
  } catch (err) {
    console.error("[telegram] webhook failed:", (err as Error).message);
    // 200 on purpose: Telegram would otherwise redeliver forever; the update
    // is either persisted (and will be inspected) or malformed.
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
