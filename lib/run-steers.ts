import "server-only";

import { bumpLiveChange, pool, query, queryOne } from "@/lib/db";
import { insertMessage } from "@/lib/ai-chat";

// Steering a live run: while an agent is working, what Joe types into the
// panel goes INTO that run instead of waiting for it to finish. Each runtime
// takes a steer the way it can:
//
//   claude → the detached runner keeps the CLI's stdin open (--input-format
//            stream-json) and writes each steer as a user message. The CLI
//            injects it at the next tool boundary; if the answer was already
//            done it runs as a follow-up turn in the same process and session.
//            (scripts/run-claude-agent.mjs — plain SQL there, same rules.)
//   hermes → relayed to the gateway's own POST /v1/runs/{id}/steer (session-
//            stream turns carry a steerable run id — lib/dev-agents.ts
//            hermesChat). A steer the gateway accepted after its final answer
//            comes back as pending_steer and is replayed as a follow-up turn.
//            In an Auto thread's ladder a steer that lands during Claude's
//            review becomes another Hermes round; during a takeover it is
//            relayed to the Claude run (relay_run_id).
//   qwen   → one streamed completion with no tool loop to inject into, so a
//            steer aborts the stream and Qwen starts over with it in the
//            thread (lib/actions/ai-chat.ts).
//
// The promise: a steer is delivered to the run or refused — never stranded on
// a run that already settled. A run takes its LAST look at pending steers in
// closeSteering(), which stamps steer_closed_at under the run row's lock;
// enqueueSteer() inserts only while that stamp is NULL, under the same lock.
// Whatever closeSteering() hands back the caller must deliver (a follow-up
// turn); whatever enqueueSteer() refuses the panel sends as the next message.

export interface SteerRow {
  id: string;
  body: string;
  messageId: string | null;
}

export interface SteerStatus {
  id: string;
  status: "pending" | "delivered";
  via: string | null;
}

export type SteerVia = "mid-turn" | "follow-up" | "restart" | "round";

export type EnqueueResult =
  | { ok: true; steerId: string; runId: string; messageId: string }
  | { ok: false; finished: true }
  | { ok: false; error: string };

/** Accept a steer for `runId` — or, when that run already closed, for the
 *  live follow-up run in the same thread (a steer that missed one turn of a
 *  hand-off should still reach the turn that is running now). The steer row
 *  and its transcript line commit together, so a runtime that sees the row
 *  can always read the line (Qwen re-reads the thread on restart). */
export async function enqueueSteer(runId: string, body: string): Promise<EnqueueResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Type something to steer with." };
  try {
    const first = await tryEnqueue(runId, text);
    if (first) return { ok: true, ...first };
    const next = await queryOne<{ id: string }>(
      `SELECT n.id FROM dev_agent_runs r
         JOIN dev_agent_runs n ON n.conversation_id = r.conversation_id
        WHERE r.id = $1 AND n.id <> r.id
          AND n.status IN ('pending','running') AND n.steer_closed_at IS NULL
          AND n.created_at >= r.created_at
        ORDER BY n.created_at DESC LIMIT 1`,
      [runId],
    );
    if (next) {
      const second = await tryEnqueue(next.id, text);
      if (second) return { ok: true, ...second };
    }
    return { ok: false, finished: true };
  } catch (err) {
    const msg = (err as Error).message;
    if (/run_steers|steer_closed_at|column "steer"/.test(msg)) {
      return { ok: false, error: "Steering isn't set up on this database yet (node db/apply-run-steers.mjs)." };
    }
    return { ok: false, error: msg };
  }
}

async function tryEnqueue(runId: string, text: string): Promise<{ steerId: string; runId: string; messageId: string } | null> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const run = await c.query<{ conversation_id: string | null }>(
      `SELECT conversation_id FROM dev_agent_runs
        WHERE id = $1 AND status IN ('pending','running') AND steer_closed_at IS NULL
        FOR UPDATE`,
      [runId],
    );
    if (!run.rows.length) {
      await c.query("ROLLBACK");
      return null;
    }
    const conversationId = run.rows[0].conversation_id;
    let messageId: string | null = null;
    if (conversationId) {
      const m = await c.query<{ id: string }>(
        `INSERT INTO ai_messages (conversation_id, role, body, steer) VALUES ($1, 'user', $2, true) RETURNING id`,
        [conversationId, text],
      );
      messageId = m.rows[0].id;
      await c.query(`UPDATE ai_conversations SET updated_at = now(), last_activity_at = now() WHERE id = $1`, [conversationId]);
    }
    const s = await c.query<{ id: string }>(
      `INSERT INTO run_steers (run_id, conversation_id, message_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [runId, conversationId, messageId, text],
    );
    await c.query("COMMIT");
    bumpLiveChange("ai_messages");
    return { steerId: s.rows[0].id, runId, messageId: messageId ?? "" };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** Claim every pending steer addressed to this run (directly, or relayed to
 *  it from a ladder) as delivered. Oldest first. */
export async function takePendingSteers(runId: string, via: SteerVia): Promise<SteerRow[]> {
  try {
    const { rows } = await query<{ id: string; body: string; message_id: string | null; created_at: string }>(
      `UPDATE run_steers SET status = 'delivered', via = $2, delivered_at = now()
        WHERE status = 'pending' AND (run_id = $1 OR relay_run_id = $1)
        RETURNING id, body, message_id, created_at::text AS created_at`,
      [runId, via],
    );
    return rows
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ id: r.id, body: r.body, messageId: r.message_id }));
  } catch {
    return []; // pre-migration: nothing can have been steered
  }
}

/** Cheap "anything waiting?" check for the per-second tickers. */
export async function hasPendingSteers(runId: string): Promise<boolean> {
  try {
    const r = await queryOne<{ one: number }>(
      `SELECT 1 AS one FROM run_steers WHERE status = 'pending' AND (run_id = $1 OR relay_run_id = $1) LIMIT 1`,
      [runId],
    );
    return !!r;
  } catch {
    return false;
  }
}

/** Put claimed steers back (the runtime couldn't take them this tick — e.g.
 *  Hermes' run wasn't accepting steer input yet). */
export async function releaseSteers(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await query(
    `UPDATE run_steers SET status = 'pending', via = NULL, delivered_at = NULL WHERE id = ANY($1::uuid[])`,
    [ids],
  ).catch(() => {});
}

/** Mark how already-claimed steers were finally delivered. */
export async function markSteersVia(ids: string[], via: SteerVia): Promise<void> {
  if (!ids.length) return;
  await query(`UPDATE run_steers SET via = $2 WHERE id = ANY($1::uuid[])`, [ids, via]).catch(() => {});
}

/** The run's last look: stop accepting steers and hand back whatever is still
 *  pending — the caller MUST deliver those (a follow-up turn). Call
 *  reopenSteering() if the same run keeps going to deliver them. */
export async function closeSteering(runId: string, via: SteerVia = "follow-up"): Promise<SteerRow[]> {
  try {
    await query(`UPDATE dev_agent_runs SET steer_closed_at = now() WHERE id = $1 AND steer_closed_at IS NULL`, [runId]);
  } catch {
    return [];
  }
  return takePendingSteers(runId, via);
}

export async function reopenSteering(runId: string): Promise<void> {
  await query(`UPDATE dev_agent_runs SET steer_closed_at = NULL WHERE id = $1`, [runId]).catch(() => {});
}

/** Hand a run's pending steers to another run (the ladder's Claude takeover)
 *  — only while that run still takes steers, under its row lock, so the
 *  relay can't race the takeover's own close. */
export async function relaySteers(fromRunId: string, toRunId: string): Promise<number> {
  const c = await pool.connect().catch(() => null);
  if (!c) return 0;
  try {
    await c.query("BEGIN");
    const open = await c.query(
      `SELECT 1 FROM dev_agent_runs WHERE id = $1 AND status IN ('pending','running') AND steer_closed_at IS NULL FOR UPDATE`,
      [toRunId],
    );
    if (!open.rows.length) {
      await c.query("ROLLBACK");
      return 0;
    }
    const r = await c.query(
      `UPDATE run_steers SET relay_run_id = $2 WHERE run_id = $1 AND status = 'pending' AND relay_run_id IS NULL`,
      [fromRunId, toRunId],
    );
    await c.query("COMMIT");
    return r.rowCount ?? 0;
  } catch {
    await c.query("ROLLBACK").catch(() => {});
    return 0;
  } finally {
    c.release();
  }
}

/** Steer statuses for the panel's "↪ Steer · delivered" chips. */
export async function steersForRun(runId: string): Promise<SteerStatus[]> {
  try {
    const { rows } = await query<{ id: string; status: "pending" | "delivered"; via: string | null }>(
      `SELECT id, status, via FROM run_steers WHERE run_id = $1 ORDER BY created_at`,
      [runId],
    );
    return rows;
  } catch {
    return [];
  }
}

/** Between an answer and the follow-up turn a late steer got, when both
 *  land in one reply (Claude's runner, Hermes' pending_steer replay). */
export const STEER_FOLLOW_UP_DIVIDER = "\n\n— ↪ after your steer —\n\n";

/** How a steer reads to the model. */
export function steerPrompt(steers: { body: string }[], when: "working" | "finished" = "working"): string {
  const lead =
    when === "working"
      ? "[Joe sent this while you were working — take it into account from here on:]"
      : "[Joe sent this while you were finishing your last answer — it arrived too late for that answer, so act on it now. Don't repeat your earlier answer; just add what this changes:]";
  return `${lead}\n${steers.map((s) => s.body).join("\n\n")}`;
}

/** A once-a-second poll for a live in-process turn. `tick` never overlaps
 *  itself; `stop()` resolves once any in-flight tick has finished, so the
 *  caller can read what the last tick decided. */
export function steerTicker(tick: () => Promise<void>, everyMs = 1000): { stop: () => Promise<void> } {
  let busy: Promise<void> | null = null;
  let stopped = false;
  const t = setInterval(() => {
    if (busy || stopped) return;
    busy = tick()
      .catch(() => {})
      .finally(() => {
        busy = null;
      });
  }, everyMs);
  return {
    stop: async () => {
      stopped = true;
      clearInterval(t);
      if (busy) await busy;
    },
  };
}

/**
 * Settle an in-process (Hermes / Qwen) run, keeping the steer promise: close
 * steering, persist the answer, and if steers arrived too late for it, move
 * their transcript lines after the answer (that is when the agent actually
 * reads them) and start a follow-up turn for them BEFORE the row settles — the
 * panel, seeing `done`, follows it via nextRunId. A run Joe ⏹-stopped is left
 * alone. Returns false when the run was already settled (stopped).
 */
export async function settleSteeredRun(opts: {
  runId: string;
  conversationId: string;
  agent: string;
  status: "done" | "error";
  answer: string;
  /** Start the follow-up turn for steers the answer never saw (its run row
   *  must exist when this resolves). */
  followUp: (prompt: string) => Promise<unknown>;
}): Promise<boolean> {
  const left = await closeSteering(opts.runId);
  const live = await queryOne<{ status: string }>(`SELECT status FROM dev_agent_runs WHERE id = $1`, [opts.runId]);
  if (!live || (live.status !== "pending" && live.status !== "running")) return false;
  await insertMessage(opts.conversationId, "assistant", opts.answer, { agent: opts.agent });
  if (left.length) {
    const ids = left.map((s) => s.messageId).filter((id): id is string => !!id);
    if (ids.length) {
      await query(
        `UPDATE ai_messages m SET created_at = now() + (x.ord * interval '1 millisecond')
           FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, ord) WHERE m.id = x.id`,
        [ids],
      ).catch(() => {});
    }
    try {
      await opts.followUp(steerPrompt(left, "finished"));
    } catch (err) {
      await insertMessage(opts.conversationId, "assistant", `⚠️ Couldn't start a turn for your steer: ${(err as Error).message}`, {
        agent: opts.agent,
      }).catch(() => {});
    }
  }
  await query(
    `UPDATE dev_agent_runs SET status = $3, answer = $2, updated_at = now()
      WHERE id = $1 AND status IN ('pending','running')`,
    [opts.runId, opts.answer, opts.status],
  );
  return true;
}
