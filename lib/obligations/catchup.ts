// Checkpointed mailbox catch-up (A01). A run reads the mailbox's checkpoint,
// pages through EVERY thread newer than (watermark − overlap) — there is no
// 150-thread ceiling; the page fetch is injected so the harness test can
// model Gmail with an in-memory list — hands each thread to the caller, and
// advances the checkpoint only after a completed, writing run. A crash or a
// thrown quota error leaves the checkpoint where it was, so the next run
// re-covers the window; the overlap makes a thread that arrived mid-run land
// inside the next window. Handlers must be idempotent (they are: obligations
// key on stable ids).
//
// Pure: `run(sql, params)` + an injected `fetchPage`.

import type { Run } from "../commands/core.ts";

export interface MailboxCheckpoint {
  mailbox: string;
  scope: string;
  cursor: string | null;
  watermark_at: string | null;
  last_ok_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  stats: Record<string, unknown>;
}

const COLS = `mailbox, scope, cursor, watermark_at::text AS watermark_at, last_ok_at::text AS last_ok_at,
  last_run_at::text AS last_run_at, last_error, stats`;

export async function readCheckpoint(run: Run, mailbox: string, scope = "default"): Promise<MailboxCheckpoint | null> {
  const rows = await run<MailboxCheckpoint>(`SELECT ${COLS} FROM mailbox_checkpoints WHERE mailbox = $1 AND scope = $2`, [mailbox.toLowerCase(), scope]);
  return rows[0] ?? null;
}

/** Stamp a completed run: watermark + cursor + last_ok_at. */
export async function advanceCheckpoint(
  run: Run,
  mailbox: string,
  scope: string,
  next: { watermarkAt: Date | string; cursor?: string | null; stats?: Record<string, unknown> },
): Promise<MailboxCheckpoint> {
  const wm = next.watermarkAt instanceof Date ? next.watermarkAt.toISOString() : next.watermarkAt;
  const rows = await run<MailboxCheckpoint>(
    `INSERT INTO mailbox_checkpoints (mailbox, scope, cursor, watermark_at, last_ok_at, last_run_at, last_error, stats)
     VALUES ($1, $2, $3, $4::timestamptz, now(), now(), NULL, $5::jsonb)
     ON CONFLICT (mailbox, scope) DO UPDATE
       SET cursor = COALESCE(EXCLUDED.cursor, mailbox_checkpoints.cursor),
           -- never move the watermark backwards
           watermark_at = GREATEST(COALESCE(mailbox_checkpoints.watermark_at, EXCLUDED.watermark_at), EXCLUDED.watermark_at),
           last_ok_at = now(), last_run_at = now(), last_error = NULL, stats = EXCLUDED.stats
     RETURNING ${COLS}`,
    [mailbox.toLowerCase(), scope, next.cursor ?? null, wm, JSON.stringify(next.stats ?? {})],
  );
  return rows[0];
}

/** Record a failed run without moving the watermark. */
export async function failCheckpoint(run: Run, mailbox: string, scope: string, error: string): Promise<void> {
  await run(
    `INSERT INTO mailbox_checkpoints (mailbox, scope, last_run_at, last_error)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (mailbox, scope) DO UPDATE SET last_run_at = now(), last_error = EXCLUDED.last_error`,
    [mailbox.toLowerCase(), scope, error.slice(0, 1000)],
  );
}

export interface ThreadLike {
  id: string;
  /** Epoch ms of the newest message. */
  date: number;
}

export interface CatchUpOptions<T extends ThreadLike> {
  mailbox: string;
  scope?: string;
  /** Fetch one page of threads newer than `since` (epoch ms | null = everything). Return nextPageToken null on the last page. */
  fetchPage: (args: { since: number | null; pageToken: string | null; pageSize: number }) => Promise<{ threads: T[]; nextPageToken: string | null }>;
  /** Idempotent per-thread work. */
  handleThread: (thread: T) => Promise<void>;
  pageSize?: number;
  /** Re-cover this much before the watermark (default 6h). */
  overlapMs?: number;
  /** Safety cap on pages per run (default 200 → 20k threads at 100/page). */
  maxPages?: number;
  dryRun?: boolean;
  /** Clock override for tests. */
  now?: () => Date;
}

export interface CatchUpResult {
  mode: "full" | "incremental";
  since: string | null;
  pages: number;
  threads: number;
  handled: number;
  errors: { threadId: string; error: string }[];
  advanced: boolean;
  capped: boolean;
}

export async function catchUpMailbox<T extends ThreadLike>(run: Run, opts: CatchUpOptions<T>): Promise<CatchUpResult> {
  const scope = opts.scope ?? "default";
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const cp = await readCheckpoint(run, opts.mailbox, scope);
  const overlap = opts.overlapMs ?? 6 * 60 * 60 * 1000;
  const since = cp?.watermark_at ? new Date(cp.watermark_at).getTime() - overlap : null;
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 200;

  const result: CatchUpResult = { mode: since ? "incremental" : "full", since: since ? new Date(since).toISOString() : null, pages: 0, threads: 0, handled: 0, errors: [], advanced: false, capped: false };
  const seen = new Set<string>();
  let pageToken: string | null = null;
  try {
    do {
      if (result.pages >= maxPages) {
        result.capped = true;
        break;
      }
      const page = await opts.fetchPage({ since, pageToken, pageSize });
      result.pages++;
      for (const t of page.threads) {
        if (seen.has(t.id)) continue; // a thread that moved between pages
        seen.add(t.id);
        result.threads++;
        if (since != null && t.date < since) continue; // provider gave us older than asked
        try {
          if (!opts.dryRun) await opts.handleThread(t);
          result.handled++;
        } catch (err) {
          result.errors.push({ threadId: t.id, error: (err as Error).message ?? String(err) });
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    await failCheckpoint(run, opts.mailbox, scope, (err as Error).message ?? String(err));
    throw err;
  }

  // Advance only after a complete, writing, error-free walk — and never past
  // a capped run (the unwalked tail would fall outside the next window).
  if (!opts.dryRun && !result.capped && result.errors.length === 0) {
    await advanceCheckpoint(run, opts.mailbox, scope, { watermarkAt: startedAt, stats: { pages: result.pages, threads: result.threads, handled: result.handled } });
    result.advanced = true;
  } else if (!opts.dryRun) {
    await failCheckpoint(run, opts.mailbox, scope, result.capped ? `page cap ${maxPages} hit; watermark held` : `${result.errors.length} thread handler error(s); watermark held`);
  }
  return result;
}
