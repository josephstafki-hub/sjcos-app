import { projectsRead, mobileProjects } from "@/lib/mobile-rpc/projects-reads";
export async function GET(req:Request) {
  return projectsRead(req,async user=>Response.json(await mobileProjects(user)));
}
