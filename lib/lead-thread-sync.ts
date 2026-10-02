import "server-only";

// Live "needs reply" detector. Keeps leads.flag_kind/flag_label/last_contact_at
// honest against real Gmail state, instead of the dead one-time "AI take" chip
// they used to be (see lib/lead-activity.ts for the complementary instant-clear
// path when a reply goes out through the app itself).
//
// Definition: a lead needs a reply when the MOST RECENT message in its matched
// thread was sent by the client, not by us — not Gmail's own UNREAD label,
// which only tells us Joe glanced at it, not that he answered it.
//
// Two freshness paths feed this, both calling syncLeadThreads():
//   - periodic: app/api/cron/lead-thread-sync (systemd timer, deploy/)
//   - opportunistic: nothing wired in yet — the periodic timer is sufficient
//     for v1; see docs/reference note in the cron route.
//
// Quota: this used to pull 150 full-body threads in one Promise.all every
// quarter hour, which burned Gmail's per-minute unit budget and made any real
// send in that minute fail ("Quota exceeded … Units per minute per user").
// Now it fetches headers only (format: "metadata"), 5 at a time, and after
// the first successful run only threads with a message newer than the stored
// watermark (app_settings 'lead_thread_sync.last_ok_at'). A quiet run is a
// threads.list plus a handful of metadata gets.
//
// dryRun computes + returns what WOULD change without writing anything (and
// leaves the watermark alone), so the feature can be sanity-checked before
// the timer runs unattended.

import { query, queryOne } from "./db";
import type { Run } from "./commands/core";
import { readCheckpoint, advanceCheckpoint } from "./obligations/catchup";
import { gmailConfigured, fetchThreadMetadata, gmailCallsSoFar } from "./gmail";
import { cancelLeadNurture } from "./newsletter-drip";

export interface LeadThreadSyncChange {
  slug: string;
  name: string;
  action: "flag" | "clear";
  reason: string;
  messageDate: string; // ISO
}

export interface LeadThreadSyncResult {
  configured: boolean;
  scanned: number;
  matchedThreads: number;
  changes: LeadThreadSyncChange[];
  dryRun: boolean;
  /** "incremental" when a watermark narrowed the scan, "full" otherwise. */
  mode: "full" | "incremental" | "skipped";
  /** ISO watermark the scan started from (null on a full scan). */
  since: string | null;
  /** Metered Gmail API calls this run made (including any retries). */
  gmailCalls: number;
  elapsedMs: number;
}

/** First email address in a raw header value ("Name <a@b>" or "a@b").
 *  Exported for lib/detectors.ts, which reuses this module's thread-matching
 *  approach for the needs-reply detector. */
export function extractEmail(raw: string): string {
  const m = raw.match(/[^\s<>"]+@[^\s<>"]+/);
  return (m ? m[0] : "").toLowerCase();
}

interface LeadRow {
  slug: string;
  name: string;
  email: string | null;
  flag_kind: string | null;
  last_contact_at: string | null;
}

// ─── Watermark ───────────────────────────────────────────────────────────────
//
// Same app_settings key/value stamp the comms health check and the 10DLC
// watch use (lib/comms-shared.ts). Stored as the ISO instant a successful,
// non-dry run STARTED, minus nothing — the overlap below is applied at read
// time so a clock skew between this box and Gmail can't hide a message.

const WATERMARK_KEY = "lead_thread_sync.last_ok_at";
/** Re-scan this far behind the watermark: Gmail's `after:` has one-second
 *  granularity and internalDate can lag delivery by a little. */
const WATERMARK_OVERLAP_MS = 10 * 60 * 1000;
/** A watermark older than this is treated as absent (full scan) — e.g. the
 *  timer was off for days and a 150-thread cap would miss things anyway. */
const WATERMARK_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// A01: the checkpoint lives in mailbox_checkpoints (lib/obligations/catchup.ts)
// so the inbox scan, the needs-reply detector and this sync can share one
// cursor discipline. The legacy app_settings stamp is still written for the
// comms health check and read once as a fallback when no checkpoint exists.
const CHECKPOINT_MAILBOX = "primary";
const CHECKPOINT_SCOPE = "lead-thread-sync";
const run: Run = async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => (await query<never>(sql, params as never[])).rows as T[];

async function readWatermark(): Promise<number | null> {
  try {
    const cp = await readCheckpoint(run, CHECKPOINT_MAILBOX, CHECKPOINT_SCOPE);
    let t = cp?.watermark_at ? Date.parse(cp.watermark_at) : NaN;
    if (!Number.isFinite(t)) {
      const r = await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [WATERMARK_KEY]);
      t = r?.value ? Date.parse(r.value) : NaN;
    }
    if (!Number.isFinite(t)) return null;
    if (Date.now() - t > WATERMARK_MAX_AGE_MS) return null;
    return t;
  } catch {
    return null;
  }
}

async function writeWatermark(atMs: number, stats: Record<string, unknown> = {}): Promise<void> {
  await advanceCheckpoint(run, CHECKPOINT_MAILBOX, CHECKPOINT_SCOPE, { watermarkAt: new Date(atMs), stats });
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [WATERMARK_KEY, new Date(atMs).toISOString()],
  );
}

export async function syncLeadThreads(
  opts: { dryRun?: boolean; max?: number; /** Ignore the watermark and rescan the newest `max` threads. */ full?: boolean } = {},
): Promise<LeadThreadSyncResult> {
  const dryRun = opts.dryRun ?? false;
  const startedAt = Date.now();
  const callsBefore = gmailCallsSoFar();
  const finish = (partial: Omit<LeadThreadSyncResult, "gmailCalls" | "elapsedMs">): LeadThreadSyncResult => ({
    ...partial,
    gmailCalls: gmailCallsSoFar() - callsBefore,
    elapsedMs: Date.now() - startedAt,
  });

  if (!gmailConfigured()) {
    return finish({ configured: false, scanned: 0, matchedThreads: 0, changes: [], dryRun, mode: "skipped", since: null });
  }

  const watermark = opts.full ? null : await readWatermark();
  const since = watermark ? watermark - WATERMARK_OVERLAP_MS : null;

  const [threads, leadRows, linkRows] = await Promise.all([
    fetchThreadMetadata({ max: opts.max ?? 150, since, concurrency: 5 }),
    // Exclude 'lost' leads — they're off-pipeline by explicit owner action
    // (see lib/leads.ts stageIsLost). Their Gmail history is irrelevant to
    // "needs reply," and syncing would stomp a legitimate "Passed"/"Lost"
    // ghost badge, or worse, resurrect a dead lead as "Needs reply."
    // Converted leads are likewise off-pipeline: their client's email now
    // belongs to the project (the needs-reply detector routes it there), so
    // flagging the hidden lead row would surface nowhere.
    query<LeadRow>(
      `SELECT slug, name, email, flag_kind, last_contact_at::text AS last_contact_at
         FROM leads WHERE email IS NOT NULL AND email <> '' AND stage <> 'lost'
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)`,
    ),
    query<{ gmail_thread_id: string; link_slug: string }>(
      `SELECT gmail_thread_id, link_slug FROM thread_links WHERE link_type = 'lead'`,
    ),
  ]);

  const bySlug = new Map<string, LeadRow>();
  const byEmail = new Map<string, LeadRow>();
  for (const l of leadRows.rows) {
    bySlug.set(l.slug, l);
    byEmail.set((l.email as string).toLowerCase(), l);
  }
  const linkedThread = new Map<string, string>();
  for (const l of linkRows.rows) linkedThread.set(l.gmail_thread_id, l.link_slug);

  const changes: LeadThreadSyncChange[] = [];
  let matchedThreads = 0;

  // Gmail returns threads newest-first, so the first match we see per lead is
  // already its most recent message — mutate the in-memory row as we go so a
  // second, older thread for the same lead in this batch doesn't reprocess
  // against stale state.
  for (const t of threads) {
    const linkedSlug = linkedThread.get(t.id);
    const lead = linkedSlug
      ? bySlug.get(linkedSlug)
      : byEmail.get((t.outbound ? extractEmail(t.toLine) : t.fromEmail).toLowerCase());
    if (!lead) continue;
    matchedThreads++;

    const msgAt = new Date(t.date);
    const lastKnown = lead.last_contact_at ? new Date(lead.last_contact_at) : null;
    if (lastKnown && msgAt <= lastKnown) continue;

    const desiredFlagKind = t.outbound ? null : "flag";
    const changed = lead.flag_kind !== desiredFlagKind;
    if (changed) {
      changes.push({
        slug: lead.slug,
        name: lead.name,
        action: t.outbound ? "clear" : "flag",
        reason: `${t.outbound ? "We replied" : "New message from them"}: "${t.subject}"`,
        messageDate: msgAt.toISOString(),
      });
    }

    lead.flag_kind = desiredFlagKind;
    lead.last_contact_at = msgAt.toISOString();

    if (!dryRun) {
      await query(
        `UPDATE leads SET flag_kind = $2, flag_label = $3, last_contact_at = $4 WHERE slug = $1`,
        [lead.slug, desiredFlagKind, desiredFlagKind ? "Needs reply" : null, msgAt.toISOString()],
      );
      // W4-L stop-on-engagement: the client wrote — a nurture drip talking past
      // a live conversation reads as a bot, so cancel it. Fires on every new
      // inbound (not just a flag flip); cancelLeadNurture is idempotent and
      // only logs when it actually cancelled something. Best-effort — the
      // flag sync above must land regardless.
      if (!t.outbound && lead.email) {
        try {
          await cancelLeadNurture(lead.email, "client replied");
        } catch {
          /* nurture cancel must never break the sync */
        }
      }
    }
  }

  // Only a completed, writing run advances the watermark; a dry run or a
  // thrown quota error leaves it where it was so the next run re-covers the
  // window. Stamped with the run's START so anything that arrived mid-run is
  // inside the next window.
  if (!dryRun) await writeWatermark(startedAt, { scanned: threads.length, matched: matchedThreads, changes: changes.length });

  return finish({
    configured: true,
    scanned: threads.length,
    matchedThreads,
    changes,
    dryRun,
    mode: since ? "incremental" : "full",
    since: since ? new Date(since).toISOString() : null,
  });
}
