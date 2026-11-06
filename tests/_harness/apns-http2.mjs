import {registerHooks} from 'node:module';
export const transport=globalThis.phoneApns={sessions:[],requests:[],response:()=>({status:200}),block:null};
registerHooks({resolve(s,c,next){return s==='node:http2'?{url:'phone-http2:',shortCircuit:true}:next(s,c);},load(u,c,next){if(u!=='phone-http2:')return next(u,c);return {format:'module',shortCircuit:true,source:`
import {EventEmitter} from 'node:events';
export function connect(base){
 const t=globalThis.phoneApns,s=new EventEmitter();t.sessions.push(s);s.closed=false;s.destroyed=false;s.unref=()=>{};s.setTimeout=()=>{};
 s.close=()=>{if(!s.closed){s.closed=true;s.emit('close');}};s.destroy=()=>{s.destroyed=true;s.close();};
 s.request=headers=>{const r=new EventEmitter();r.setEncoding=()=>{};r.close=()=>r.emit('close');r.end=payload=>{
 const entry={base,headers,payload:JSON.parse(payload),session:s,stream:r};t.requests.push(entry);
 queueMicrotask(async()=>{if(t.block)await t.block;const out=t.response(entry);
 if(out.event){(out.event==='goaway'||out.event==='sessionClose'?s:r).emit(out.event==='sessionClose'?'close':out.event);return;}
 if(out.wait)return;
 r.emit('response',{':status':out.status});r.emit('data',JSON.stringify({reason:out.reason}));r.emit('end');r.emit('close');});};return r;};return s;
}`};}});
