import test from 'node:test';
import assert from 'node:assert/strict';
import {withMigrationSubset} from './_harness/testdb.mjs';
import {listMigrationFiles} from '../db/migrate.mjs';
import {capabilities} from '../lib/ask-thread-journal.mjs';
for(const [name,ids] of [['combined',[100,101,102,103,104,105]],['canvas_only',[100,105]]])test(`Phase 0 ${name}: real ordered ledger, flags off, no later Canvas relations`,()=>withMigrationSubset(name,ids,async({db,apply})=>{
 for(const k of ['SJC_CANVAS_ENABLED'])process.env[k]='0';
 await apply();
 assert.deepEqual(await capabilities(db),{thread:true,canvas:false,files:false});
 for(const table of ['ask_canvases','ask_canvas_versions','ask_canvas_saves','ask_context_provenance'])assert.equal((await db.query('SELECT to_regclass($1) AS name',[table])).rows[0].name,null);
 const recorded=(await db.query('SELECT id,checksum FROM schema_migrations WHERE id>=100 ORDER BY id')).rows;
 const expected=listMigrationFiles().filter(f=>ids.includes(f.id));
 assert.deepEqual(recorded.map(r=>[r.id,r.checksum]),expected.map(f=>[f.id,f.checksum]));
 await apply(); // checksum replay, not duplicate DDL
 assert.equal((await db.query('SELECT recovery_ready FROM ask_canvas_maintenance')).rows[0].recovery_ready,false);
}));
test('0105 without 0100 rolls back atomically, then additive 0100+0105 succeeds',()=>withMigrationSubset('missing_shared',[105],async({db,apply})=>{
 await assert.rejects(apply(),/requires shared migration 0100/);
 assert.equal((await db.query(`SELECT to_regclass('ask_canvas_maintenance') AS name`)).rows[0].name,null);
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='ai_conversations' AND column_name='owner_user_id'`)).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations WHERE id=105')).rows[0].n,0);
 await apply([100,105]);assert.equal((await capabilities(db)).thread,true);
 // Add every presently available Browser/Canvas migration, checksummed normally.
 await apply(listMigrationFiles().filter(f=>f.id>=100&&f.id<=109).map(f=>f.id));
}));
