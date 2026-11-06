import {startCluster,dbUrl,withSessionIdentity} from './_harness/testdb.mjs';
import { registerHooks } from 'node:module';
import { statSync } from 'node:fs';
const root=new URL('../',import.meta.url);
export function appHooks() {
 registerHooks({resolve(s,c,n){
  if(s==='@/lib/db')return {url:'phase0a:db',shortCircuit:true};
  if(s==='server-only')return {url:'phase0a:empty',shortCircuit:true};
  if(s==='next/headers')return {url:'phase0a:headers',shortCircuit:true};
  if(s.startsWith('@/') || (/^\.\.?\//.test(s)&&c.parentURL?.endsWith('.ts')&&!/\.[cm]?[jt]s$/.test(s))){
   const base=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);
   for(const ext of ['', '.ts','.mjs'])try{if(statSync(new URL(base.href+ext)).isFile())return {url:base.href+ext,shortCircuit:true};}catch{}
  }return n(s,c);
 },load(u,c,n){
  if(u==='phase0a:db')return {format:'module',source:'export const pool={query:(...a)=>globalThis.__phase0aDb.query(...a),connect:async()=>({query:(...a)=>globalThis.__phase0aDb.query(...a),release(){}})};',shortCircuit:true};
  if(u==='phase0a:empty')return {format:'module',source:'export {};',shortCircuit:true};
  if(u==='phase0a:headers')return {format:'module',source:'export const cookies=async()=>globalThis.__phase0aCookies; export const headers=async()=>new Headers(globalThis.__phase0aHeaders);',shortCircuit:true};
  return n(u,c);
 }});
}
export async function seedPeople(c){
 const rows=[];
 for(const [role,perms] of [['owner',[]],['staff',['ai']],['staff',[]],['client',[]]])rows.push((await c.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'ZZ phase0a',$2,$3,'unused','ZZ') RETURNING *`,[`zz-phase0a-${role}-${rows.length}-${crypto.randomUUID()}@example.test`,role,perms])).rows[0]);
 const privacy=(await c.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='ai_conversations' AND column_name='owner_user_id') AS yes`)).rows[0].yes;
 const seed=async db=>{
  const thread=(await db.query(privacy?`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','ZZ Phase0a',$1) RETURNING id`:`INSERT INTO ai_conversations(agent,title) VALUES('claude','ZZ Phase0a') RETURNING id`,privacy?[rows[0].id]:[])).rows[0].id;
  if(privacy)await db.query(`UPDATE ask_canvas_maintenance SET recovery_ready=true`);return thread;
 };
 const identity=(await c.query(`SELECT session_user,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='dev_agent_runs'::regclass`)).rows[0];
 const state=startCluster();
 if(c.connectionParameters.host!==state.dir||Number(c.connectionParameters.port)!==state.port)throw Error('fixture requires its disposable cluster');
 const thread=identity.owner==='sjcos_test_website'&&identity.session_user!==identity.owner?await withSessionIdentity(dbUrl(state.url,c.connectionParameters.database),'sjcos_test_website',seed):await seed(c);
 return {owner:rows[0],staff:rows[1],noAi:rows[2],client:rows[3],thread};
}
