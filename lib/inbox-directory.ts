import { query } from './db';
export type InboxLinkKind = 'project'|'lead'|'sub'|'vendor';
export interface InboxDirectoryEntry {slug:string;name:string;email:string|null;role:string;kind:InboxLinkKind;job:string|null;match:'email'|'domain'|'search'}
/** Whole directory, not the loaded inbox page. Exact addresses rank ahead of
 * domain suggestions. A match is a suggestion, never an automatic identity link. */
export async function searchInboxDirectory(search:string, sender:string):Promise<InboxDirectoryEntry[]> {
  const {rows}=await query<InboxDirectoryEntry>(`WITH directory AS (
    SELECT l.slug,l.name,l.email,CASE WHEN EXISTS(SELECT 1 FROM projects p WHERE p.lead_id=l.id) THEN 'Client' ELSE 'Lead' END AS role,'lead' AS kind,
      (SELECT string_agg(p.name,', ' ORDER BY p.name) FROM projects p WHERE p.lead_id=l.id) AS job FROM leads l
    UNION ALL SELECT p.slug,p.name,COALESCE(NULLIF(p.client_email,''),l.email),'Job','project',p.name FROM projects p LEFT JOIN leads l ON l.id=p.lead_id
    UNION ALL SELECT s.slug,s.name,s.email,'Sub','sub',(SELECT string_agg(p.name,', ' ORDER BY p.name) FROM project_subs ps JOIN projects p ON p.id=ps.project_id WHERE ps.sub_slug=s.slug) FROM subs s
    UNION ALL SELECT v.slug,v.name,v.email,'Vendor','vendor',(SELECT string_agg(DISTINCT p.name,', ') FROM purchase_orders po JOIN projects p ON p.id=po.project_id WHERE po.vendor_id=v.id) FROM vendors v
  ) SELECT *,CASE WHEN lower(email)=$2 THEN 'email' WHEN $2<>'' AND split_part(lower(email),'@',2)=split_part($2,'@',2) THEN 'domain' ELSE 'search' END AS match
    FROM directory WHERE ($1<>'' AND (name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR job ILIKE '%'||$1||'%'))
      OR ($1='' AND $2<>'' AND (lower(email)=$2 OR split_part(lower(email),'@',2)=split_part($2,'@',2)))
    ORDER BY CASE WHEN lower(email)=$2 THEN 0 WHEN $2<>'' AND split_part(lower(email),'@',2)=split_part($2,'@',2) THEN 1 ELSE 2 END,name,kind LIMIT 40`,[search.trim().slice(0,160),sender.toLowerCase()]);
  return rows;
}
