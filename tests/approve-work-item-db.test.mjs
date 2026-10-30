// approveWorkItemById (lib/approve-work-item.ts) against the disposable
// Postgres harness: lib/db's real pool points at the test database; the
// effects after the gate flips (the staged-draft send, the agent ping, the
// runbook step, the rejection memory) are stubbed and counted, so nothing is
// emailed.
//
// The bug (2026-10-30): the UPDATE set approval_status = 'approved' whatever
// the item's state, so an old Telegram / app Approve tapped after Joe
// rejected (or already approved) a draft re-approved it — and approving
// emails the client. Two taps at once could both send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const root = new URL("../", import.meta.url);

const STUBS = {
  "server-only": [],
  "@/lib/agent-memory": ["captureAgentMemory"],
  "@/lib/approved-draft-send": ["sendApprovedClientDraft", "reopenApprovalAfterFailedSend"],
  "@/lib/dev-agents": ["notifyAgentOwner"],
  "@/lib/runbook-engine": ["maybeAdvanceRunbook"],
};
registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      for (const ext of ["", ".ts", ".mjs"]) {
        try {
          if (statSync(new URL(base + ext)).isFile()) return { url: base + ext, shortCircuit: true };
        } catch {
          /* try the next extension */
        }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const names = STUBS[url.slice("stub:".length)];
    const source = names.map((n) => `export const ${n} = (...a) => globalThis.__approve.${n}(...a);`).join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});

test("Approve: only an item still awaiting approval; stale and racing taps send nothing", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    const { pool } = await import("../lib/db.ts");
    const { approveWorkItemById, rejectWorkItemById } = await import("../lib/approve-work-item.ts");
    try {
      await client.query(`DELETE FROM work_items WHERE title LIKE 'zz-approve%'`);
      const sends = [];
      let failNext = false;
      globalThis.__approve = {
        sendApprovedClientDraft: async (id) => {
          // The real send takes a moment; widen the window two taps could share.
          await new Promise((r) => setTimeout(r, 20));
          if (failNext) {
            failNext = false;
            return { outcome: "failed", error: "Gmail said no" };
          }
          sends.push(id);
          return { outcome: "sent", to: "client@example.test", subject: "Your estimate" };
        },
        // Same SQL as lib/approved-draft-send.ts: the gate reopens for a retry.
        reopenApprovalAfterFailedSend: async (id, error) => {
          await client.query(
            `UPDATE work_items SET approval_status = 'requested', status = 'approval_needed', blocked_reason = $2 WHERE id = $1`,
            [id, `Approved, but the send failed: ${error}`],
          );
        },
        notifyAgentOwner: async () => {},
        maybeAdvanceRunbook: async () => {},
        captureAgentMemory: async () => {},
      };
      const mk = async (title, status = "approval_needed", approval = "requested") =>
        (
          await client.query(
            `INSERT INTO work_items (title, body, status, approval_status, requires_approval) VALUES ($1, 'To: client@example.test', $2, $3, true) RETURNING id`,
            [`zz-approve ${title}`, status, approval],
          )
        ).rows[0].id;
      const stateOf = async (id) => (await client.query(`SELECT status, approval_status FROM work_items WHERE id = $1`, [id])).rows[0];

      // ── Approve after reject: refused, nothing sent, still rejected.
      const rejected = await mk("rejected draft");
      assert.equal((await rejectWorkItemById(rejected, "Telegram")).ok, true);
      const stale = await approveWorkItemById(rejected);
      assert.deepEqual(stale, { ok: false, error: "Already rejected — nothing was sent." });
      assert.deepEqual(sends, []);
      assert.deepEqual(await stateOf(rejected), { status: "cancelled", approval_status: "rejected" });
      // …even if an agent later parks it at approval_needed without a fresh draft.
      await client.query(`UPDATE work_items SET status = 'approval_needed' WHERE id = $1`, [rejected]);
      assert.equal((await approveWorkItemById(rejected)).ok, false);
      assert.deepEqual(sends, []);

      // ── Approve, then the old button again: one send.
      const once = await mk("approve twice");
      assert.deepEqual(await approveWorkItemById(once), { ok: true, sent: { to: "client@example.test", subject: "Your estimate" } });
      assert.deepEqual(await approveWorkItemById(once), { ok: false, error: "Already approved — nothing more was sent." });
      assert.deepEqual(sends, [once]);
      assert.deepEqual(await stateOf(once), { status: "queued", approval_status: "approved" });
      // A stale Decline on the sent draft changes nothing: it stays approved, not "cancelled".
      assert.deepEqual(await rejectWorkItemById(once, "Telegram"), { ok: false, error: "Already approved and sent — Decline can't take it back." });
      assert.deepEqual(await stateOf(once), { status: "queued", approval_status: "approved" });
      assert.deepEqual(await rejectWorkItemById(rejected, "Telegram"), { ok: false, error: "Already declined." });

      // ── Two (or three) taps at the same moment: exactly one goes through.
      sends.length = 0;
      const racing = [];
      for (let i = 0; i < 8; i++) racing.push(await mk(`race ${i}`));
      const results = await Promise.all(racing.flatMap((id) => [approveWorkItemById(id), approveWorkItemById(id), approveWorkItemById(id)]));
      assert.equal(results.filter((r) => r.ok).length, racing.length, "one approval per item");
      assert.equal(results.filter((r) => !r.ok).length, racing.length * 2);
      for (const r of results.filter((x) => !x.ok)) assert.equal(r.error, "Already approved — nothing more was sent.");
      assert.deepEqual([...sends].sort(), [...racing].sort(), "one send per item");

      // ── Still works where it should.
      sends.length = 0;
      const statusOnly = await mk("parked by status only", "approval_needed", "not_requested");
      assert.equal((await approveWorkItemById(statusOnly)).ok, true, "approval_needed with no request flag is on the board's Approve list");
      const doneStep = await mk("runbook step done, awaiting approval", "done", "requested");
      assert.equal((await approveWorkItemById(doneStep)).ok, true);
      assert.equal((await stateOf(doneStep)).status, "done");
      // A failed send reopens the gate, so the retry is allowed (and sends once).
      const retry = await mk("send fails then retried");
      failNext = true;
      const failed = await approveWorkItemById(retry);
      assert.equal(failed.ok, false);
      assert.match(failed.error, /did not send: Gmail said no/);
      assert.deepEqual(await stateOf(retry), { status: "approval_needed", approval_status: "requested" });
      assert.equal((await approveWorkItemById(retry)).ok, true);
      assert.deepEqual(sends, [statusOnly, doneStep, retry]);

      // ── Not waiting at all / unknown id.
      const plain = await mk("never asked", "queued", "not_requested");
      assert.deepEqual(await approveWorkItemById(plain), { ok: false, error: "This isn't waiting for approval any more — nothing was sent." });
      assert.deepEqual(await approveWorkItemById("00000000-0000-4000-8000-000000000000"), { ok: false, error: "Work item not found." });
      assert.equal(sends.length, 3);
    } finally {
      await pool.end();
    }
  });
});
