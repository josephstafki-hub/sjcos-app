import { isRedirectError } from "next/dist/client/components/redirect-error.js";
import { getURLFromRedirectError } from "next/dist/client/components/redirect.js";
import { z } from "zod";
import { defineAction, MobileInputError } from "./dispatch";
import { createLeadFromInbox, advanceLeadStage, setLeadStage, markLeadLost, reopenLead, convertLeadToProject, updateLeadContact, saveIntakeAnswer } from "@/lib/actions/leads";
import { updateLeadTaskDue, addLeadTask, setLeadTaskDone, deleteLeadTask } from "@/lib/actions/lead-tasks";
import { getLeadTasks } from "@/lib/lead-tasks";
import { sendFirstResponseAction } from "@/lib/actions/lead-first-response";
import { sendLeadPortalMessage } from "@/lib/actions/portal";
import { ALL_STAGES } from "@/lib/leads";
import { hasAccess } from "@/lib/api-auth";

const slug = z.string().min(1).max(200);
const base = z.object({ slug }).strict();
const s = z.string().max(4000);
const task = base.extend({ id: z.number().int().positive() });
async function checkTask(slug: string, id: number) {
  if (!(await getLeadTasks(slug)).some(t => t.id === id)) throw new MobileInputError("To-do not found on this lead.");
}
function form(input: Record<string, string | undefined>) { const f = new FormData(); for (const [k,v] of Object.entries(input)) if (v !== undefined) f.set(k,v); return f; }
export const leadsActions = {
  "leads.create": defineAction({ area: "leads", input: z.object({ name: s.min(1), phone: s.optional(), email: s.optional(), address: s.optional(), budget: s.optional(), scope: s.optional(), value: s.optional(), source: s.optional(), referrer_name: s.optional(), referrer_email: s.optional() }).strict(), run: async ({address,budget,...input}) => {
    const result=await createLeadFromInbox(form({...input,value:input.value ?? budget}));
    if(!result.slug) throw new MobileInputError("Could not create the lead.");
    if(address) await saveIntakeAnswer(result.slug,"Address",address);
    if(budget) await saveIntakeAnswer(result.slug,"Budget",budget);
    return {...result,redirect:`/leads/${result.slug}`};
  } }),
  "leads.advance": defineAction({ area: "leads", input: base, run: ({slug}) => advanceLeadStage(slug) }),
  "leads.setStage": defineAction({ area: "leads", input: base.extend({ stage: z.enum(["intake", "qualified", "discovery_call", "rough_estimate", "precon_signed", "lost"]) }), run: ({slug,stage}) => { if (!ALL_STAGES.some(s => s.key === stage)) throw new MobileInputError("Unknown stage."); return setLeadStage(slug,stage); } }),
  "leads.lost": defineAction({ area: "leads", input: base, run: ({slug}) => markLeadLost(slug) }),
  "leads.reopen": defineAction({ area: "leads", input: base, run: ({slug}) => reopenLead(slug) }),
  "leads.convert": defineAction({ area: "leads", input: base.extend({ name: s.optional() }), run: async ({slug,name}) => {
    try { return await convertLeadToProject(slug,name); }
    catch(e) {
      if(isRedirectError(e)) { const redirect=getURLFromRedirectError(e); const m=/^\/projects\/([^/?#]+)$/.exec(redirect); if(m) return {projectSlug:decodeURIComponent(m[1]),redirect}; }
      throw e;
    }
  } }),
  "leads.contact": defineAction({ area: "leads", input: base.extend({ email: s, phone: s }), run: ({slug,email,phone}) => updateLeadContact(slug,email,phone) }),
  "leads.intake": defineAction({ area: "leads", input: base.extend({ question: s.min(1), answer: s }), run: ({slug,question,answer}) => saveIntakeAnswer(slug,question,answer) }),
  "leads.taskAdd": defineAction({ area: "leads", input: base.extend({ title: s.min(1).max(300), dueDate: z.union([z.iso.date(), z.literal("")]) }), run: ({slug,title,dueDate}) => addLeadTask(slug,title,dueDate) }),
  "leads.taskUpdate": defineAction({area:"leads",input:task.extend({dueDate:z.union([z.iso.date(),z.literal("")])}),run:({slug,id,dueDate})=>updateLeadTaskDue(id,slug,dueDate)}),
  "leads.taskDone": defineAction({ area: "leads", input: task.extend({ done: z.boolean() }), run: async ({slug,id,done}) => { await checkTask(slug,id); return setLeadTaskDone(id,done,slug); } }),
  "leads.taskDelete": defineAction({ area: "leads", input: task, run: async ({slug,id}) => { await checkTask(slug,id); return deleteLeadTask(id,slug); } }),
  "leads.sendFirstResponse": defineAction({ area: "leads", ownerOnly: true, input: base.extend({ subject: s.min(1), body: s.min(1) }), run: ({slug,subject,body}) => sendFirstResponseAction(slug,subject,body) }),
  "leads.portalMessage": defineAction({ area: "leads", ownerOnly: true, input: base.extend({ body: s.min(1) }), run: ({slug,body}, user) => { if (!hasAccess(user,"projects")) throw new MobileInputError("Projects access is required."); return sendLeadPortalMessage(slug,form({body})); } }),
};
