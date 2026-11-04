import { safetyOperation } from "./safety-operation";
import { z } from "zod";
import { defineAction, MobileInputError } from "./dispatch";
import { createProject, advanceProjectStatus, addProjectDailyLog, editProjectDailyLog, addPunchItem, setPunchDone, deletePunchItem } from "@/lib/actions/projects";
import { createProjectScheduleBlock, deleteScheduleBlock, restoreScheduleBlock } from "@/lib/actions/schedule";
import { recordManualPayment, sendInvoice } from "@/lib/actions/money";
import { createIncidentReport } from "@/lib/actions/safety";
import { sendProjectMessage } from "@/lib/actions/portal";
import { setFileClientVisibility } from "@/lib/actions/files";
import { queryOne } from "@/lib/db";

const slug = z.string().min(1).max(200);
const text = z.string().trim().min(1).max(20000);
const date = z.iso.date();
const job = z.object({ slug }).strict();
const number = z.number().int().positive();
export function projectForm(values: Record<string, string | undefined>) {
  const fd = new FormData();
  for (const [k,v] of Object.entries(values)) if (v !== undefined) fd.set(k,v);
  return fd;
}
export async function requireMobileProject(slug: string) {
  const row = await queryOne<{id:string}>(`SELECT id FROM projects WHERE slug=$1`, [slug]);
  if (!row) throw new MobileInputError("Job not found.");
  return row;
}
async function punchOnJob(slug: string, id: number) {
  if (!await queryOne(`SELECT 1 FROM project_punch pp JOIN projects p ON p.id=pp.project_id WHERE p.slug=$1 AND pp.id=$2`, [slug,id])) throw new MobileInputError("Punch item not found on this job.");
}
const removed = z.object({ id:z.uuid(), date, time:z.string(), label:z.string(), tone:z.string(), project_id:z.uuid().nullable(), sort_min:z.number().int(), signature:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const projectsActions = {
  "projects.create": defineAction({ area:"projects", input:z.object({name:text, clientName:text, address:z.string().max(2000).optional(), value:z.string().max(200).optional()}).strict(), run: v => createProject(projectForm({name:v.name, client_name:v.clientName,address:v.address,value:v.value})) }),
  "projects.advance": defineAction({ area:"projects", input:job, run:async ({slug}) => { await requireMobileProject(slug); return advanceProjectStatus(slug); } }),
  "projects.dailyLog.add": defineAction({ area:"projects", input:job.extend({body:text,date:date.optional()}), run:async ({slug,...v}) => { await requireMobileProject(slug); return addProjectDailyLog(slug,projectForm(v)); } }),
  "projects.dailyLog.edit": defineAction({ area:"projects", input:job.extend({id:z.uuid(),body:text}), run:({slug,id,body}) => editProjectDailyLog(slug,id,body) }),
  "projects.schedule.add": defineAction({ area:"projects", input:job.extend({date,time:z.string().max(30).optional(),endTime:z.string().regex(/^\d{2}:\d{2}$/).optional(),label:text}), run:({slug,endTime,...v}) => createProjectScheduleBlock(slug,projectForm({...v,end_time:endTime})) }),
  "projects.schedule.remove": defineAction({ area:"projects", input:job.extend({id:z.uuid()}), run:async ({slug,id}) => { if (!await queryOne(`SELECT 1 FROM schedule_blocks sb JOIN projects p ON p.id=sb.project_id WHERE p.slug=$1 AND sb.id=$2`,[slug,id])) throw new MobileInputError("Block not found on this job."); return deleteScheduleBlock(id,slug); } }),
  "projects.schedule.restore": defineAction({ area:"projects", input:job.extend({block:removed}), run:async ({slug,block}) => { const p=await requireMobileProject(slug); if(p.id!==block.project_id) throw new MobileInputError("Block belongs to another job."); return restoreScheduleBlock(block); } }),
  "projects.invoice.payment": defineAction({ area:"invoices", input:z.object({id:number,amountCents:number,method:z.string().max(100).optional(),date:date.optional(),reference:z.string().max(4000).optional()}).strict(), run:({id,date,reference,...v}) => recordManualPayment(id,{...v,receivedAt:date,note:reference}) }),
  "projects.invoice.send": defineAction({ area:"invoices", ownerOnly:true, input:z.object({id:number}).strict(), run:({id}) => sendInvoice(id) }),
  "projects.punch.add": defineAction({ area:"projects", input:job.extend({item:text,owner:z.string().max(200).default("")}), run:async ({slug,item,owner}) => { await requireMobileProject(slug); return addPunchItem(slug,item,owner); } }),
  "projects.punch.toggle": defineAction({ area:"projects", input:job.extend({id:number,done:z.boolean()}), run:async ({slug,id,done}) => { await punchOnJob(slug,id); return setPunchDone(id,done,slug); } }),
  "projects.punch.remove": defineAction({ area:"projects", input:job.extend({id:number}), run:async ({slug,id}) => { await punchOnJob(slug,id); return deletePunchItem(id,slug); } }),
  "projects.safety.report": defineAction({ area:"projects", input:job.extend({requestId:z.uuid().optional(),date,severity:z.enum(["near_miss","minor","recordable","serious"]),notes:text,reporter:z.string().max(200).optional()}), run:async ({requestId,slug,date,...v},user) => requestId
    ? safetyOperation(user.id,requestId,{slug,date,...v},()=>createIncidentReport(slug,projectForm({...v,occurredAt:date})))
    : createIncidentReport(slug,projectForm({...v,occurredAt:date})) }),
  "projects.portal.send": defineAction({ area:"projects", ownerOnly:true, input:job.extend({body:text}), run:async ({slug,body}) => { await requireMobileProject(slug); return sendProjectMessage(slug,projectForm({body})); } }),
  "projects.file.publish": defineAction({ area:"projects", ownerOnly:true, input:job.extend({id:z.string().min(1).max(200),visible:z.boolean()}), run:async ({slug,id,visible}) => { if (!await queryOne(`SELECT 1 FROM files f JOIN projects p ON p.slug=$1 WHERE f.id=$2 AND (f.project_key=p.slug OR f.lead_slug=(SELECT slug FROM leads WHERE id=p.lead_id))`,[slug,id])) throw new MobileInputError("File not found on this job."); return setFileClientVisibility(id,visible); } }),
};
