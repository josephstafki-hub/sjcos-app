import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {pool} from '@/lib/db';
import {contextCommand,readerCommand} from '@/lib/ask-context-inputs.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const context=z.object({transport:z.literal('runner_stdio'),run_id:z.uuid(),conversation_id:z.uuid(),principal_user_id:z.uuid(),run_profile:z.enum(['operator','business']),run_started_s:z.number().int().positive().safe()}).strict();
const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('begin'),input:z.object({kind:z.literal('tool'),ref:z.string().regex(/^[a-z][a-z0-9_]{0,127}$/)}).strict(),context}).strict(),
 z.object({action:z.literal('complete'),input:z.object({id:z.uuid(),result:z.unknown()}).strict(),context}).strict(),
 z.object({action:z.literal('question'),input:z.object({id:z.uuid()}).strict(),context}).strict(),
 z.object({action:z.literal('list_operating_docs'),input:z.object({}).strict(),context}).strict(),
 z.object({action:z.literal('read_operating_doc'),input:z.object({id:z.string().max(120)}).strict(),context}).strict(),
 z.object({action:z.literal('search_operating_docs'),input:z.object({query:z.string().min(1).max(256)}).strict(),context}).strict(),
 z.object({action:z.literal('read_chat_attachment'),input:z.object({id:z.uuid()}).strict(),context}).strict(),
]);
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
export async function POST(req:Request){
 const secret=process.env.CRON_SECRET,actual=req.headers.get('authorization')??'',expected=`Bearer ${secret}`;
 if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return Response.json({ok:false,code:'AUTH_REQUIRED'},{status:401,headers});
 try{
  if(req.headers.get('content-encoding')||!req.headers.get('content-type')?.startsWith('application/json'))throw Error('INVALID_INPUT');
  const reader=req.body?.getReader();if(!reader)throw Error('INVALID_INPUT');const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('INVALID_INPUT');}chunks.push(value);}
  const b=body.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const command=['begin','complete','question'].includes(b.action)?contextCommand:readerCommand;
  return Response.json(await command(pool,b.action,b.input,b.context),{headers});
 }catch{return Response.json({ok:false,code:'CONTEXT_PROVENANCE_INCOMPLETE'},{status:403,headers});}
}
