import { projectsRead } from "@/lib/mobile-rpc/projects-reads";
import { safetyOperationStatus } from "@/lib/mobile-rpc/safety-operation";
import { queryOne } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req:Request,{params}:{params:Promise<{slug:string;requestId:string}>}) {
 return projectsRead(req,async user=>{
  const {slug,requestId}=await params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))return Response.json({error:"Invalid request ID"},{status:400});
  const operation=await safetyOperationStatus(user.id,requestId,slug,id=>queryOne<{incidentId:string;fileId:string|null}>(`SELECT i.id::text AS "incidentId",f.id AS "fileId" FROM incident_reports i JOIN projects p ON p.id=i.project_id LEFT JOIN files f ON to_jsonb(f)->>'security_profile' IS NULL AND f.id=i.file_id AND f.storage_path IS NOT NULL WHERE i.id=$1 AND p.slug=$2`,[id,slug]));
  return Response.json(operation??{error:"Request not found for this user and job."},{status:operation?200:404,headers:{"Cache-Control":"private, no-store"}});
 });
}
