import { projectsRead, mobileProject } from "@/lib/mobile-rpc/projects-reads";
export async function GET(req:Request,{params}:{params:Promise<{slug:string}>}) {
  return projectsRead(req,async user=> {
    const {slug}=await params;
    const data=await mobileProject(slug,user);
    return data?Response.json(data):Response.json({error:"Not found"},{status:404});
  });
}
