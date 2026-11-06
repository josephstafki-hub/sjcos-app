import test from 'node:test';
import assert from 'node:assert/strict';
import {withMigrationSubset} from './_harness/testdb.mjs';
import {listMigrationFiles} from '../db/migrate.mjs';
import {capabilities} from '../lib/ask-thread-journal.mjs';
for(const [name,ids] of [['shared_canvas_phase0',[100,105]]])test(`Phase 0 ${name}: real ordered ledger, flags off, no later Canvas relations`,()=>withMigrationSubset(name,ids,async({db,apply})=>{
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

test('combined Browser matrix blocked: missing requests reject before applying any subset',()=>withMigrationSubset('blocked_combined',[100,101,102,103,104,105],async({db,apply})=>{
 await assert.rejects(apply(),/Requested migrations do not exist: 101, 102, 103, 104/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations WHERE id>=100')).rows[0].n,0);
}));

test('0106 core applies on Canvas-only prerequisites, page predeclared, no provenance FK or narrow grants',()=>withMigrationSubset('canvas_core_only',[100,105,106],async({db,apply,url})=>{
 await apply();assert.deepEqual(await capabilities(db),{thread:true,canvas:true,files:false});
 for(const t of ['ask_canvases','ask_canvas_versions','ask_canvas_requests','ask_canvas_events','ask_canvas_usage','ask_canvas_rate_windows'])assert.equal((await db.query('SELECT to_regclass($1)::text AS name',[t])).rows[0].name,t);
 for(const t of ['ask_context_provenance','ask_canvas_file_saves','ask_canvas_renders'])assert.equal((await db.query('SELECT to_regclass($1) AS name',[t])).rows[0].name,null);
 const refs=(await db.query(`SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='ask_canvas_versions'::regclass AND contype='f'`)).rows.map(r=>r.target);assert.ok(!refs.some(r=>/provenance/.test(r)));
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname='ask_canvas_maintenance'`)).rows[0].n,1);
 await apply();
}));

test('Phase 0-only event endpoint stays schema-aware even with Canvas env enabled',()=>withMigrationSubset('canvas_core_not_installed',[100,105],async({db,apply,url})=>{
 await apply();const {appHooks,seedPeople}=await import('./phase0a-fixtures.mjs');appHooks();const p=await seedPeople(db);
 const {withSessionIdentity}=await import('./_harness/testdb.mjs');const core=await import('../lib/ask-canvases.ts');const {encrypt}=await import('../lib/session.ts');
 process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='rollout-cursor-key-at-least-32-characters';const token=await encrypt({userId:p.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
 await withSessionIdentity(url,'sjcos_test_website',async c=>{globalThis.__phase0aDb=c;const page=await core.canvasEvents(p.thread,{});assert.deepEqual(page.events,[]);assert.equal(page.availability.master,false);await assert.rejects(core.canvasGet(crypto.randomUUID(),{}),/CANVAS_DISABLED/);});
}));
