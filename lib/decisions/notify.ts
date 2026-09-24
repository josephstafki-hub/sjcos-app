import "server-only";

// Notify-on-stage (A10): exactly one notification per ready revision. The app
// card is written through lib/notify emit; the phone gets the same decision
// as a Telegram message with Approve / Request changes / Hold buttons that
// carry the decision id + content-hash prefix. A superseded decision edits
// the old Telegram message in place (same message id from
// decision_deliveries) instead of sending another buzz. Deliveries are
// recorded on the decision so a resolution can update every channel.

import { runDirect, withTransaction } from "@/lib/commands/db";
import { recordDelivery, stageDecision, DECISION_COLS, type Decision, type StageDecisionInput } from "@/lib/commands/decisions";
import { notifyOwner } from "@/lib/notify-owner";
import { cardText } from "./cards";
import { decisionKeyboard } from "./telegram";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}

/** The Telegram message a decision (or the one it superseded) is showing on. */
export async function telegramMessageFor(decisionId: string): Promise<{ chatId: string; messageId: string } | null> {
  const rows = await runDirect<{ external_ref: string | null }>(
    `SELECT external_ref FROM decision_deliveries WHERE decision_id = $1 AND channel = 'telegram' AND external_ref IS NOT NULL ORDER BY id DESC LIMIT 1`,
    [decisionId],
  );
  const ref = rows[0]?.external_ref;
  if (!ref) return null;
  const i = ref.indexOf(":");
  return i > 0 ? { chatId: ref.slice(0, i), messageId: ref.slice(i + 1) } : null;
}

/** Announce a freshly staged (or re-staged) decision. Idempotent per
 *  revision: when stageDecision returned created=false nothing is sent. */
export async function announceDecision(d: Decision, opts: { created: boolean; superseded: string | null }): Promise<void> {
  if (!opts.created) return;
  const text = cardText(d, { appUrl: appUrl() });
  const prior = opts.superseded ? await telegramMessageFor(opts.superseded) : null;
  await recordDelivery(runDirect, d.id, "app", null, "sent").catch(() => undefined);
  await notifyOwner({
    kind: "decision",
    title: d.title,
    body: text.split("\n").slice(1, 12).join("\n"),
    href: `/engine/decisions?d=${d.id}`,
    emit: {
      title: `Decision: ${d.title}`,
      subline: ((d.summary as { effect?: string }).effect ?? "").slice(0, 160) || undefined,
      href: `/engine/decisions?d=${d.id}`,
    },
    telegram: {
      buttons: decisionKeyboard(d.id, d.content_hash),
      decisionId: d.id,
      editMessageId: prior?.messageId ?? null,
    },
  });
}

/** Edit the Telegram card after a resolution so the phone shows the new
 *  state (buttons removed). Best-effort. */
export async function refreshTelegramCard(d: Decision): Promise<void> {
  const msg = await telegramMessageFor(d.id);
  if (!msg) return;
  await notifyOwner({
    kind: "decision",
    title: d.title,
    body: cardText(d, { appUrl: appUrl() }).split("\n").slice(1, 14).join("\n"),
    href: `/engine/decisions?d=${d.id}`,
    // Editing an existing message must not add another in-app card.
    emit: { title: `Decision ${d.status}: ${d.title}`, subline: d.decision_note ?? undefined, href: `/engine/decisions?d=${d.id}` },
    telegram: { decisionId: d.id, editMessageId: msg.messageId },
  });
}

/** Stage a decision in its own transaction and announce it once. This is
 *  what adapters and the internal route call. */
export async function stageAndAnnounce(input: StageDecisionInput): Promise<{ decision: Decision; created: boolean; superseded: string | null }> {
  const staged = await withTransaction((run) => stageDecision(run, input));
  await announceDecision(staged.decision, staged);
  return staged;
}

/** Decisions staged by pure modules (estimating, procurement, field, QBO,
 *  MCP tools running on their own pool) have no delivery yet. The dispatcher
 *  pass calls this every 2 minutes so every pending decision reaches Joe once,
 *  whoever staged it. Idempotent: a decision with an 'app' delivery is skipped. */
export async function announceUnannouncedDecisions(limit = 20): Promise<number> {
  const rows = await runDirect<Decision>(
    `SELECT ${DECISION_COLS} FROM decisions
      WHERE status = 'pending' AND expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM decision_deliveries dd WHERE dd.decision_id = decisions.id AND dd.channel = 'app')
      ORDER BY created_at LIMIT $1`,
    [limit],
  );
  let n = 0;
  for (const d of rows) {
    try {
      await announceDecision(d, { created: true, superseded: null });
      n++;
    } catch (err) {
      console.error(`[decisions] announce sweep failed for ${d.id}:`, (err as Error).message);
    }
  }
  return n;
}
