import {mobileOperatorRead} from '@/lib/mobile-rpc/operator-reads';
import {canvasEvents,canvasHumanJson} from '@/lib/ask-canvases';
export const dynamic='force-dynamic';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const response=await mobileOperatorRead(req,false,()=>canvasHumanJson(async()=>{
  const {id}=await params;
  const input:Record<string,unknown>={};
  for(const [key,value] of new URL(req.url).searchParams){
   if(Object.hasOwn(input,key))throw Error('INVALID_INPUT');
   input[key]=key==='limit'&&/^[1-9][0-9]*$/.test(value)?Number(value):value;
  }
  return canvasEvents(id,input);
 }));
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 return response;
}
