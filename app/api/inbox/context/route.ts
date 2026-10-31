import { can, getCurrentUser } from '@/lib/dal';
import { loadInboxContext, type InboxContextInput } from '@/lib/inbox-context';

/** Independent read: never wait behind the browser's serialized Server Actions. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:'Unauthorized'}, {status:401});
  if (!['owner','staff'].includes(user.role) || !can(user,'inbox'))
    return Response.json({error:'Forbidden'}, {status:403});
  const params = new URL(request.url).searchParams;
  const input: InboxContextInput = {threadId:params.get('threadId') ?? ''};
  for (const key of ['email','contactKey','projectSlug','leadSlug'] as const) {
    const value = params.get(key);
    if (value) input[key] = value;
  }
  if (!input.threadId || Object.values(input).some(v=>v.length>512 || /[\x00-\x1f]/.test(v)))
    return Response.json({error:'Invalid conversation'}, {status:400});
  try {
    return Response.json(await loadInboxContext(input), {headers:{'Cache-Control':'private, no-store'}});
  } catch {
    return Response.json({error:'Could not load context. Try again.'}, {status:503,headers:{'Cache-Control':'private, no-store'}});
  }
}
