import { connect, type ClientHttp2Session } from 'node:http2';
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { destination } from '../mobile-rpc/destinations.ts';

export type PushCategory = 'SJC_DECISION'|'SJC_DECISION_SEND'|'SJC_GRANT_SEND'|'SJC_DRAFT_SEND'|'SJC_DRAFT'|'SJC_GRANT'|'SJC_REPLY'|'SJC_INFO';
export interface AppAlert {
 state?:'open'|'decided'|'info'; id:string; kind:string; title:string; body?:string|null; href?:string|null;
 thread_key:string; category:PushCategory; content_hash?:string|null; sends:boolean;
 decision_id?:string|null; work_item_id?:string|null; grant_id?:string|null;
}
export function approvalKey(m:AppAlert):string|null {
 return m.work_item_id ? `work_item:${m.work_item_id}` : m.decision_id ? `decision:${m.decision_id}` : m.grant_id ? `grant:${m.grant_id}` : null;
}
export function categoryFor(m:{kind:string;decision_id?:string|null;work_item_id?:string|null;sends?:boolean}):PushCategory {
 if(m.work_item_id)return m.sends?'SJC_DRAFT_SEND':'SJC_DRAFT';
 if(m.decision_id)return m.kind==='grant'?(m.sends?'SJC_GRANT_SEND':'SJC_GRANT'):(m.sends?'SJC_DECISION_SEND':'SJC_DECISION');
 return ['portal_message','reply','ack'].includes(m.kind)?'SJC_REPLY':'SJC_INFO';
}
export function buildPushPayload(m:AppAlert,badge:number) {
 const key=approvalKey(m),href=m.href||'/notifications';
 const payload={aps:{alert:{title:m.title.replace(/^(?:\[SJC OS\]\s*|Approve:\s*)+/gi,''),body:m.body??''},sound:'default',badge,'thread-id':m.thread_key,category:m.category},sjc:{v:1,messageId:m.id,kind:m.kind,href,dest:destination(href,key),approvalKey:key,contentHash:m.content_hash??null,sends:m.sends}};
 // Unicode safe; measure actual UTF-8 JSON bytes, including destinations.
 while(Buffer.byteLength(JSON.stringify(payload))>4096 && payload.aps.alert.body.length>1)payload.aps.alert.body=Array.from(payload.aps.alert.body).slice(0,-40).join('').replace(/…$/,'')+'…';
 if(Buffer.byteLength(JSON.stringify(payload))>4096)throw new Error('Alert metadata exceeds Apple’s message limit.');
 return payload;
}
let cached:{key:string;token:string;until:number}|undefined;
export function providerJwt(now=Date.now()):string {
 const key=[process.env.APNS_KEY_PATH,process.env.APNS_KEY_ID,process.env.APNS_TEAM_ID].join(':');
 if(cached?.key===key && cached.until>now)return cached.token;
 const header=Buffer.from(JSON.stringify({alg:'ES256',kid:process.env.APNS_KEY_ID})).toString('base64url');
 const claims=Buffer.from(JSON.stringify({iss:process.env.APNS_TEAM_ID??'B98Y8U657X',iat:Math.floor(now/1000)})).toString('base64url');
 const input=`${header}.${claims}`;
 const signature=sign('sha256',Buffer.from(input),{key:createPrivateKey(readFileSync(process.env.APNS_KEY_PATH!)),dsaEncoding:'ieee-p1363'}).toString('base64url');
 cached={key,token:`${input}.${signature}`,until:now+50*60_000};return cached.token;
}
export const fakeApnsDeliveries:Array<{tokenSuffix:string;payload:unknown}>=[];
export function apnsConfigured():boolean {return process.env.SJC_OUTBOUND_DISABLED==='1'||Boolean(process.env.APNS_API_BASE||process.env.APNS_KEY_PATH&&process.env.APNS_KEY_ID);}
const sessions=new Map<string,ClientHttp2Session>();
export function closeApnsSessions() {for(const s of sessions.values())s.destroy();sessions.clear();}
function sessionFor(base:string) {
 const prior=sessions.get(base);if(prior&&!prior.closed&&!prior.destroyed)return prior;
 const s=connect(base);sessions.set(base,s);s.unref();
 const retire=()=>{if(sessions.get(base)===s)sessions.delete(base);s.close();};
 s.on('goaway',retire);s.on('error',retire);s.on('close',()=>{if(sessions.get(base)===s)sessions.delete(base);});
 s.setTimeout(60_000,()=>{retire();s.destroy();});
 return s;
}
export async function sendApns(device:{token:string;environment:string},payload:unknown,opts:{silent?:boolean;collapseId?:string}={}):Promise<{disabledReason?:string;fake?:boolean}> {
 if(process.env.SJC_OUTBOUND_DISABLED==='1'){fakeApnsDeliveries.push({tokenSuffix:device.token.slice(-6),payload});return {fake:true};}
 const base=process.env.APNS_API_BASE??(device.environment==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');
 if(process.env.APNS_API_BASE&&process.env.NODE_ENV==='production')throw new Error('APNs test origins are disabled in production.');
 const headers:Record<string,string>={':method':'POST',':path':`/3/device/${device.token}`,'apns-topic':process.env.APNS_TOPIC??'com.sjcarpentryllc.sjcos','apns-push-type':opts.silent?'background':'alert','apns-priority':opts.silent?'5':'10'};
 if(process.env.APNS_KEY_PATH){
  if(!['https://api.push.apple.com','https://api.sandbox.push.apple.com'].includes(base))throw new Error('Apple credentials cannot be sent to a test origin.');
  headers.authorization=`bearer ${providerJwt()}`;
 }else if(!process.env.APNS_API_BASE)throw new Error('Phone alerts are not connected yet.');
 if(opts.collapseId)headers['apns-collapse-id']=opts.collapseId.slice(0,64);
 const session=sessionFor(base);
 return new Promise((resolve,reject)=>{
  let settled=false;
  const req=session.request(headers);let status=0,body='';
  const finish=(err?:Error,value?:{disabledReason?:string})=>{if(settled)return;settled=true;clearTimeout(timer);session.off('close',disconnected);session.off('error',disconnected);session.off('goaway',disconnected);err?reject(err):resolve(value??{});};
  const disconnected=()=>{finish(new Error('Apple connection ended before delivery was confirmed.'));req.close();};
  const timer=setTimeout(()=>{finish(new Error('Phone alert timed out.'));req.close();session.destroy();},15000);timer.unref();
  session.on('close',disconnected);session.on('error',disconnected);session.on('goaway',disconnected);
  req.on('response',h=>{status=Number(h[':status']);});req.setEncoding('utf8');req.on('data',c=>{if(body.length<1024)body+=c;});
  req.on('error',()=>finish(new Error('Apple alert stream failed.')));
  req.on('aborted',disconnected);req.on('close',()=>{if(!settled)disconnected();});
  req.on('end',()=>{let reason='';try{reason=JSON.parse(body).reason??'';}catch{}
   if(status===200)return finish();
   if(status===410||['BadDeviceToken','Unregistered'].includes(reason))return finish(undefined,{disabledReason:reason==='BadDeviceToken'?'BadDeviceToken':'Unregistered'});
   finish(new Error(`Apple refused the alert (${status}).`));
  });req.end(JSON.stringify(payload));
 });
}
