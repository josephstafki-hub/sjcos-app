import "server-only";

import { pool, bumpLiveChange } from "./db";
import type { PoolClient } from "pg";

export const SIGNATURE_CLOSED_ERROR = "This document was voided or is no longer awaiting signature. Ask SJ Carpentry for the current version.";

/** Lock drafts before requests everywhere so signing, voiding and delivery
 * serialize. Re-read state under the locks; a preflight read is never binding. */
export async function withEsignTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    bumpLiveChange("signature_requests");
    bumpLiveChange("document_drafts");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function lockSignableRequest(client: PoolClient, id: number): Promise<boolean> {
  const drafts = await client.query<{ status: string }>(
    `SELECT status FROM document_drafts WHERE signature_request_id = $1 ORDER BY id FOR UPDATE`, [id],
  );
  const request = await client.query<{ status: string }>(
    `SELECT status FROM signature_requests WHERE id = $1 FOR UPDATE`, [id],
  );
  return request.rows[0]?.status === "sent" && drafts.rows.every(d => d.status === "submitted");
}
