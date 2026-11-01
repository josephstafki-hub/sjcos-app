import {can, getCurrentUser} from '@/lib/dal';
import {withMailboxFor} from '@/lib/mailbox';
import {fetchMessageHtml, gmailConfigured} from '@/lib/gmail';
import {loadEmailHtml} from '@/lib/inbox-email-content';
import {withReadGate} from '@/lib/inbox-read-gate';

/** Read outside the browser's serialized Server Actions. The connector keeps
 * its existing per-mailbox payload/HTML caches; no second Gmail read path. */
export async function GET(request: Request) {
  const headers = {'Cache-Control':'private, no-store'};
  const user = await getCurrentUser();
  if (!user) return Response.json({error:'Unauthorized'}, {status:401,headers});
  if (!['owner','staff'].includes(user.role) || !can(user,'inbox'))
    return Response.json({error:'Forbidden'}, {status:403,headers});
  const params = new URL(request.url).searchParams;
  const thread = params.get('thread') ?? '', message = params.get('message') ?? '';
  if ([thread,message].some(id=>!id || id.length>512 || !/^[-\w]+$/.test(id)))
    return Response.json({error:'Invalid message'}, {status:400,headers});
  // At most two Gmail reads in flight per signed-in mailbox; fast thread switching queues.
  const result = await loadEmailHtml(()=>withReadGate(`html:${user.id}`,()=>withMailboxFor(user,async()=>{
    if (!gmailConfigured()) throw Error('Gmail is not connected.');
    return fetchMessageHtml(thread,message);
  })));
  return Response.json(result, {status:result.status==='failed'?503:200,headers});
}
