import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withTestDb} from './_harness/testdb.mjs';
import {publishConsultSeed} from '../lib/consult/forms/load-seed.ts';
import {seedModules,templates,addOns,definitionChecksum} from '../lib/consult/forms/seed.ts';
import {schedule,snapshot} from '../lib/consult/protocol.ts';
test('full executable seed publishes through real attestation path, checksums pin, hidden context includes nested templates',async()=>{
 await withTestDb(async(_url,c)=>{
 await c.query("UPDATE app_settings SET value='true' WHERE key='consult_capture'");
 const owner=randomUUID(),project=randomUUID();await c.query("INSERT INTO users(id,email,password_hash,name,role) VALUES($1,$2,'x','Owner','owner')",[owner,`${owner}@test`]);await c.query("INSERT INTO projects(id,slug,name) VALUES($1,$2,'Test')",[project,project]);
 await c.query("INSERT INTO consult_context_keys(key_id,secret) VALUES('seed', $1)",[Buffer.alloc(32,4)]);
 const context=async(operation,target=null)=>(await c.query("SELECT consult_mint_context($1,'seed') v",[{kind:'in_home_consult',sub:owner,role:'owner',areas:['projects'],mode:'person',operation,consult_id:target,iat:Date.now()/1000,exp:Date.now()/1000+120,run_id:randomUUID(),nonce:randomUUID()}])).rows[0].v;
 await c.query('BEGIN');const result=await publishConsultSeed(c,await context('publish_form'),owner);await c.query('COMMIT');assert.equal(result.published,seedModules.length+10);
 const forms=(await c.query("SELECT * FROM consult_form_versions WHERE status='published'")).rows;assert.equal(forms.length,result.published);
 for(const form of forms)assert.equal(form.checksum,await definitionChecksum(form.definition));
 assert.equal((await c.query('SELECT count(*)::int n FROM consult_publication_validations')).rows[0].n,result.published);
 assert.equal((await publishConsultSeed(c,await context('publish_form'),owner)).published,0);
 const ids=forms.filter(f=>f.kind==='module'||['whole','bath','kitchen'].includes(f.key)).map(f=>f.id);
 const {id}=await schedule(c,await context('schedule'),{project,visit_time:'2026-12-01T09:00:00-06:00',visitor:owner,forms:ids});
 const s=await snapshot(c,await context('read',id),id);assert.deepEqual(s.heads.find(a=>a.field_key==='templates').value.sort(),['bath','kitchen','whole']);
 },{fresh:true});
});
