/** Called by the migration runner and after first owner bootstrap. Owner connection only. */
import {randomUUID} from 'node:crypto';
import {publishConsultSeed} from '../lib/consult/forms/load-seed.ts';
export async function seedConsult(client){
 const owner=(await client.query("SELECT id FROM users WHERE active AND role='owner' ORDER BY created_at,id LIMIT 1")).rows[0];
 if(!owner)return {pending:'owner_bootstrap'};
 await client.query('BEGIN');try{
 await client.query('SELECT pg_advisory_xact_lock(7263079)');

 await client.query("INSERT INTO consult_context_keys(key_id,secret) SELECT 'consult-bootstrap-v1',gen_random_bytes(32) WHERE NOT EXISTS(SELECT 1 FROM consult_context_keys WHERE revoked_at IS NULL) ON CONFLICT DO NOTHING");
 const key=(await client.query('SELECT key_id FROM consult_context_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0].key_id;
 const context=(await client.query('SELECT consult_mint_context($1,$2) v',[{kind:'in_home_consult',sub:owner.id,role:'owner',areas:['projects'],mode:'person',operation:'publish_form',consult_id:null,iat:Date.now()/1000,exp:Date.now()/1000+120,run_id:randomUUID(),nonce:randomUUID()},key])).rows[0].v;
 const result=await publishConsultSeed(client,context,owner.id);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
