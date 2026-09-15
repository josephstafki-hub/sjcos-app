// Shared failure handling for the timer-driven cron routes.
//
// Every cron handler wraps its job in runCronJob() so a Gmail quota hit (or
// any other failure) never surfaces as an unhandled "⨯ Error" stack in the
// server log. Instead it logs ONE line, writes a notifications row so the
// bell and /notifications show it, and answers with a JSON error body the
// timer's curl can record. Rate-limit hits get their own title so the
// /notifications feed reads plainly ("Gmail rate limit hit during …").
//
// Not a route file — the leading underscore keeps this folder out of routing.

import { NextResponse } from "next/server";
import { isGmailRateLimit } from "@/lib/gmail";
import { emit } from "@/lib/notify";
import { query } from "@/lib/db";

/** Notifications with the same title inside this window are not re-emitted,
 *  so a quota that keeps tripping every quarter hour yields one card, not a
 *  pile. */
const DEDUP_WINDOW_MINUTES = 60;

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function notifyOnce(title: string, subline: string): Promise<void> {
  try {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
        WHERE title = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
      [title, String(DEDUP_WINDOW_MINUTES)],
    );
    if ((rows[0]?.n ?? 0) > 0) return;
  } catch {
    /* fall through and emit anyway */
  }
  // The notifications.kind CHECK only admits decision/mention/job/money/
  // compliance, so system events ride on "job" with a "System" tag.
  await emit({
    kind: "job",
    tag: "System",
    accent: "flag",
    icon: "mail",
    flagged: true,
    title,
    subline,
    href: "/notifications",
  });
}

/** Run one cron job body. On failure: one log line, one notifications row,
 *  and a 503 (rate limit) / 500 (anything else) JSON response. */
export async function runCronJob(
  /** Human name used in the log line and the notification title, e.g. "lead thread sync". */
  jobName: string,
  job: () => Promise<object>,
): Promise<NextResponse> {
  const ran_at = new Date().toISOString();
  try {
    const result = await job();
    return NextResponse.json({ ok: true, ran_at, ...result });
  } catch (err) {
    const msg = messageOf(err);
    if (isGmailRateLimit(err)) {
      console.error(`[cron:${jobName}] Gmail rate limit hit; skipped this run (${msg.slice(0, 160)})`);
      await notifyOnce(
        `Gmail rate limit hit during ${jobName}`,
        `Gmail's per-minute API quota was exhausted at ${ran_at}. The run was skipped and will retry on the next timer tick.`,
      );
      return NextResponse.json({ ok: false, ran_at, error: "gmail_rate_limited", message: msg }, { status: 503 });
    }
    console.error(`[cron:${jobName}] failed: ${msg.slice(0, 300)}`);
    await notifyOnce(`${capitalize(jobName)} failed`, msg.slice(0, 240));
    return NextResponse.json({ ok: false, ran_at, error: "cron_failed", message: msg }, { status: 500 });
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
