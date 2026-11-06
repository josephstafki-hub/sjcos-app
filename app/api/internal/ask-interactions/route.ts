import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {pool} from '@/lib/db';
import {interactionCommand} from '@/lib/ask-thread-journal-interactions.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const context=z.object({transport:z.literal('runner_stdio'),run_id:z.uuid(),conversation_id:z.uuid(),principal_user_id:z.uuid(),run_profile:z.enum(['operator','business']),run_started_s:z.number().int().positive().safe()}).strict();
const question=z.object({question:z.string().min(1).max(8000),header:z.string().max(24).optional(),options:z.array(z.object({label:z.string().min(1).max(80),description:z.string().max(300).optional()}).strict()).min(2).max(6),multiSelect:z.boolean(),allowOther:z.boolean()}).strict();
const payload=z.union([z.object({questions:z.array(question).min(1).max(4)}).strict(),z.object({tool:z.string().min(1).max(200),input:z.string().max(4000),description:z.string().max(500)}).strict()]);
const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),input:z.object({id:z.uuid(),kind:z.enum(['question','permission']),payload}).strict(),context}).strict(),
 z.object({action:z.enum(['poll','expire']),input:z.object({id:z.uuid()}).strict(),context}).strict(),
]);
export async function POST(req:Request){
 const secret=process.env.CRON_SECRET,actual=req.headers.get('authorization')??'',expected=`Bearer ${secret}`;
 if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return Response.json({ok:false,code:'AUTH_REQUIRED'},{status:401});
 try{
  const text=await req.text();if(Buffer.byteLength(text)>65536)return Response.json({ok:false,code:'INVALID_INPUT'},{status:400});
  const parsed=body.parse(JSON.parse(text));
  if(parsed.action==='create'&&((parsed.input.kind==='question')!==('questions' in parsed.input.payload)))return Response.json({ok:false,code:'INVALID_INPUT'},{status:400});
  return Response.json(await interactionCommand(pool,parsed.action,parsed.input,parsed.context));
 }catch(e){return Response.json({ok:false,code:e instanceof z.ZodError?'INVALID_INPUT':'RUN_CONTEXT_REQUIRED'},{status:e instanceof z.ZodError?400:403});}
}
