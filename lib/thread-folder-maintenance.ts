import "server-only";
import { pool } from "@/lib/db";
import { withAskJournal } from "@/lib/ask-thread-journal.mjs";

/** Trusted cron only: never import into request actions or select via user input.
 * The cron-secret route is the identity boundary; journal serializes tombstones.
 * No titles, folder metadata or per-person counts leave this adapter. */
export async function autoSettleQuietThreadsInBackground(): Promise<{ settled: number }> {
 return withAskJournal(pool, async () => {
  const setting = (await pool.query(`SELECT value FROM app_settings WHERE key='panel.autoSettleAfterDays'`)).rows[0];
  const value = setting?.value?.trim();
  if (value === '' || value === 'off' || value === 'null') return { settled: 0 };
  const days = Number(value) > 0 && Number.isFinite(Number(value)) ? Number(value) : 3;
  const { rowCount } = await pool.query(
    `UPDATE ai_conversations c
        SET settled_override = 'settled',
            settled_at = COALESCE(c.last_activity_at, c.updated_at),
            pinned_at = NULL, pin_order_key = NULL
      WHERE c.owner_user_id IS NOT NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL
        AND c.settled_override IS NULL
        AND c.pinned_at IS NULL
        AND COALESCE(c.last_activity_at, c.updated_at) < now() - ($1::numeric * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM dev_agent_runs r WHERE r.conversation_id = c.id AND r.status IN ('pending','running'))
        AND NOT EXISTS (SELECT 1 FROM owner_grants g WHERE g.conversation_id = c.id AND g.status = 'requested' AND g.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM agent_interactions i WHERE i.conversation_id = c.id AND i.status = 'pending')`,
    [days],
  );
  return { settled: rowCount ?? 0 };
 });
}
