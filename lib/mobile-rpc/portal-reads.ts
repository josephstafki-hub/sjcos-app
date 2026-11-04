import { query } from "@/lib/db";
import { ReadError } from "./field-reads";
import type { PortalAuthor } from "@/lib/portal-messages";
export const personInitials=(name:string)=>name.trim().split(/\s+/).filter(Boolean).map(w=>w[0]).filter(c=>/[a-z]/i.test(c)).slice(0,2).join("").toUpperCase();
export function plainIntake(value:string) {
  return value.replace(/received (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC(?: \(Gmail [^)]+\))?/gi,(_,stamp:string)=>new Date(stamp.replace(" ","T")+":00Z").toLocaleDateString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric"})).replace(/\s*\(Gmail [^)]+\)/gi,"");
}
export async function portalPage(channel:string,before:string|null) {
  if(before&&!/^\d{1,19}$/.test(before))throw new ReadError("Invalid message cursor");
  const {rows}=await query<{id:number;author:PortalAuthor;name:string;body:string;when:string;createdAt:string}>(`SELECT id,author_kind AS author,author_name AS name,body,to_char(created_at AT TIME ZONE 'America/Chicago','Mon FMDD · HH12:MI AM') AS when,created_at AS "createdAt" FROM chat_messages WHERE channel_key=$1 AND ($2::bigint IS NULL OR (created_at,id)<(SELECT created_at,id FROM chat_messages WHERE channel_key=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT 21`,[channel,before]);
  const messages=rows.slice(0,20).reverse().map(m=>({...m,createdAt:new Date(m.createdAt).toISOString(),initials:personInitials(m.name)}));
  return {messages,hasMore:rows.length>20,nextBefore:rows.length>20?String(messages[0].id):null};
}
