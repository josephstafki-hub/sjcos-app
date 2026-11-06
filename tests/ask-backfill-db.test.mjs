import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withMigrationSubset} from './_harness/testdb.mjs';
// A1.2: expectations written before changing 0105. Case 30 is now normative.
for(const owners of [0,1,2])test(`creator-evidence backfill with ${owners} active owners`,()=>withMigrationSubset(`creator_${owners}`,[100,105],async({db,apply})=>{
 const person=async(role,active=true)=>(await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials,active) VALUES($1,'Creator',$2,ARRAY['ai'],'x','C',$3) RETURNING id`,[randomUUID()+'@example.test',role,active])).rows[0].id;
 const own=[];for(let i=0;i<owners;i++)own.push(await person('owner'));
 const a=await person('staff'),b=await person('staff'),inactive=await person('staff',false);
 const cases=[['staff',[a,a,null],a],['mixed',[a,b],null],['inactive',[inactive],null],['no_principals',[null],owners===1?own[0]:null],['no_runs',[],owners===1?own[0]:null]];
 if(owners)cases.push(['owner',[own[0],null],own[0]]);
 const folder=(await db.query(`INSERT INTO ai_folders(name) VALUES('legacy folder') RETURNING id`)).rows[0].id;
 const rows=[];
 for(const [title,principals,expected] of cases){
  const id=(await db.query(`INSERT INTO ai_conversations(agent,title,folder_id) VALUES('claude',$1,$2) RETURNING id`,[title,folder])).rows[0].id;
  for(const p of principals)await db.query(`INSERT INTO dev_agent_runs(prompt,conversation_id,principal_user_id) VALUES('historical',$1,$2)`,[id,p]);
  rows.push([id,expected]);
 }
 // Existing non-null ownership must survive even contradictory creator evidence.
 await db.query('ALTER TABLE ai_conversations ADD COLUMN owner_user_id uuid REFERENCES users(id)');
 const existing=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','existing',$1) RETURNING id`,[b])).rows[0].id;
 await db.query(`INSERT INTO dev_agent_runs(prompt,conversation_id,principal_user_id) VALUES('historical',$1,$2)`,[existing,a]);rows.push([existing,b]);
 await apply();
 assert.equal((await db.query('SELECT folder_id FROM ai_conversations WHERE id=$1',[rows[0][0]])).rows[0].folder_id,null);
 for(const [id,expected] of rows)assert.equal((await db.query('SELECT owner_user_id FROM ai_conversations WHERE id=$1',[id])).rows[0].owner_user_id,expected);
}));
