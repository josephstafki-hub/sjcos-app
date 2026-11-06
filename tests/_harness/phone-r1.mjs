import {registerHooks} from 'node:module';
import {statSync} from 'node:fs';
import {withTestDb} from './testdb.mjs';
const root=new URL('../../',import.meta.url);
registerHooks({resolve(s,c,next){
 if(['server-only','next/cache','next/headers'].includes(s))return {url:'phone-framework:'+s,shortCircuit:true};
 if(s.startsWith('@/')||s.startsWith('.')&&c.parentURL?.startsWith('file:')&&!/\.[cm]?[jt]sx?$/.test(s)){
 const base=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);
 for(const ext of ['', '.ts','.mjs','/index.ts'])try{if(statSync(new URL(base.href+ext)).isFile())return {url:base.href+ext,shortCircuit:true};}catch{}
 }
 if(s.startsWith('next/')&&!s.endsWith('.js'))try{return next(s,c);}catch{return next(s+'.js',c);}
 return next(s,c);
},load(u,c,next){if(u.startsWith('phone-framework:'))return {format:'module',shortCircuit:true,source:u.endsWith('next/cache')?'export const revalidatePath=()=>{};':u.endsWith('next/headers')?'export const cookies=async()=>({get:()=>undefined});export const headers=async()=>new Headers();':''};return next(u,c);}});
export async function setup(){
 let db;await withTestDb(async url=>{process.env.DATABASE_URL=url;process.env.TELEGRAM_BOT_TOKEN='test';process.env.TELEGRAM_OWNER_CHAT_ID='549900123';process.env.TELEGRAM_WEBHOOK_SECRET='test-secret';db=await import('../../lib/db.ts');});
 const run=async(s,p)=>(await db.query(s,p)).rows;
 // withTestDb supplies a fresh database per file/process. Do not TRUNCATE
 // users CASCADE: Phase 0 intentionally forbids truncating Browser evidence.
 const [owner]=await run(`INSERT INTO users(email,password_hash,name,role,initials) VALUES($1,'x','Joe Stafki','owner','JS') RETURNING *`,[`zz-phone-${crypto.randomUUID()}@example.test`]);
 const {encrypt}=await import('../../lib/session.ts');const bearer=await encrypt({userId:owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});
 const api=await import('../../app/api/mobile/push/[...path]/route.ts');
 const call=async(method,path,body,auth=bearer)=>{const r=await api[method](new Request(`http://local/api/mobile/push/${path}`,{method,headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:path.split('/')})});return {status:r.status,body:await r.json()};};
 const {defaultTransport}=await import('../../lib/providers/telegram.ts');
 defaultTransport.call=async(method,body)=>{(globalThis.phoneTelegramCalls??=[]).push({method,body});return {ok:true,status:200,result:{message_id:++globalThis.phoneTelegramSeq}};};globalThis.phoneTelegramSeq=800000;
 const push=await import('../../lib/phone-push.ts');await push.savePushSettings({app:true,telegram:true});
 const action=(m,verb,text,actionId=crypto.randomUUID())=>call('POST','action',{messageId:m.id,action:verb,text,actionId});
 const decision=async()=>{const [d]=await run(`INSERT INTO decisions(kind,title,action,target_kind,target_id,summary,content_hash,expires_at) VALUES('decision','Review layout','qa.review','project','qa','{}',$1,now()+interval '1 day') RETURNING *`,[crypto.randomUUID().replaceAll('-','')]);const m=await push.recordAppMessage({kind:'decision',title:d.title,telegram:{decisionId:d.id}});return {d,m};};
 const draft=async()=>{const [w]=await run(`INSERT INTO work_items(title,body,approval_status,status,source_kind,created_by) VALUES('Review internal checklist','Confirm stock','requested','approval_needed','agent','qa') RETURNING *`);const m=await push.recordAppMessage({kind:'decision',title:w.title,telegram:{workItemId:w.id}});return {w,m};};
 return {db,run,owner,bearer,call,action,decision,draft,...push};
}
