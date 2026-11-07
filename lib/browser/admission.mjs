/** Root supervisor RPC. IDs locate checked registration; never accept person,
 * priority, capacities or an accounting boolean from a web/model caller. */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {UUID,UInt} from './phase1-contracts.mjs';
import {lstat} from 'node:fs/promises';
const Request=z.strictObject({v:z.literal(1),op:z.enum(['reserve','activate','release','metrics']),task_id:UUID.nullable(),reservation_id:UUID.nullable(),expected_generation:UInt,idempotency_key:UUID});
const Reply=z.strictObject({ok:z.literal(true),boot_id:UUID,generation:UInt,reservation_id:UUID.nullable(),expires_at:z.iso.datetime().nullable(),metrics:z.strictObject({available_bytes:UInt,account_bytes:UInt,browser_bytes:UInt,accounted:z.boolean(),latched:z.boolean()}),code:z.enum(['RESERVED','ACTIVE','RELEASED','METRICS'])});
export async function supervisorCall(value,{call,stat=lstat}={}){
 const request=Request.parse(value);
 if(request.op==='metrics'&&(request.task_id!==null||request.reservation_id!==null)||request.op!=='metrics'&&!request.task_id||['activate','release'].includes(request.op)&&!request.reservation_id)throw Error('BROWSER_BAD_INPUT');
 if(!call){
  const {connect}=await import('node:net');
  for(const file of ['/run/sjcos-browser-supervisor','/run/sjcos-browser-supervisor/admission.sock']){const s=await stat(file);if(s.uid!==0||s.isSymbolicLink()||(s.mode&0o007)||(file.endsWith('.sock')?!s.isSocket():!s.isDirectory()))throw Error('BROWSER_SERVICE_UNAVAILABLE');}
  call=payload=>new Promise((resolve,reject)=>{const socket=connect('/run/sjcos-browser-supervisor/admission.sock');let data=Buffer.alloc(0);const fail=()=>{socket.destroy();reject(Error('BROWSER_SERVICE_UNAVAILABLE'));};socket.setTimeout(2000,fail);socket.on('error',fail);socket.on('end',()=>{if(!data.length)fail();});socket.once('connect',()=>{const b=Buffer.from(JSON.stringify(payload)),h=Buffer.alloc(4);h.writeUInt32BE(b.length);socket.write(Buffer.concat([h,b]));});socket.on('data',b=>{if(data.length+b.length>8196)return fail();data=Buffer.concat([data,b]);if(data.length<4)return;const n=data.readUInt32BE();if(n<1||n>8192||data.length>n+4)return fail();if(data.length===n+4){try{const r=JSON.parse(data.subarray(4));socket.destroy();resolve(r);}catch{fail();}}});});
 }
 const reply=await call(request);if(!reply?.ok)throw Error(reply?.code&&Object.hasOwn({BROWSER_LATCHED:1,BROWSER_RESOURCE_LIMIT:1,BROWSER_BUSY:1},reply.code)?reply.code:'BROWSER_SERVICE_UNAVAILABLE');return Reply.parse(reply);
}
export const admissionRequest=(op,task_id=null,reservation_id=null,expected_generation=0)=>({v:1,op,task_id,reservation_id,expected_generation,idempotency_key:randomUUID()});
