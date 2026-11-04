import { dispatchMobileAction } from "@/lib/mobile-rpc/dispatch";
import { projectsActions } from "@/lib/mobile-rpc/projects";
import { getCurrentUser, homeFor, homeForRole } from "@/lib/dal";
import { getUserFromRequest } from "@/lib/api-auth";

// Compatibility endpoint: always append. Explicit replacement uses the edit RPC.
export async function POST(req: Request, { params }: { params: Promise<{slug:string}> }) {
  let body: unknown;
  try { body=await req.json(); } catch { return Response.json({error:"Invalid request body."},{status:400}); }
  if (!body || typeof body!=="object" || Array.isArray(body)) return Response.json({error:"Expected an object."},{status:400});
  const {slug}=await params;
  const rpc = new Request(req.url,{method:"POST",headers:req.headers,body:JSON.stringify({...body,slug})});
  const result=await dispatchMobileAction(rpc,"projects.dailyLog.add",projectsActions,async r=>{const user=await getUserFromRequest(r);return user&&(await getCurrentUser())?.id===user.id?user:null;},user=>[homeFor(user),homeForRole(user.role)]);
  if (!result.ok) return result;
  const value=await result.json();
  return Response.json({ok:true,...(value.result ?? {})});
}
