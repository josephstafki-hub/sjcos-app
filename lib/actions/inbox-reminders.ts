'use server';
import {requireAccess} from '@/lib/dal';
import {query} from '@/lib/db';
import {createWorkItem} from '@/lib/actions/engine';
import {revalidatePath} from 'next/cache';

export type ReminderUndo={id:string;dueAt:string;previous:{due_at:string|null;snoozed_until:string|null}|null};
/** Reuse the email identity/deduplication and scheduling-trigger path. */
export async function quickInboxReminder(form:FormData) {
  await requireAccess('engine');
  const email=String(form.get('email')??'');
  let previous:{id:string;due_at:string|null;snoozed_until:string|null}|undefined;
  if(email){
    let ref;try{ref=JSON.parse(email);}catch{return {ok:false,error:'Open the email again.'};}
    const {rows}=await query<{id:string;due_at:string|null;snoozed_until:string|null}>(`SELECT id,due_at::text,snoozed_until::text FROM work_items WHERE source_kind='email' AND source_id=$1 AND status NOT IN ('done','cancelled') LIMIT 1`,[ref.message_id]);
    previous=rows[0];
  }
  form.set('reminder','true');
  const result=await createWorkItem(form);
  if(!result.ok||!result.id)return result;
  const dueAt=String(form.get('due_at')??'');
  // If a racing writer made the pre-existing task, we cannot claim to know its old schedule.
  const undo:ReminderUndo|null=result.existing&&!previous?null:{id:result.id,dueAt,previous:result.existing&&previous?{due_at:previous.due_at,snoozed_until:previous.snoozed_until}:null};
  return {...result,undo};
}
export async function undoInboxReminder(receipt:ReminderUndo) {
  await requireAccess('engine');
  if(!receipt?.id||!Number.isFinite(Date.parse(receipt.dueAt))||receipt.previous&&[receipt.previous.due_at,receipt.previous.snoozed_until].some(v=>v!==null&&!Number.isFinite(Date.parse(v))))return {ok:false,error:'Invalid reminder.'};
  const {rows}=await query(receipt.previous?
    `UPDATE work_items SET due_at=$3::timestamptz,snoozed_until=$4::timestamptz,updated_at=now() WHERE id=$1 AND due_at=$2::timestamptz AND status NOT IN ('done','cancelled') RETURNING id`:
    `UPDATE work_items SET status='cancelled',updated_at=now() WHERE id=$1 AND due_at=$2::timestamptz AND status NOT IN ('done','cancelled') RETURNING id`,
    receipt.previous?[receipt.id,receipt.dueAt,receipt.previous.due_at,receipt.previous.snoozed_until]:[receipt.id,receipt.dueAt]);
  revalidatePath('/inbox');revalidatePath('/today');revalidatePath('/engine');
  return rows.length?{ok:true}:{ok:false,error:'This to-do changed after the reminder. Open it to review its schedule.'};
}
