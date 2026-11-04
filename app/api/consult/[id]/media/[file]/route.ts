import sharp from 'sharp';
import {consultHttp} from '@/lib/consult/http';
import {readConsultMedia} from '@/lib/consult/media';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request,{params}:{params:Promise<{id:string;file:string}>}){
 const {id,file}=await params;
 return consultHttp(req,id,'read_media',async(c,ctx)=>{
  const {row,bytes}=await readConsultMedia(c,ctx,id,file);
  const w=new URL(req.url).searchParams.get('w');let out:Buffer=bytes;let mime=row.mime_type;
  if(w){const width=[160,320,640,1280].find(n=>n>=Number(w))??1280;out=await sharp(bytes,{limitInputPixels:40_000_000}).resize({width,withoutEnlargement:true}).webp().toBuffer();mime='image/webp';}
  const headers={'Cache-Control':'private, no-store','Content-Type':mime,'Content-Length':String(out.length),'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
  const range=req.headers.get('range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${out.length}`}});
   const from=Number(match[1]),to=match[2]?Number(match[2]):out.length-1;if(from>to||to>=out.length)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${out.length}`}});
   return new Response(new Uint8Array(out.subarray(from,to+1)),{status:206,headers:{...headers,'Content-Length':String(to-from+1),'Content-Range':`bytes ${from}-${to}/${out.length}`}});
  }
  return new Response(new Uint8Array(out),{headers});
 });
}
