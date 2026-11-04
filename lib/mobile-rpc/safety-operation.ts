import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { MobileInputError } from "./dispatch.ts";
export type SafetyOperation = {requestId:string;status:"pending"|"completed"|"failed";result:{ok:boolean;error?:string}|null;message:string|null};
/** A private, durable journal. Exclusive creation arbitrates concurrent workers.
 * Pending survives a worker crash: never automatically replay an uncertain write.
 * Keep this directory on persistent shared storage when deploying multiple hosts.
 */
export async function safetyOperation(userId:string,requestId:string,payload:unknown,run:()=>Promise<{ok:boolean;error?:string}>):Promise<SafetyOperation> {
 const dir=path.join(process.cwd(),"drafts","mobile-safety-operations");
 await mkdir(dir,{recursive:true,mode:0o700});
 const key=createHash("sha256").update(`${userId}:${requestId}`).digest("hex");
 const fingerprint=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
 const file=path.join(dir,key+".json");
 const pending:SafetyOperation={requestId,status:"pending",result:null,message:"Report is being prepared. Retry with the same request ID to check its outcome."};
 try { const handle=await open(file,"wx",0o600); try {await handle.writeFile(JSON.stringify({fingerprint,operation:pending}));await handle.sync();}finally{await handle.close();} }
 catch(e) {
  if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
  let saved:{fingerprint:string;operation:SafetyOperation};
  try {saved=JSON.parse(await readFile(file,"utf8"));} catch {return pending;}
  if(saved.fingerprint!==fingerprint)throw new MobileInputError("This request ID was already used for different report details.");
  return saved.operation;
 }
 let operation:SafetyOperation;
 try {const result=await run();operation={requestId,status:result.ok?"completed":"failed",result,message:result.ok?"Incident report created.":result.error??"Report could not be created."};}
 catch(e) { console.error("[mobile-safety] Report outcome uncertain",e);operation={requestId,status:"failed",result:null,message:"The report could not be confirmed. Check the job before creating another report."}; }
 const temp=file+".tmp";await writeFile(temp,JSON.stringify({fingerprint,operation}),{mode:0o600});await rename(temp,file);
 return operation;
}
