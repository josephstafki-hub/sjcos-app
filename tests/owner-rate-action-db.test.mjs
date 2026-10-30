// A19 (Tier 3): Joe sets his labour rate on /time; it lands as an approved
// owner_rate decision and a dated owner_labor_rates row that values his
// verified hours. Session, cache and the timer server are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { txOver } from "./_fixtures-procurement.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const root = new URL("../", import.meta.url);
const STUBS = {
  "server-only": [],
  "next/cache": ["revalidatePath"],
  "@/lib/dal": ["requireRole"],
  "@/lib/commands/db": ["withTransaction", "userPrincipal"],
  [new URL("lib/owner-time/server.ts", root).href]: ["timerAction"],
};
registerHooks({
  resolve(specifier, context, next) {
    let url = null;
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), root).href;
      for (const ext of ["", ".ts", ".mjs"]) {
        try {
          if (statSync(new URL(base + ext)).isFile()) { url = base + ext; break; }
        } catch {
          /* next */
        }
      }
    } else if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      url = new URL(`${specifier}.ts`, context.parentURL).href;
    }
    const key = Object.hasOwn(STUBS, specifier) ? specifier : url;
    if (key && Object.hasOwn(STUBS, key)) return { url: `stub:${key}`, shortCircuit: true };
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const names = STUBS[url.slice("stub:".length)];
    return { format: "module", source: names.map((n) => `export const ${n} = (...a) => globalThis.__rate.${n}(...a);`).join("\n"), shortCircuit: true };
  },
});

test("Save rate: an approved owner_rate decision and a dated rate that values verified hours", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await client.query(`DELETE FROM owner_labor_rates`);
    const [u] = (await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-rate@example.test','x','Joe','owner','J') RETURNING id`)).rows;
    globalThis.__rate = {
      revalidatePath: () => {},
      requireRole: async () => ({ id: u.id, role: "owner", name: "Joe", permissions: [], linkSlug: null }),
      withTransaction: txOver(url),
      userPrincipal: (x) => ({ kind: "user", userId: x.id, role: x.role, name: x.name, permissions: [], linkSlug: null }),
      timerAction: async () => ({ ok: true, applied: true }),
    };
    const { setLaborRateAction } = await import("../lib/owner-time/actions.ts");
    assert.equal((await setLaborRateAction("site", "abc", "2026-10-01")).ok, false);
    const r = await setLaborRateAction("site", "$85", "2026-10-01");
    assert.equal(r.ok, true, r.error);
    const [rate] = (await client.query(`SELECT r.rate_cents, r.effective_from::text AS f, d.kind, d.status FROM owner_labor_rates r JOIN decisions d ON d.id = r.decision_id`)).rows;
    assert.deepEqual([rate.rate_cents, rate.f, rate.kind, rate.status], [8500, "2026-10-01", "owner_rate", "approved"]);
    // Same date again (a correction) replaces the rate, still one row.
    assert.equal((await setLaborRateAction("site", "90", "2026-10-01")).ok, true);
    const rows = (await client.query(`SELECT rate_cents FROM owner_labor_rates`)).rows;
    assert.deepEqual(rows.map((x) => x.rate_cents), [9000]);
  });
});
