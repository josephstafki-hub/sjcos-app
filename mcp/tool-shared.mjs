// Shared plumbing for the automation-build MCP tool modules: one transaction
// per tool call on this process's pool, the caller's principal resolved
// server-side (never from tool arguments), and a uniform error shape.

import { normalizePermissions } from "../lib/permissions.ts";

/** Run fn(run) in ONE transaction on the pool; rolls back on throw. */
export function txOver(pool) {
  return async (fn) => {
    const client = await pool.connect();
    const run = async (sql, params) => (await client.query(sql, params ?? [])).rows;
    try {
      await client.query("BEGIN");
      const out = await fn(run);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
}

/** The agent principal for this call: an agent acting for the person the
 *  server resolved (SJC_PRINCIPAL_USER_ID / bearer header), or unattended.
 *  Throws when that person is revoked — nothing runs for a dead identity. */
export async function principalFor(currentPrincipal, agentName) {
  const p = currentPrincipal ? await currentPrincipal() : { userId: null, role: null, name: null, active: false, revoked: false, runId: null };
  if (p.revoked) throw new Error("This account was disabled or signed out everywhere; no further actions run for it.");
  const onBehalfOf = p.userId && p.active && p.role ? { kind: "user", userId: p.userId, role: p.role, name: p.name ?? "", permissions: [] } : null;
  return { kind: "agent", agent: agentName, runId: p.runId ?? null, onBehalfOf };
}

export const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e?.message ?? String(e)}` }], isError: true });

export function agentNameOf(server) {
  try {
    const c = server.server.getClientVersion?.();
    if (c?.name) return String(c.name).slice(0, 40);
  } catch {
    /* pre-initialize */
  }
  return process.env.SJCOS_AGENT_NAME || "agent";
}

/** The app's area gate for a plain-SQL MCP write: null = allowed, otherwise
 *  the refusal message. Owner always may; staff need `area` in their
 *  permissions; no person behind the call (unattended clients Joe runs) →
 *  allowed, as for every MCP write. */
export async function areaRefusal(rows, currentPrincipal, area) {
  const p = await currentPrincipal();
  if (!p.userId) return null;
  if (p.revoked) return "The account this agent acts for is disabled or was signed out by the owner. Nothing was done.";
  if (p.role === "owner") return null;
  if (p.role === "staff") {
    const [u] = await rows(`SELECT permissions FROM users WHERE id = $1`, [p.userId]);
    if (normalizePermissions(u?.permissions).includes(area)) return null;
  }
  return `The account this agent acts for has no "${area}" access. Nothing was done.`;
}
