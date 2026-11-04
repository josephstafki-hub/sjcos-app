"use server";
import {requireAccess} from '@/lib/dal';
import {withMailboxFor, activeMailbox} from '@/lib/mailbox';
import {query} from '@/lib/db';
import {ensureMailboxEmail} from '@/lib/mailbox-email';
import {revalidatePath} from 'next/cache';
import {emailAddress, validRecipient} from '@/lib/inbox-rules';

export async function setInboxPreferenceAction(kind: 'sender'|'thread', target: string, decision: string | null): Promise<{ok:boolean;error?:string;previous?:string|null}> {
  const user = await requireAccess('inbox');
  if (!['sender','thread'].includes(kind) || !target || target.length>400 || /[\r\n]/.test(target) ||
    kind === 'sender' && !validRecipient(emailAddress(target)) ||
    decision !== null && !(kind === 'sender' ? ['linked','lead','sub','vendor','other','pending','blocked'] : ['attention','other']).includes(decision))
    return {ok:false,error:'Choose a valid screening decision.'};
  return withMailboxFor(user, async()=>{
    const mailbox = (await ensureMailboxEmail()) || undefined;
    if (!mailbox) return {ok:false,error:'Connect your mailbox before screening senders.'};
    const key = `${kind}:${kind==='sender' ? emailAddress(target) : target}`;
    try {
      const {rows} = await query<{decision:string}>('SELECT decision FROM inbox_preferences WHERE mailbox=$1 AND subject_key=$2',[mailbox,key]);
      if (decision === null) await query('DELETE FROM inbox_preferences WHERE mailbox=$1 AND subject_key=$2',[mailbox,key]);
      else await query(`INSERT INTO inbox_preferences (mailbox,subject_key,decision) VALUES ($1,$2,$3)
        ON CONFLICT (mailbox,subject_key) DO UPDATE SET decision=EXCLUDED.decision,decided_at=now()`,[mailbox,key,decision]);
      revalidatePath('/inbox');
      return {ok:true,previous:rows[0]?.decision ?? null};
    } catch {return {ok:false,error:'Could not save your decision. Try again.'};}
  });
}

export async function searchInboxDirectoryAction(search:string,sender:string) {
  await requireAccess('inbox');
  const {searchInboxDirectory}=await import('@/lib/inbox-directory');
  return searchInboxDirectory(search,emailAddress(sender));
}
