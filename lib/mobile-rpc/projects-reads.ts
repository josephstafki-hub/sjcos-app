import { personInitials } from "./portal-reads";
import "server-only";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import type { CurrentUser } from "@/lib/dal";
import { query } from "@/lib/db";
import { getProjectsData, getProject, getProjectDailyLogs, getProjectFiles, getProjectSubsData, PROJECT_STATUSES, projectStageLabel, type ProjectFile } from "@/lib/projects";
import { getProjectScheduleBlocks } from "@/lib/schedule";
import { formatScheduleTime } from "@/lib/schedule-time";
import { parseDrawSchedule } from "@/lib/draw-schedule";
import { getProjectMoney, usd } from "@/lib/money";
import { getProjectSelections, type SelectionGroup, type Selection } from "@/lib/selections";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { getClientActivity } from "@/lib/client-activity";
import { listDocDrafts } from "@/lib/doc-drafts";
import { getProjectSignatureRequests } from "@/lib/esign";
import { docTypeLabel, STATUS_LABEL } from "@/lib/esign-types";

export async function projectsRead(req:Request, read:(user:CurrentUser)=>Promise<Response>) {
  try {
    const user=await getUserFromRequest(req);
    if(!user) return Response.json({error:"Unauthorized"},{status:401});
    if(!hasAccess(user,"projects")) return Response.json({error:"Forbidden"},{status:403});
    return await read(user);
  } catch(error) { console.error("[mobile-projects]",error); return Response.json({error:"Something went wrong. Please try again."},{status:500}); }
}
export const plainLabel=(s:string) => s.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
export const mobileFile=(f:ProjectFile) => ({...f,kind:f.type,kindLabel:f.type==="img"?"Photo":f.type==="doc"?"File":"Folder",fullUrl:`/api/mobile/files/${encodeURIComponent(f.id)}`,thumbnailUrl:f.type==="img"?`/api/mobile/files/${encodeURIComponent(f.id)}?w=480`:null,publishedToClient:f.clientVisible});
async function jobRows() {
  return (await query<{id:string;slug:string;status:typeof PROJECT_STATUSES[number]["key"];client_name:string;address:string|null;total_cents:string;collected_cents:string;progress:number;next_schedule:{date:string;time:string;label:string}|null}>(
    `SELECT p.id,p.slug,p.status,p.client_name,p.address,p.total_cents,p.collected_cents,p.progress,
      (SELECT json_build_object('date',s.block_date::text,'time',s.time_label,'label',s.label) FROM schedule_blocks s WHERE s.project_id=p.id AND s.block_date >= (now() AT TIME ZONE 'America/Chicago')::date ORDER BY s.block_date,s.sort_min LIMIT 1) AS next_schedule FROM projects p`)).rows;
}
export async function mobileProjects(user:CurrentUser) {
  const [data,rows]=await Promise.all([getProjectsData(),jobRows()]);
  const money=hasAccess(user,"invoices");
  const groups=data.groups.map(g=>({...g,items:g.items.map(p=>{
    const r=rows.find(r=>r.slug===p.slug)!;
    return {...p,...(!money?{value:"",paid:"",hasTotal:false,billed:0}:{}),id:r.id,stageKey:r.status,stageLabel:projectStageLabel(r.status),clientName:r.client_name,address:r.address,statusLine:p.nextSummary || p.stage,totalCents:money?Number(r.total_cents):null,paidCents:money?Number(r.collected_cents):null,percentPaid:money?r.progress:null,nextScheduledItem:r.next_schedule?{...r.next_schedule,time:formatScheduleTime(r.next_schedule.time)}:null,allowedActions:["open","projects.advance"]};
  })}));
  const jobs=groups.flatMap(g=>g.items);
  return {...data,summary:money?data.summary.replace(/projects/g,"jobs").replace(/in job totals/g,"total"):`${jobs.length} jobs`,groups,jobs,stages:PROJECT_STATUSES.map(s=>({...s,count:jobs.filter(j=>j.stageKey===s.key).length})),allowedActions:["projects.create"]};
}
function decisions(groups:SelectionGroup[]):Selection[] { return groups.flatMap(g=>[...g.selections,...decisions(g.children)]); }
function docAllowed(key:string,user:CurrentUser) {
  if(["estimate_doc","contract","precon"].includes(key)) return hasAccess(user,"estimates");
  if(key==="change_order") return hasAccess(user,"change_orders");
  if(key==="invoice_doc") return hasAccess(user,"invoices");
  return true;
}
export async function mobileProject(slug:string,user:CurrentUser) {
  const project=await getProject(slug);
  if(!project) return null;
  const showMoney=hasAccess(user,"invoices");
  const [dailyLogs,files,subs,schedule,selections,messages,activity,drafts,signatures,money,rows,todayRow,photoTags,invoiceDates,timestamps,draw]=await Promise.all([
    getProjectDailyLogs(slug),getProjectFiles(slug,user),getProjectSubsData(slug),getProjectScheduleBlocks(slug),getProjectSelections(slug),getPortalThread(portalChannel("client",slug)),getClientActivity({kind:"project",slug},30),listDocDrafts({slug}),getProjectSignatureRequests(slug),showMoney?getProjectMoney(slug):null,jobRows(),
    query<{today:string;end:string}>(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text AS today, ((now() AT TIME ZONE 'America/Chicago')::date+14)::text AS end`),
    query<{id:string;ai_tags:string[]}>(`SELECT id,ai_tags FROM files WHERE to_jsonb(files)->>'security_profile' IS NULL AND project_key=$1`,[slug]),
    showMoney?query<{id:number;sentAt:string|null}>(`SELECT i.id,to_char(i.sent_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "sentAt" FROM invoices i JOIN projects p ON p.id=i.project_id WHERE p.slug=$1`,[slug]):Promise.resolve({rows:[]}),
    query<{kind:string;id:number;createdAt:string}>(`(SELECT 'activity' AS kind,a.id,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt" FROM client_activity a JOIN projects p ON p.slug=$1 WHERE a.project_id=p.id OR a.lead_id=p.lead_id ORDER BY a.created_at DESC,a.id DESC LIMIT 30) UNION ALL (SELECT 'message',m.id,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM chat_messages m WHERE channel_key=$2 ORDER BY m.created_at DESC,m.id DESC LIMIT 20)`,[slug,portalChannel("client",slug)]),
    showMoney?query<{total:number;draw_schedule:unknown}>(`SELECT e.total,e.draw_schedule FROM estimates e JOIN projects p ON p.id=e.project_id WHERE p.slug=$1 AND e.kind='formal' AND e.status='approved' ORDER BY e.approved_at DESC NULLS LAST,e.id DESC LIMIT 1`,[slug]):Promise.resolve({rows:[]}),
  ]);
  const row=rows.find(r=>r.slug===slug)!;
  const next=PROJECT_STATUSES[PROJECT_STATUSES.findIndex(s=>s.key===project.status)+1];
  const mappedFiles=files.map(mobileFile);
  const invoices=money?.invoices.map(i=>({...i,amountCents:i.amount,amountFormatted:usd(i.amount),balanceCents:i.balance,balanceFormatted:usd(i.balance),sentAt:invoiceDates.rows.find(d=>Number(d.id)===Number(i.id))?.sentAt??null,allowedActions:[...(i.lifecycle!=="void"&&i.lifecycle!=="paid"?["projects.invoice.payment"]:[]),...(user.role==="owner" && i.lifecycle!=="void"&&i.lifecycle!=="paid"?["projects.invoice.send"]:[])]}))??[];
  const nextLine=parseDrawSchedule(draw.rows[0]?.draw_schedule)?.find(l=>!l.billed);
  const nextDraw=nextLine?{label:nextLine.label,percent:nextLine.percent,amountCents:Math.round(Number(draw.rows[0].total)*nextLine.percent/100),amountFormatted:usd(Math.round(Number(draw.rows[0].total)*nextLine.percent/100)),triggerStatus:nextLine.triggerStatus??null}:null;
  const timestamp=(kind:string,id:number)=>timestamps.rows.find(t=>t.kind===kind&&Number(t.id)===Number(id))?.createdAt??null;
  const all=decisions(selections.groups);
  const documents=[...drafts.filter(d=>docAllowed(d.template_key,user)).map(d=>({id:`draft:${d.id}`,title:d.title,kindLabel:plainLabel(d.template_key),statusLabel:plainLabel(d.status),signed:Boolean(d.sig_signed_at),url:d.pdf_file_id?`/api/mobile/files/${encodeURIComponent(d.pdf_file_id)}`:null})),...signatures.filter(s=>!drafts.some(d=>d.signature_request_id===s.id)&&docAllowed(s.docType==="estimate"?"estimate_doc":s.docType,user)).map(s=>({id:`signature:${s.id}`,title:s.title,kindLabel:docTypeLabel(s.docType),statusLabel:STATUS_LABEL[s.status],signed:s.status==="signed",url:s.fileId?`/api/mobile/files/${encodeURIComponent(s.fileId)}`:null}))];
  // Keep the shipped shape, redacting the same invoice fields the web hides.
  const legacy=showMoney?project:{...project,contractValue:"",money:{contract:"",paid:"",nextDraw:"",openCOs:"",billedPct:0,note:""},milestones:[],pulse:`${project.name} is in the ${projectStageLabel(project.status)} stage.`};
  return {project:legacy,dailyLogs:dailyLogs.map(l=>({...l,photoFiles:mappedFiles.filter(f=>photoTags.rows.find(t=>t.id===f.id)?.ai_tags.includes(`daily-log:${l.id}`))})),header:{id:row.id,slug,name:project.name,clientName:project.client.name,address:project.client.address,stageKey:project.status,stageLabel:projectStageLabel(project.status),nextStageLabel:next?.label??null},pulse:legacy.pulse,client:project.client,activity:activity.map(a=>({...a,kindLabel:plainLabel(a.kind),createdAt:timestamp("activity",a.id)})),schedule:schedule.filter(b=>b.iso>=todayRow.rows[0].today&&b.iso<todayRow.rows[0].end).map(b=>({...b,time:formatScheduleTime(b.time),allowedActions:["projects.schedule.remove"]})),subs:subs.assigned,money:showMoney?{totalCents:Number(row.total_cents),totalFormatted:usd(Number(row.total_cents)),paidCents:Number(row.collected_cents),paidFormatted:usd(Number(row.collected_cents)),balanceCents:Number(row.total_cents)-Number(row.collected_cents),balanceFormatted:usd(Number(row.total_cents)-Number(row.collected_cents)),percentPaid:row.progress,nextDraw,invoices}:null,punch:project.punch,documents,files:mappedFiles,photos:mappedFiles.filter(f=>f.kind==="img"),messages:messages.map(m=>({...m,initials:personInitials(m.name),createdAt:timestamp("message",m.id)})),selections:{decided:all.filter(s=>s.chosenOptionId!==null).length,waiting:all.filter(s=>s.chosenOptionId===null).length,decisions:all.map(s=>({id:s.id,name:s.area,status:s.status,statusLabel:plainLabel(s.status),chosenOptionName:s.options.find(o=>o.id===s.chosenOptionId)?.name??null}))},allowedActions:[...(next?["projects.advance"]:[]),"projects.dailyLog.add","projects.dailyLog.edit","projects.schedule.add","projects.schedule.remove","projects.schedule.restore","projects.punch.add","projects.punch.toggle","projects.punch.remove","projects.safety.report","upload",...(showMoney?["projects.invoice.payment"]:[]),...(hasAccess(user,"projects")?["projects.portal.send"]:[]),...(user.role==="owner"?["projects.file.publish",...(showMoney?["projects.invoice.send"]:[])]:[])]};
}
