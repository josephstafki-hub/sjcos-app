import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {startCluster,stopCluster,loadSchema,ensureDbRoles} from './_harness/testdb.mjs';
test('consult migrations bootstrap without narrow roles; file policy survives later provisioning',async()=>{
 const state=startCluster();const c=new pg.Client({connectionString:state.url});
 try {await c.connect();assert.equal((await c.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='sjcos_agent'")).rows[0].n,0);
 await loadSchema(state.url);ensureDbRoles(state);
 assert.equal((await c.query("SELECT polroles::text roles FROM pg_policy WHERE polname='generic_attachment_rows'")).rows[0].roles,'{0}');
 await c.query('SET ROLE sjcos_agent');await assert.rejects(c.query('SELECT * FROM consult_upload_parts'),/permission denied/);await c.query('RESET ROLE');
 }finally{await c.end();stopCluster();}
});
