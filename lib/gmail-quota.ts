// Gmail quota accounting: what each call costs, how much of the minute this
// process has already spent per mailbox, and who goes first when it's tight.
//
// Google meters Gmail per user per minute per Cloud project (6,000 units for
// projects created after 2026-05-01; older projects kept their old limit). A
// full threads.get is 120 units, so one 50-thread inbox load used to cost
// ~6,000 on its own and a send (100) landing in the same minute was refused.
// Every metered call in lib/gmail.ts now asks this module for room first:
//
//   send         — a person pressed Send. May use the whole minute.
//   interactive  — someone is looking at the inbox. Up to 90%, waits ≤3 s.
//   background   — timers (detectors, lead sync, drafting). Up to 50%, and
//                  stands aside entirely while a send is waiting.
//
// This only sees this process's own calls. Other users of the same Google
// project (Hermes, the MCP server) are invisible here, so a real 429 also puts
// the mailbox into a short cooldown that every non-send caller respects.
//
// No Google SDK and no secrets here, so it stays importable from tests.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export type GmailPriority = "send" | "interactive" | "background";

/** Units per call, from Google's Gmail API usage-limits table (2026). Labels
 *  match the ones lib/gmail.ts passes to withGmailRetry. */
const COSTS: Record<string, number> = {
  "threads.get": 120, // format: full
  "threads.get(metadata)": 40,
  "threads.get(minimal)": 40,
  "threads.list": 10,
  "threads.list(inquiry)": 10,
  "threads.modify": 10,
  "threads.trash": 20,
  "messages.get": 60, // format: full
  "messages.get(metadata)": 20,
  "messages.list": 5,
  "messages.send": 100,
  "attachments.get": 20,
  "history.list": 2,
  "labels.list": 1,
  "labels.get": 1,
  getProfile: 1,
};

export function gmailCallCost(label: string): number {
  return COSTS[label] ?? 20;
}

/** The per-user-per-minute limit to plan against. Defaults to the 6,000 that
 *  new projects get; set GMAIL_UNITS_PER_MINUTE to what the Cloud console's
 *  Quotas page shows for "Units per minute per user" if it is higher. */
export function gmailUnitsPerMinute(): number {
  const n = Number(process.env.GMAIL_UNITS_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? n : 6000;
}

const SHARE: Record<GmailPriority, number> = { send: 1, interactive: 0.9, background: 0.5 };
const MAX_WAIT_MS: Record<GmailPriority, number> = { send: 0, interactive: 3_000, background: 10 * 60_000 };
const WINDOW_MS = 60_000;
/** After a real 429 nobody but a send tries again for this long. */
const COOLDOWN_MS = 20_000;

interface Ledger {
  spends: { at: number; units: number }[];
  cooldownUntil: number;
  /** Start times of sends in progress. A send stuck longer than SEND_HOLD_MS
   *  stops holding timers back (a hung request must not stall every cron). */
  sends: number[];
}
const SEND_HOLD_MS = 2 * 60_000;
const ledgers = new Map<string, Ledger>();

/** Stable, non-secret key for a mailbox credential (hash of the token). */
export function mailboxQuotaKey(refreshToken: string | null | undefined): string {
  return createHash("sha256").update(refreshToken ?? "").digest("hex").slice(0, 16);
}

function ledgerFor(key: string): Ledger {
  let l = ledgers.get(key);
  if (!l) {
    l = { spends: [], cooldownUntil: 0, sends: [] };
    ledgers.set(key, l);
  }
  return l;
}

function spentNow(l: Ledger, now: number): number {
  while (l.spends.length && now - l.spends[0].at >= WINDOW_MS) l.spends.shift();
  return l.spends.reduce((sum, s) => sum + s.units, 0);
}

/** Units this process spent on the mailbox in the last minute. */
export function gmailUnitsSpent(key: string): number {
  return spentNow(ledgerFor(key), Date.now());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sendInProgress(l: Ledger, now: number): boolean {
  return l.sends.some((at) => now - at < SEND_HOLD_MS);
}

/** Wait (bounded by priority) until the call fits in this minute's share, then
 *  book its cost. A caller that waits its maximum proceeds anyway and lets
 *  Google decide — the budget is advisory, never a reason to fail.
 *  `priority` may be a function: shared work (one read several callers wait
 *  on) is re-ranked when a more urgent caller joins it mid-wait. */
export async function acquireGmailUnits(
  key: string,
  label: string,
  priority: GmailPriority | (() => GmailPriority) = currentGmailPriority(),
): Promise<void> {
  const l = ledgerFor(key);
  const cost = gmailCallCost(label);
  const rank = typeof priority === "function" ? priority : () => priority;
  const started = Date.now();
  for (;;) {
    const p = rank();
    const now = Date.now();
    const sending = sendInProgress(l, now);
    // After a 429 timers stand down; a person's reads only wait it out while
    // a send is trying to land in the same minute.
    const cooling = now < l.cooldownUntil && (p === "background" || (p === "interactive" && sending));
    const yieldToSend = p === "background" && sending;
    const room = spentNow(l, now) + cost <= gmailUnitsPerMinute() * SHARE[p];
    if (!cooling && !yieldToSend && room) break;
    const waited = now - started;
    if (waited >= MAX_WAIT_MS[p]) break;
    const untilFree = cooling
      ? l.cooldownUntil - now
      : l.spends.length ? l.spends[0].at + WINDOW_MS - now : 250;
    await sleep(Math.max(100, Math.min(untilFree, 2_000, MAX_WAIT_MS[p] - waited)));
  }
  l.spends.push({ at: Date.now(), units: cost });
}

const RANK: Record<GmailPriority, number> = { background: 0, interactive: 1, send: 2 };

/** Priority holder for work several callers share: starts at the creator's
 *  priority, and anyone who joins raises it to theirs. */
export function sharedGmailPriority(initial: GmailPriority = currentGmailPriority()): {
  get: () => GmailPriority;
  raise: (p?: GmailPriority) => void;
} {
  let current = initial;
  return {
    get: () => current,
    raise: (p = currentGmailPriority()) => {
      if (RANK[p] > RANK[current]) current = p;
    },
  };
}

/** Google refused a call for quota: everyone but senders backs off. */
export function noteGmailRateLimited(key: string): void {
  const l = ledgerFor(key);
  l.cooldownUntil = Math.max(l.cooldownUntil, Date.now() + COOLDOWN_MS);
}

/** Mark a send in progress so background work stands aside until it's done. */
export async function withGmailSendSlot<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const l = ledgerFor(key);
  const at = Date.now();
  l.sends.push(at);
  try {
    return await fn();
  } finally {
    const i = l.sends.indexOf(at);
    if (i >= 0) l.sends.splice(i, 1);
  }
}

const priorityScope = new AsyncLocalStorage<GmailPriority>();

/** Run timer work at background priority (runCronJob wraps every cron job). */
export function runAsGmailBackground<T>(fn: () => Promise<T>): Promise<T> {
  return priorityScope.run("background", fn);
}

/** Run work a person may end up waiting on (the shared inbox load) at
 *  interactive priority even when a timer happened to start it. */
export function runAsGmailInteractive<T>(fn: () => Promise<T>): Promise<T> {
  return priorityScope.run("interactive", fn);
}

export function currentGmailPriority(): GmailPriority {
  return priorityScope.getStore() ?? "interactive";
}

/** How long to keep retrying a refused call. `patient` spans a full quota
 *  minute (2, 4, 8, 16, 32 s + jitter ≈ 62 s, Google's recommended truncated
 *  backoff) and is used for sends and the read a reply depends on. */
export type GmailRetryPolicy = "once" | "default" | "patient";
export function retrySchedule(policy: GmailRetryPolicy): { attempts: number; baseMs: number; maxMs: number } {
  const scale = Number(process.env.GMAIL_RETRY_SCALE) > 0 ? Number(process.env.GMAIL_RETRY_SCALE) : 1;
  if (policy === "once") return { attempts: 1, baseMs: 0, maxMs: 0 };
  if (policy === "patient") return { attempts: 6, baseMs: 2_000 * scale, maxMs: 32_000 * scale };
  return { attempts: 3, baseMs: 1_500 * scale, maxMs: 6_000 * scale };
}

/** Test hook: forget all ledgers. */
export function resetGmailQuotaForTests(): void {
  ledgers.clear();
}
