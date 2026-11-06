import { z } from "zod";
import { projectsRead, mobileFile } from "@/lib/mobile-rpc/projects-reads";
import { getCurrentUser } from "@/lib/dal";
import { uploadProjectFile, uploadProjectDailyLogPhoto } from "@/lib/actions/files";
import { getProjectFiles } from "@/lib/projects";
import { queryOne } from "@/lib/db";

export async function POST(req:Request) {
  return projectsRead(req,async(user)=>{
    if((await getCurrentUser())?.id!==user.id) return Response.json({error:"Unauthorized"},{status:401});
    // The web store enforces 25 MiB per file; bound the multipart request too.
    if(Number(req.headers.get("content-length"))>26*1024*1024) return Response.json({error:"File is too large (max 25 MB)."},{status:413});
    let fd:FormData;
    try { fd=await req.formData(); } catch { return Response.json({error:"Expected multipart form data."},{status:400}); }
    const parsed=z.object({slug:z.string().min(1).max(200),dailyLogId:z.uuid().optional()}).safeParse({slug:fd.get("slug"),dailyLogId:fd.get("dailyLogId")??undefined});
    if(!parsed.success) return Response.json({error:parsed.error.issues[0].message},{status:400});
    const {slug,dailyLogId}=parsed.data;
    const file=fd.get("file");
    if(!(file instanceof File)||!file.size) return Response.json({error:"Choose one file."},{status:400});
    if(file.size>25*1024*1024) return Response.json({error:"File is too large (max 25 MB)."},{status:413});
    if(!await queryOne(`SELECT 1 FROM projects WHERE slug=$1`,[slug])) return Response.json({error:"Job not found."},{status:404});
    const result=dailyLogId?await uploadProjectDailyLogPhoto(slug,dailyLogId,fd):await uploadProjectFile(slug,fd);
    if(!result.ok) return Response.json({error:result.error},{status:400});
    const files=(await getProjectFiles(slug,user)).filter(f=>f.id===result.id).map(mobileFile);
    return Response.json({ok:true,files});
  });
}
