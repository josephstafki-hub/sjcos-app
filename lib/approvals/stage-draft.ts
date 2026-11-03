import type { Run } from '../commands/core.ts';
/** Approval staging only. The caller owns the transaction and authorization.
 * These are the same knowledge + receipt records consumed by Approve & send.
 * No provider, grant creation, or send function is available in this module. */
export async function stageDraftForApproval(run:Run,input:{work_item_id:string;lead_id:string|null;project_id?:string|null;draft:string;created_by:string}) {
 if(!input.draft.trim()) throw new Error('CHECKLIST_INVALID_DRAFT');
 const [k]=await run<{id:string}>(`INSERT INTO knowledge_items(content,kind,source,lead_id,project_id,created_by) VALUES($1,'draft','manual',$2,$3,$4) RETURNING id`,[input.draft,input.lead_id,input.project_id??null,input.created_by]);
 await run(`UPDATE work_items SET status='approval_needed',approval_status='requested',blocked_reason=NULL,updated_at=now() WHERE id=$1`,[input.work_item_id]);
 await run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'draft ready for approval (draft)')`,[input.work_item_id,`knowledge_items/${k.id}`]);
 return {knowledge_id:k.id};
}
