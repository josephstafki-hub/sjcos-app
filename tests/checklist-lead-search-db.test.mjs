// The checklist lead picker's real SQL (lib/checklist-coverage/lead-search-sql.ts)
// against the disposable harness database, ordered by the real orderForCall —
// exactly what lib/checklist-lead-search.ts runs (build review R3: a lead made
// a minute ago was missing from Recent leads, and "Pat" ranked a scope match
// above a name match). Runs inside a transaction that is rolled back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withTestDb } from './_harness/testdb.mjs';

const require = createRequire(import.meta.url);
const { leadSearchStatements, likeLiteral } = require('../lib/checklist-coverage/lead-search-sql.ts');
const { orderForCall } = require('../lib/checklist-coverage/lead-order.ts');

test('picker: newest created-or-contacted first, name matches above scope-only, caller first, lost hidden, no email', async () => {
  await withTestDb(async (_url, c) => {
    await c.query('BEGIN');
    try {
      // Anything already in this test database is out of the way.
      await c.query(`UPDATE leads SET stage = 'lost' WHERE stage <> 'lost'`);
      const ids = {};
      const add = async (key, name, scope, created, contacted, extra = {}) => {
        const r = await c.query(
          `INSERT INTO leads(slug, name, scope, stage, email, phone, created_at, last_contact_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() - $7::interval, CASE WHEN $8::text IS NULL THEN NULL ELSE now() - $8::interval END)
           RETURNING id`,
          [`picker-${key}`, name, scope, extra.stage ?? 'intake', `${key}@test.invalid`, extra.phone ?? null, created, contacted],
        );
        ids[key] = r.rows[0].id;
      };
      // 13 older leads, all contacted in the last two weeks.
      for (let i = 1; i <= 13; i++) await add(`older${i}`, `Older ${String(i).padStart(2, '0')}`, 'Deck', '30 days', `${i + 1} days`, i === 13 ? { phone: '+1 (612) 555-0199' } : {});
      await add('morgan', 'Morgan Reyes', 'Patio cover', '40 days', '0 seconds');
      await add('pat', 'Pat Noemail', 'Upstairs bath', '1 minute', null);          // just made for this call, never contacted
      await add('tyler', 'Tyler Lillemo', 'Backyard fenced patio', '20 days', '10 minutes');
      await add('kim', 'Kim Patel', 'Kitchen', '50 days', '3 days');
      await add('spatula', 'Spatula Jones', 'Basement', '50 days', '5 days');
      await add('lost', 'Pat Lost', 'Patio', '0 seconds', '0 seconds', { stage: 'lost' });
      const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));

      const search = async (text, callNumber = null) => {
        const s = leadSearchStatements(text, callNumber);
        const onCall = s.onCall ? (await c.query(s.onCall.sql, s.onCall.params)).rows : [];
        const found = (await c.query(s.found.sql, s.found.params)).rows;
        return orderForCall(onCall, found, s.typed);
      };
      const keys = (rows) => rows.map((r) => name[r.id]);

      // Recent leads (no text): newest created-or-contacted first.
      const recent = await search('');
      assert.equal(recent.length, 12);
      assert.deepEqual(keys(recent).slice(0, 3), ['morgan', 'pat', 'tyler'], 'the lead made a minute ago (no contact yet) is near the top, not dropped');
      assert.ok(!keys(recent).includes('lost'), 'lost leads are never offered');
      assert.ok(!keys(recent).includes('older13'), 'the oldest contact falls off the 12');
      // Only what the picker shows, and the id it links by.
      for (const r of recent) assert.deepEqual(Object.keys(r).sort(), ['id', 'name', 'on_call', 'phone', 'scope']);

      // Typed: name starts with it › a word in the name starts with it › name
      // contains it › scope only (by recency).
      assert.deepEqual(keys(await search('Pat')), ['pat', 'kim', 'spatula', 'morgan', 'tyler']);
      assert.deepEqual(keys(await search('pat')), ['pat', 'kim', 'spatula', 'morgan', 'tyler'], 'case-insensitive');
      // Wildcards are literal.
      assert.deepEqual(await search('%'), []);
      assert.deepEqual(await search('_'), []);
      assert.equal(likeLiteral('50%_off\\'), '50\\%\\_off\\\\');
      // Phone digits.
      assert.deepEqual(keys(await search('555-0199')), ['older13']);

      // The caller's own lead first and marked, even when it isn't recent.
      const onCall = await search('', '612-555-0199');
      assert.equal(onCall.length, 12);
      assert.equal(name[onCall[0].id], 'older13');
      assert.equal(onCall[0].on_call, true);
      assert.ok(onCall.slice(1).every((r) => !r.on_call));
      assert.deepEqual(keys(onCall).slice(1, 3), ['morgan', 'pat']);
      // Typed text that doesn't match the caller: not injected.
      assert.ok(!keys(await search('Pat', '612-555-0199')).includes('older13'));
    } finally {
      await c.query('ROLLBACK');
    }
  });
});
