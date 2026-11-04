import { mkdir, open, readFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { hostname } from "node:os";
import { MobileInputError } from "./dispatch.ts";
export type SafetyResult = {ok:boolean;error?:string;incidentId?:string;fileId?:string|null;pdfSaved?:boolean};
export type SafetyOperation = {requestId:string;status:"pending"|"completed"|"failed";result:SafetyResult|null;message:string|null;reconciliation?:"running"|"not_started"|"saved"|"needs_review"};
type Journal = {fingerprint:string;slug?:string;pid?:number;host?:string;incidentId?:string;operation:SafetyOperation};
const journalPath=(userId:string,requestId:string)=>path.join(process.cwd(),"drafts","mobile-safety-operations",createHash("sha256").update(`${userId}:${requestId}`).digest("hex")+".json");
async function save(file:string,saved:Journal) {
 const temp=file+`.`+randomUUID()+".tmp";
 const handle=await open(temp,"wx",0o600);
 try {await handle.writeFile(JSON.stringify(saved));await handle.sync();} finally {await handle.close();}
 await rename(temp,file);
}
/** Exclusive creation arbitrates workers. Never expire/replay an uncertain write. */
export async function safetyOperation(userId:string,requestId:string,payload:unknown,run:(reserve:(incidentId:string)=>Promise<void>)=>Promise<SafetyResult>):Promise<SafetyOperation> {
 const file=journalPath(userId,requestId);
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const fingerprint=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
 const pending:SafetyOperation={requestId,status:"pending",result:null,message:"Report is being prepared. Check this request before trying again."};
 const saved:Journal={fingerprint,pid:process.pid,host:hostname(),slug:(payload as {slug?:string})?.slug,operation:pending};
 try {const handle=await open(file,"wx",0o600);try {await handle.writeFile(JSON.stringify(saved));await handle.sync();}finally{await handle.close();}}
 catch(e) {
  if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
  let existing:Journal;try {existing=JSON.parse(await readFile(file,"utf8"));} catch {return {...pending,message:"The report could not be confirmed. Ask the owner to review this request."};}
  if(existing.fingerprint!==fingerprint)throw new MobileInputError("This request ID was already used for different report details.");
  return existing.operation;
 }
 let operation:SafetyOperation;
 try {const result=await run(async incidentId=>{saved.incidentId=incidentId;await save(file,saved);});operation={requestId,status:result.ok?"completed":"failed",result,message:result.ok?"Incident report created.":result.error??"Report could not be created."};}
 catch(e) {console.error("[mobile-safety] Report outcome uncertain",e);operation={requestId,status:"failed",result:null,message:"The report could not be confirmed. Check this request before creating another report."};}
 saved.operation=operation;await save(file,saved);return operation;
}
/** Read only: identity is scoped to user + job. DB lookup wins over a stranded journal.
 * Single shared-host deployment; unknown/legacy PID or absent DB row is never replayed.
 */
export async function safetyOperationStatus(userId:string,requestId:string,slug:string,lookup:(id:string)=>Promise<{incidentId:string;fileId:string|null}|null>):Promise<SafetyOperation|null> {
 let saved:Journal;
 try {saved=JSON.parse(await readFile(journalPath(userId,requestId),"utf8"));}
 catch(e) {if((e as NodeJS.ErrnoException).code==="ENOENT")return null;return {requestId,status:"failed",result:null,reconciliation:"needs_review",message:"The report could not be confirmed. Ask the owner to review this request."};}
 if(saved.slug!==slug)return null;
 if(saved.incidentId) {
  const report=await lookup(saved.incidentId);
  if(report)return {requestId,status:"completed",result:{ok:true,...report,pdfSaved:!!report.fileId},reconciliation:"saved",message:report.fileId?"Incident saved. PDF is in Photos and files.":"Incident saved, but its PDF is unavailable. Ask the owner to restore the PDF; do not submit another incident."};
 }
 if(saved.operation.result)return saved.operation;
 let alive=false;const local=!saved.host||saved.host===hostname();if(saved.pid&&local)try {process.kill(saved.pid,0);alive=true;}catch{}
 if(alive&&saved.operation.status==="pending")return {...saved.operation,reconciliation:"running"};
 if(saved.pid&&local&&!alive&&!saved.incidentId)return {requestId,status:"failed",result:{ok:false,error:"The report stopped before filing. You can start a new request."},reconciliation:"not_started",message:"The report stopped before filing. You can start a new request."};
 return {...saved.operation,status:"failed",result:null,reconciliation:"needs_review",message:"No incident is confirmed yet. Ask the owner to verify this request and that its worker has stopped before starting another report."};
}
