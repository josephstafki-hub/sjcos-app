// Least-privilege database logins (deploy/db-roles.md): the migrated database
// must grant exactly what deploy/db-roles.manifest.json says, every table must
// be in the manifest, every trigger function must run as its owner, and the
// hidden tables / approvals must really be out of a narrow login's reach.
//
// When this fails it tells you what to do. The usual case — you added a table:
// add it to the manifest and put the line `node scripts/db-roles-sql.mjs <table>`
// prints into the same migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, DB_ROLES } from "./_harness/testdb.mjs";
import { grantLines, loadManifest } from "../scripts/db-roles-sql.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const manifest = loadManifest();
const PRIVS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);

/** "SELECT(a,b)" → { priv: "SELECT", cols: ["a","b"] }; "UPDATE" → { priv, cols: null } */
function parsePriv(p) {
  const m = /^(\w+)(?:\(([^)]*)\))?$/.exec(p);
  return m ? { priv: m[1], cols: m[2] ? m[2].split(",").map((c) => c.trim()).sort() : null } : null;
}

const howToFix = (t) =>
  `Put it in deploy/db-roles.manifest.json and add the GRANT line to your migration — \`node scripts/db-roles-sql.mjs ${t}\` prints it. ` +
  `Agents (sjcos_agent) need read/write if an MCP tool touches it; the worker (sjcos_worker) if dispatch / Square / Telnyx / e-sign / wakeups do; ` +
  `sjcos_readonly reads every non-secret table. See deploy/db-roles.md.`;

test("the manifest is well-formed", () => {
  assert.ok(manifest.tables && typeof manifest.tables === "object");
  for (const [t, entry] of Object.entries(manifest.tables)) {
    for (const [k, v] of Object.entries(entry)) {
      if (k === "note") continue;
      assert.ok(DB_ROLES.includes(k), `deploy/db-roles.manifest.json: ${t} names unknown login "${k}" (known: ${DB_ROLES.join(", ")})`);
      assert.ok(Array.isArray(v), `${t}.${k} must be a list of privileges`);
      for (const p of v) {
        const parsed = parsePriv(p);
        assert.ok(parsed && PRIVS.has(parsed.priv), `${t}.${k}: "${p}" is not SELECT / INSERT / UPDATE / DELETE (optionally with (columns))`);
      }
    }
    if (!DB_ROLES.some((r) => entry[r]?.length)) {
      assert.ok(entry.note, `${t} grants nothing to anyone: say why in its "note"`);
    }
  }
  // the generator handles every entry
  assert.ok(grantLines(manifest, Object.keys(manifest.tables)).length > 0);
});

test("every table is in the manifest and the database grants exactly what it says", { skip }, async () => {
  await withTestDb(
    async (_url, client) => {
      const rels = (
        await client.query(
          `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') ORDER BY 1`,
        )
      ).rows.map((r) => r.relname);
      const problems = [];
      for (const t of rels) {
        if (!manifest.tables[t]) problems.push(`Table ${t} is new and deploy/db-roles.manifest.json doesn't list it. ${howToFix(t)}`);
      }
      for (const t of Object.keys(manifest.tables)) {
        if (!rels.includes(t)) problems.push(`deploy/db-roles.manifest.json lists ${t}, but no such table or view exists: remove it (renamed? move its entry).`);
      }

      // Direct grants only (sjcos_backup's pg_read_all_data is a role membership, not an ACL entry).
      const tableAcl = (
        await client.query(
          `SELECT c.relname AS t, r.rolname AS role, a.privilege_type AS priv
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(c.relacl) a
             JOIN pg_roles r ON r.oid = a.grantee
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') AND r.rolname = ANY($1)`,
          [DB_ROLES],
        )
      ).rows;
      const colAcl = (
        await client.query(
          `SELECT c.relname AS t, r.rolname AS role, a.privilege_type AS priv, att.attname AS col
             FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(att.attacl) a
             JOIN pg_roles r ON r.oid = a.grantee
            WHERE n.nspname = 'public' AND att.attnum > 0 AND NOT att.attisdropped AND r.rolname = ANY($1)`,
          [DB_ROLES],
        )
      ).rows;
      const fmt = (privs) => (privs.length ? privs.join(", ") : "nothing");
      for (const t of rels) {
        const entry = manifest.tables[t];
        if (!entry) continue;
        for (const role of DB_ROLES) {
          const want = (entry[role] ?? []).map(parsePriv);
          const wantTable = want.filter((p) => !p.cols).map((p) => p.priv).sort();
          const wantCols = Object.fromEntries(want.filter((p) => p.cols).map((p) => [p.priv, p.cols]));
          const haveTable = [...new Set(tableAcl.filter((a) => a.t === t && a.role === role && PRIVS.has(a.priv)).map((a) => a.priv))].sort();
          const haveColPrivs = {};
          for (const a of colAcl.filter((a) => a.t === t && a.role === role)) (haveColPrivs[a.priv] ??= []).push(a.col);
          for (const k of Object.keys(haveColPrivs)) haveColPrivs[k].sort();
          const extraTable = tableAcl.filter((a) => a.t === t && a.role === role && !PRIVS.has(a.priv)).map((a) => a.priv);
          const same =
            JSON.stringify(wantTable) === JSON.stringify(haveTable) &&
            JSON.stringify(Object.entries(wantCols).sort()) === JSON.stringify(Object.entries(haveColPrivs).sort()) &&
            extraTable.length === 0;
          if (!same) {
            const have = [...haveTable, ...extraTable, ...Object.entries(haveColPrivs).map(([p, c]) => `${p}(${c.join(",")})`)];
            problems.push(
              `Table ${t}: the database gives ${role} ${fmt(have)}, deploy/db-roles.manifest.json says ${fmt(entry[role] ?? [])}. ` +
                `Make the manifest and your migration agree — \`node scripts/db-roles-sql.mjs ${t}\` prints the manifest's lines (a narrowed grant also needs a REVOKE).`,
            );
          }
        }
      }

      // INSERT needs the table's id sequence.
      const seqs = (
        await client.query(
          `SELECT t.relname AS t, s.relname AS seq,
                  array(SELECT r.rolname FROM aclexplode(s.relacl) a JOIN pg_roles r ON r.oid = a.grantee WHERE a.privilege_type = 'USAGE') AS usage
             FROM pg_depend d
             JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
             JOIN pg_class t ON t.oid = d.refobjid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND d.deptype IN ('a','i')`,
        )
      ).rows;
      for (const { t, seq, usage } of seqs) {
        for (const role of DB_ROLES) {
          const inserts = (manifest.tables[t]?.[role] ?? []).includes("INSERT");
          if (inserts && !usage.includes(role)) problems.push(`Table ${t}: ${role} may INSERT but not use its sequence ${seq} — grant it with sjcos_grant(...) (it adds the sequence) instead of a bare GRANT.`);
        }
      }

      assert.deepEqual(problems, [], `\n${problems.join("\n\n")}\n`);
    },
    { fresh: true },
  );
});

test("trigger functions run as their owner (so a narrow login's write can still update what the trigger maintains)", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const fns = (
      await client.query(
        `SELECT p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS config
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
      )
    ).rows;
    assert.ok(fns.length > 5, "expected the schema's trigger functions");
    const invoker = manifest.invoker_trigger_functions ?? {};
    const problems = [];
    for (const f of fns) {
      if (invoker[f.proname]) {
        if (f.prosecdef) problems.push(`${f.sig} is listed in invoker_trigger_functions but is SECURITY DEFINER: it would no longer see who made the write.`);
        continue;
      }
      if (!f.prosecdef || !/search_path=/.test(f.config)) {
        problems.push(
          `Trigger function ${f.sig} runs as whoever made the write, so a write by sjcos_agent / sjcos_worker fails as soon as it touches a table they can't. ` +
            `Add to your migration: ALTER FUNCTION ${f.sig} SECURITY DEFINER SET search_path = public, pg_temp;`,
        );
      }
    }
    assert.deepEqual(problems, [], `\n${problems.join("\n\n")}\n`);
  });
});

/** Run `fn(run)` in a transaction as `role`, rolled back afterwards. */
async function asRole(client, role, fn) {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn(async (sql, params) => (await client.query(sql, params)).rows);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function refused(client, role, sql, params = []) {
  try {
    await asRole(client, role, (run) => run(sql, params));
  } catch (e) {
    return e.code;
  }
  return null;
}

test("hidden stays hidden: no users table, no passwords, no mailbox tokens, no secret settings for a narrow login", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('clip.token', 'zz-secret'), ('zz.visible', 'ok') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    try {
      for (const role of ["sjcos_agent", "sjcos_worker", "sjcos_readonly"]) {
        assert.equal(await refused(client, role, `SELECT * FROM users`), "42501", `${role}: SELECT * FROM users must be refused`);
        assert.equal(await refused(client, role, `SELECT password_hash FROM users`), "42501", `${role}: password hashes must be refused`);
        assert.equal(await refused(client, role, `SELECT * FROM user_email_accounts`), "42501", `${role}: mailbox tokens must be refused`);
        assert.equal(await refused(client, role, `SELECT id, name, role FROM users`), null, `${role}: who's who (id/name/role) stays readable`);
        const keys = await asRole(client, role, (run) => run(`SELECT key FROM app_settings WHERE key IN ('clip.token', 'zz.visible')`));
        assert.deepEqual(keys.map((k) => k.key), ["zz.visible"], `${role}: *.token settings are hidden by row security`);
        for (const [t, sql] of [
          ["users", `UPDATE users SET role = 'owner'`],
          ["policies", `UPDATE policies SET state = 'active'`],
          ["lane_pauses", `DELETE FROM lane_pauses`],
          ["authority_grants", `INSERT INTO authority_grants (user_id, action_type) VALUES (gen_random_uuid(), 'x')`],
          ["app_settings", `UPDATE app_settings SET value = '0' WHERE key = 'estimate.default_markup'`],
        ]) {
          assert.equal(await refused(client, role, sql), "42501", `${role} must not write ${t}`);
        }
      }
      // the owner (this superuser here, sjcos in production) still sees everything
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM app_settings WHERE key = 'clip.token'`)).rows[0].n, 1);
    } finally {
      await client.query(`DELETE FROM app_settings WHERE key IN ('clip.token', 'zz.visible')`);
    }
  });
});

test("agents and workers request; only Joe approves (decisions, owner grants, skills, memories)", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const [d] = (await client.query(`INSERT INTO decisions (kind, action, title) VALUES ('other', 'zz_action', 'ZZ guard') RETURNING id`)).rows;
    const [g] = (await client.query(`INSERT INTO owner_grants (actions, reason) VALUES ('{send_email}', 'zz-guard') RETURNING id`)).rows;
    const [ok] = (await client.query(`INSERT INTO owner_grants (actions, reason, status) VALUES ('{send_email}', 'zz-guard-ok', 'approved') RETURNING id`)).rows;
    const [s] = (await client.query(`INSERT INTO skills (slug, title, review_status) VALUES ('zz-guard-skill', 'ZZ', 'proposed') RETURNING id`)).rows;
    const [m] = (await client.query(`INSERT INTO agent_memories (content) VALUES ('zz guard memory') RETURNING id`)).rows;
    try {
      for (const role of ["sjcos_agent", "sjcos_worker"]) {
        const deny = async (sql, params, what) => assert.equal(await refused(client, role, sql, params), "42501", `${role} must not ${what}`);
        await deny(`UPDATE decisions SET status = 'approved' WHERE id = $1`, [d.id], "approve a decision");
        await deny(`INSERT INTO decisions (kind, action, title, status) VALUES ('other', 'zz', 'ZZ', 'approved')`, [], "insert an approved decision");
        await deny(`INSERT INTO owner_grants (actions, reason, status) VALUES ('{send_email}', 'zz-x', 'approved')`, [], "insert an approved owner grant");
        await deny(`UPDATE skills SET review_status = 'approved' WHERE id = $1`, [s.id], "approve a skill");
        await deny(`UPDATE agent_memories SET review_status = 'approved' WHERE id = $1`, [m.id], "approve a memory");
        await deny(`UPDATE agent_memories SET can_use_as_instruction = true WHERE id = $1`, [m.id], "turn a memory into an instruction");
        // what they may do
        if (role === "sjcos_agent") {
          assert.equal(await refused(client, role, `INSERT INTO decisions (kind, action, title) VALUES ('other', 'zz', 'ZZ pending')`), null, "an agent may stage a pending decision");
          assert.equal(await refused(client, role, `UPDATE decisions SET status = 'superseded' WHERE id = $1`, [d.id]), null, "an agent may supersede its card");
        }
        if (role === "sjcos_worker") {
          assert.equal(await refused(client, role, `UPDATE owner_grants SET uses = uses + 1, used_at = now() WHERE id = $1`, [ok.id]), null, "the dispatcher spends an approved grant");
          assert.equal(await refused(client, role, `UPDATE owner_grants SET status = 'approved' WHERE id = $1`, [g.id]), "42501", "the dispatcher cannot approve one");
          assert.equal(await refused(client, role, `UPDATE owner_grants SET expires_at = expires_at + interval '1 day' WHERE id = $1`, [ok.id]), "42501", "or extend one");
        }
      }
      // Joe's own login approves as before.
      await client.query(`UPDATE decisions SET status = 'approved' WHERE id = $1`, [d.id]);
      await client.query(`UPDATE owner_grants SET status = 'approved' WHERE id = $1`, [g.id]);
    } finally {
      await client.query(`DELETE FROM decisions WHERE action IN ('zz_action', 'zz')`);
      await client.query(`DELETE FROM owner_grants WHERE reason LIKE 'zz-guard%'`);
      await client.query(`DELETE FROM skills WHERE slug = 'zz-guard-skill'`);
      await client.query(`DELETE FROM agent_memories WHERE content = 'zz guard memory'`);
    }
  });
});

test("sjcos_grant is a no-op with a notice while a login does not exist (fresh databases, before the bootstrap)", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const notices = [];
    const onNotice = (n) => notices.push(n.message);
    client.on("notice", onNotice);
    try {
      await client.query(`SELECT sjcos_grant('sjcos_nobody_zz', 'SELECT, INSERT', 'work_items')`);
    } finally {
      client.off("notice", onNotice);
    }
    assert.ok(notices.some((m) => /sjcos_nobody_zz does not exist yet/.test(m)), notices.join("\n"));
    await assert.rejects(client.query(`SELECT sjcos_grant('sjcos_agent', 'ALL; DROP TABLE x', 'work_items')`), /unexpected privilege list/);
  });
});
