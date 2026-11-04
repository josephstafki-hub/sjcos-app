import { z } from "zod";
import { queryOne } from "@/lib/db";
import { defineAction, MobileInputError } from "./dispatch";
import { createScheduleBlock, updateScheduleBlock, deleteScheduleBlock } from "@/lib/actions/schedule";
import { acknowledgeWarrantyClaim, resolveWarrantyClaim, reopenWarrantyClaim, createWarrantyClaim } from "@/lib/actions/warranty";
import { fileUnsortedAction, noteUnsortedAction, undoUnsortedAction } from "@/lib/actions/unsorted";

const id = z.uuid();
const fields = z.object({ date: z.iso.date(), time: z.string().max(40), label: z.string().min(1).max(500), tone: z.enum(["accent", "ai", "ghost"]).optional(), projectId: id.nullable().optional() }).strict();
function scheduleForm(v: z.output<typeof fields>) { const f = new FormData(); f.set("date", v.date); f.set("time", v.time); f.set("label", v.label); if (v.tone) f.set("tone", v.tone); if (v.projectId) f.set("project_id", v.projectId); return f; }
const target = z.discriminatedUnion("to", [z.object({to: z.literal("project"), projectSlug: z.string().min(1).max(200)}).strict(), z.object({to: z.literal("overhead")}).strict(), z.object({to: z.literal("dismiss")}).strict()]);
const numberId = z.number().int().positive();
export const fieldActions = {
  "warranty.acknowledge": defineAction({area:"warranty",input:z.object({id}).strict(),run:({id})=>acknowledgeWarrantyClaim(id)}),
  "warranty.resolve": defineAction({area:"warranty",input:z.object({id}).strict(),run:({id})=>resolveWarrantyClaim(id)}),
  "warranty.reopen": defineAction({area:"warranty",input:z.object({id}).strict(),run:({id})=>reopenWarrantyClaim(id)}),
  "unsorted.setAside": defineAction({area: "money", input: z.object({id: numberId}).strict(), run: ({id}) => fileUnsortedAction(id, {target: {to: "dismiss"}})}),
  "unsorted.dismiss": defineAction({area: "money", input: z.object({id: numberId}).strict(), run: ({id}) => fileUnsortedAction(id, {target: {to: "dismiss"}})}),
  "schedule.create": defineAction({ area: "projects", input: fields, run: v => createScheduleBlock(scheduleForm(v)) }),
  "schedule.update": defineAction({ area: "projects", input: fields.partial().extend({ id }), run: async ({id, ...v}) => {
    const row=await queryOne<{date:string;time:string;label:string;tone:"accent"|"ai"|"ghost";projectId:string|null}>(`SELECT block_date::text AS date,time_label AS time,label,tone,project_id AS "projectId" FROM schedule_blocks WHERE id=$1`,[id]);
    if(!row)throw new MobileInputError("Block not found.");
    return updateScheduleBlock(id,scheduleForm({...row,...v}));
  } }),
  "schedule.delete": defineAction({ area: "projects", input: z.object({id}).strict(), run: ({id}) => deleteScheduleBlock(id) }),
  "warranty.create": defineAction({ area: "warranty", input: z.object({slug: z.string().min(1).max(200), issue: z.string().min(1).max(4000), source: z.string().max(100).optional()}).strict(), run: v => { const f = new FormData(); f.set("slug", v.slug); f.set("issue", v.issue); if (v.source) f.set("source", v.source); return createWarrantyClaim(f); } }),
  "unsorted.file": defineAction({ area: "money", input: z.object({ id: numberId, target, logCost: z.boolean().optional(), kind: z.string().max(100).optional(), amountCents: z.number().int().nullable().optional(), vendorLabel: z.string().max(500).optional(), note: z.string().max(4000).optional() }).strict(), run: ({id, ...v}) => fileUnsortedAction(id, v) }),
  "unsorted.note": defineAction({ area: "money", input: z.object({id: numberId, note: z.string().min(1).max(4000)}).strict(), run: ({id, note}) => noteUnsortedAction(id, note) }),
  "unsorted.undo": defineAction({ area: "money", input: z.object({id: numberId}).strict(), run: ({id}) => undoUnsortedAction(id) }),
};
