// Telegram provider — the owner push channel (@SJC_OS_bot → Joe's chat) plus
// decision cards with inline Approve / Request changes / Hold buttons.
//
// THE LINE (unchanged from lib/notify-owner.ts): this adapter only ever
// addresses TELEGRAM_OWNER_CHAT_ID. It refuses any other chat id, so no code
// path can turn the owner channel into a client channel.
//
// sendMessage returns the message id; editMessageText updates a card in
// place (a superseded decision edits its message instead of sending a new
// one). TELEGRAM_API_BASE is the test seam the existing push code already
// honours.

import { classifyTransportError, outboundDisabled, recordFakeSend, type Provider, type ProviderResult } from "./types.ts";

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramPayload {
  chatId: string;
  text: string;
  /** Rows of inline buttons (Telegram reply_markup.inline_keyboard). */
  buttons?: TelegramInlineButton[][];
  /** Edit this message instead of sending a new one. */
  editMessageId?: number | string | null;
  [k: string]: unknown;
}

export interface TelegramTransport {
  configured(): boolean;
  ownerChatId(): string;
  call(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string; status: number }>;
}

export function makeTelegramProvider(transport: TelegramTransport = defaultTransport): Provider<TelegramPayload> {
  return {
    name: "telegram",
    async send(payload, ctx): Promise<ProviderResult> {
      const owner = transport.ownerChatId();
      if (!owner || String(payload.chatId) !== owner) {
        return { responseClass: "permanent", error: "Telegram pushes may only go to the owner chat.", transmitted: false };
      }
      if (!String(payload.text ?? "").trim()) return { responseClass: "permanent", error: "Empty Telegram message.", transmitted: false };
      if (outboundDisabled()) return recordFakeSend("telegram", payload, ctx);
      if (!transport.configured()) return { responseClass: "permanent", error: "Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_OWNER_CHAT_ID).", transmitted: false };
      const body: Record<string, unknown> = {
        chat_id: owner,
        text: payload.text,
        disable_web_page_preview: true,
        ...(payload.buttons?.length ? { reply_markup: { inline_keyboard: payload.buttons } } : {}),
      };
      const editing = payload.editMessageId != null && payload.editMessageId !== "";
      if (editing) body.message_id = Number(payload.editMessageId);
      try {
        const res = await transport.call(editing ? "editMessageText" : "sendMessage", body);
        if (!res.ok) {
          // Telegram's "message is not modified" is a successful no-op edit.
          if (editing && /not modified/i.test(res.description ?? "")) return { responseClass: "confirmed", providerRef: String(payload.editMessageId), transmitted: true };
          return classifyTransportError(new Error(`telegram ${editing ? "editMessageText" : "sendMessage"} ${res.status}: ${res.description ?? "no body"}`), { status: res.status });
        }
        const msg = res.result as { message_id?: number } | true | undefined;
        const id = msg && typeof msg === "object" && msg.message_id != null ? String(msg.message_id) : editing ? String(payload.editMessageId) : null;
        return { responseClass: "confirmed", providerRef: id, providerState: editing ? "edited" : "sent", transmitted: true };
      } catch (err) {
        return classifyTransportError(err);
      }
    },
  };
}

/** Answer a callback query (the toast the user sees after tapping a button).
 *  Best-effort; never throws. */
export async function answerCallbackQuery(id: string, text: string, transport: TelegramTransport = defaultTransport): Promise<void> {
  if (outboundDisabled() || !transport.configured()) return;
  try {
    await transport.call("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 200), show_alert: false });
  } catch {
    /* the decision is already recorded; the toast is cosmetic */
  }
}

export const defaultTransport: TelegramTransport = {
  configured: () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_CHAT_ID),
  ownerChatId: () => (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim(),
  async call(method, body) {
    const base = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/$/, "");
    const res = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string } | null;
    return { ok: Boolean(res.ok && out?.ok), result: out?.result, description: out?.description, status: res.status };
  },
};
