import { syncComplianceNotifications } from "@/lib/notify";
import { mobileRead } from "@/lib/mobile-rpc/reads";
import { rowToCard, audienceClause, getUnreadCount } from "@/lib/notifications";
import { destination, plainNotice, plainTitle } from "@/lib/mobile-rpc/destinations";
import { query } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req:Request) {
 const q=new URL(req.url).searchParams, limit=Number(q.get("limit")??50),before=q.get("before");
 if(!Number.isInteger(limit)||limit<1||limit>100|| (before&&!/^[0-9a-f-]{36}$/i.test(before)))return Response.json({error:"Invalid paging parameters"},{status:400});
 const requestedFilter=q.get("kind")??q.get("filter")??"all";
 if(!["all","unread","decision","mention","job","money","compliance"].includes(requestedFilter))return Response.json({error:"Unknown filter"},{status:400});
 return mobileRead(req,false,async user=>{
  if(user.role==="owner")await syncComplianceNotifications();
  const unread=await getUnreadCount(user);
  const kind=q.get("kind")??q.get("filter")??"all";
  const filters=[{key:"all",label:"All"},{key:"unread",label:"Unread"},{key:"decision",label:"Decisions"},{key:"mention",label:"Mentions"},{key:"job",label:"Jobs"},{key:"money",label:"Money"},{key:"compliance",label:"Compliance"}];
  if(!filters.some(f=>f.key===kind))return {error:"Unknown filter"};
  const onlyUnread=q.get("unread")==="1"||kind==="unread";
  const where=audienceClause(user,1)+` AND ($2::uuid IS NULL OR (n.created_at,n.id)<(SELECT created_at,id FROM notifications WHERE id=$2)) AND (NOT $3 OR (r.notification_id IS NULL AND n.resolved_at IS NULL)) AND ($4::text IN ('all','unread') OR n.kind=$4)`;
  const rows=(await query<Parameters<typeof rowToCard>[0]>(`SELECT n.*,r.notification_id IS NOT NULL AS read,n.resolved_at IS NOT NULL AS resolved,EXTRACT(EPOCH FROM now()-n.created_at)::int AS age_seconds,to_char(n.created_at AT TIME ZONE 'America/Chicago','Mon FMDD, HH12:MI AM') AS when_absolute FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 WHERE ${where} ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,[user.id,before,onlyUnread,kind,limit+1])).rows;
  const notifications=rows.slice(0,limit).map(rowToCard).map(n=>({...n,createdAt:new Date(n.createdAt).toISOString(),title:plainTitle(n.title),subline:plainNotice(n.subline),destination:destination(n.href,n.ref)}));
  return {total:notifications.length,decisionCount:notifications.filter(n=>n.actionable).length,unread,filters,notifications,hasMore:rows.length>limit,nextBefore:rows.length>limit?notifications.at(-1)?.id??null:null};
 });
}
