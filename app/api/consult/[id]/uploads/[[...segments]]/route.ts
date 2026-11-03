import {z} from 'zod';
import {consultHttp,boundedBytes} from '@/lib/consult/http';
import {initConsultUpload,putConsultPart,consultUploadStatus,commitConsultBlob,PART_BYTES} from '@/lib/consult/uploads';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string;segments?:string[]}>};
async function handle(req:Request,{params}:Params){
 const {id,segments:s=[]}=await params;
 if(!z.string().uuid().safeParse(id).success)return Response.json({error_code:'invalid_id'},{status:422});
 return consultHttp(req,id,'upload',async(c,ctx)=>{
  if(req.method==='GET'&&s.length===1)return consultUploadStatus(c,ctx,id,s[0]);
  if(req.method==='PUT'&&s.length===3&&s[1]==='parts'&&/^\d+$/.test(s[2]))return putConsultPart(c,ctx,id,s[0],Number(s[2]),await boundedBytes(req,PART_BYTES),req.headers.get('x-part-sha256')??'');
  if(req.method==='POST'){
   if(!req.headers.get('content-type')?.startsWith('application/json'))throw new Error('json_required');
   const body=JSON.parse((await boundedBytes(req,16384)).toString('utf8'));
   if(!s.length)return initConsultUpload(c,ctx,id,body);
   if(s.length===2&&s[1]==='commit')return commitConsultBlob(c,ctx,id,s[0],body);
  }
  throw new Error('invalid_upload_route');
 });
}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
