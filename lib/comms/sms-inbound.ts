// Telnyx messaging webhook payloads + the six registered keywords. Pure, so
// the parser and keyword rules are unit-tested against the exact shapes that
// differ from Twilio and bite when skimmed:
//   • `to` is an ARRAY of {phone_number, status}
//   • the sender is `from.phone_number`, not a flat string
//   • the body is `text`, not `Body`
//   • MMS attachments are `media[]` with {url, content_type, size}; the URLs
//     expire, so the caller must download and re-store them.

export type MessagingEventType = "message.received" | "message.sent" | "message.finalized" | string;

export interface InboundMedia {
  url: string;
  contentType: string;
  size: number | null;
}

export interface ParsedMessagingEvent {
  eventType: MessagingEventType;
  eventId: string | null;
  occurredAt: string | null;
  messageId: string | null;
  direction: "inbound" | "outbound" | null;
  messageType: "SMS" | "MMS" | string | null;
  from: string | null;
  /** Every recipient number; the business number for an inbound. */
  to: string[];
  /** Delivery status of the first recipient (outbound receipts). */
  toStatus: string | null;
  text: string;
  media: InboundMedia[];
  errors: { code: string; title: string; detail: string }[];
  receivedAt: string | null;
}

function str(x: unknown): string | null {
  return typeof x === "string" && x.length ? x : null;
}

/** Parse a Telnyx messaging webhook body (already JSON-parsed). Null when the
 *  envelope isn't a Telnyx event at all. Never throws. */
export function parseMessagingEvent(body: unknown): ParsedMessagingEvent | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const eventType = str(d.event_type);
  if (!eventType) return null;
  const p = (d.payload && typeof d.payload === "object" ? d.payload : {}) as Record<string, unknown>;

  const from = p.from && typeof p.from === "object" ? str((p.from as Record<string, unknown>).phone_number) : null;
  const toArr = Array.isArray(p.to) ? p.to : [];
  const to: string[] = [];
  let toStatus: string | null = null;
  for (const t of toArr) {
    if (t && typeof t === "object") {
      const n = str((t as Record<string, unknown>).phone_number);
      if (n) to.push(n);
      if (toStatus === null) toStatus = str((t as Record<string, unknown>).status);
    } else if (typeof t === "string") {
      to.push(t);
    }
  }
  const media: InboundMedia[] = [];
  if (Array.isArray(p.media)) {
    for (const m of p.media) {
      if (!m || typeof m !== "object") continue;
      const url = str((m as Record<string, unknown>).url);
      if (!url) continue;
      const size = (m as Record<string, unknown>).size;
      media.push({
        url,
        contentType: str((m as Record<string, unknown>).content_type) ?? "application/octet-stream",
        size: typeof size === "number" ? size : null,
      });
    }
  }
  const errors: ParsedMessagingEvent["errors"] = [];
  if (Array.isArray(p.errors)) {
    for (const e of p.errors) {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      errors.push({ code: String(r.code ?? ""), title: String(r.title ?? ""), detail: String(r.detail ?? "") });
    }
  }
  const direction = str(p.direction);
  return {
    eventType,
    eventId: str(d.id),
    occurredAt: str(d.occurred_at),
    messageId: str(p.id),
    direction: direction === "inbound" || direction === "outbound" ? direction : null,
    messageType: str(p.type),
    from,
    to,
    toStatus,
    text: typeof p.text === "string" ? p.text : "",
    media,
    errors,
    receivedAt: str(p.received_at),
  };
}

// ─── Keywords ────────────────────────────────────────────────────────────────
// Exactly the six registered on the 10DLC campaign (lib/comms/tendlc.mjs).
// Registering keywords the OS ignores would be an inaccurate statement to the
// carriers, so every one of these has a handler on the inbound path.

export type KeywordAction = "opt_out" | "help" | "opt_in";

export const KEYWORDS: Record<KeywordAction, readonly string[]> = {
  opt_out: ["STOP", "UNSUBSCRIBE"],
  help: ["HELP", "INFO"],
  opt_in: ["START", "YES"],
};

/** Classify an inbound text. Case-insensitive; the message must BE the
 *  keyword (surrounding whitespace / trailing punctuation tolerated) — "stop
 *  by tomorrow at 8" is not an opt-out. */
export function classifyKeyword(text: string): KeywordAction | null {
  const word = text.trim().replace(/[.!?,;:]+$/g, "").trim().toUpperCase();
  if (!word) return null;
  for (const [action, words] of Object.entries(KEYWORDS) as [KeywordAction, readonly string[]][]) {
    if (words.includes(word)) return action;
  }
  return null;
}

// ─── Outbound failure classification ─────────────────────────────────────────
// Telnyx returns errors[] {code, title, detail}. While the 10DLC campaign is
// pending carrier approval (1–3 weeks) every send to a US mobile fails with a
// registration-shaped error. That is expected; label it so nobody debugs a
// non-bug.

export type SendFailureKind = "campaign_not_registered" | "opted_out" | "invalid_number" | "other";

export function classifySendFailure(errors: { code: string; title: string; detail: string }[]): SendFailureKind {
  const blob = errors.map((e) => `${e.code} ${e.title} ${e.detail}`).join(" | ").toLowerCase();
  if (/10\s?dlc|campaign|a2p|unregistered|not registered|brand/.test(blob)) return "campaign_not_registered";
  if (/opt(ed)?[- ]?out|unsubscribed|blocked by recipient|stop/.test(blob)) return "opted_out";
  if (/invalid.*(number|destination)|not a valid|unroutable/.test(blob)) return "invalid_number";
  return "other";
}

export function describeSendFailure(kind: SendFailureKind, errors: { code: string; title: string; detail: string }[]): string {
  const raw = errors.map((e) => `${e.code ? `[${e.code}] ` : ""}${e.detail || e.title}`).join("; ") || "no detail from Telnyx";
  switch (kind) {
    case "campaign_not_registered":
      return `10DLC campaign not yet approved — carriers are still reviewing the registration (normal for 1–3 weeks). Telnyx said: ${raw}`;
    case "opted_out":
      return `Recipient has opted out at the carrier level. Telnyx said: ${raw}`;
    case "invalid_number":
      return `Telnyx rejected the destination number: ${raw}`;
    default:
      return `Telnyx send failed: ${raw}`;
  }
}
