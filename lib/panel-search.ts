import "server-only";
import { requireUser } from "@/lib/dal";
import { staffMayOpen } from "@/lib/permissions";
import { query } from "@/lib/db";

export interface PanelSearchResult {
  id: string;
  kind: "page" | "project" | "lead" | "sub" | "vendor" | "client" | "invoice" | "thread";
  title: string;
  detail: string;
  href: string;
  recordId?: string;
  messageId?: string;
}
const PAGES = [
  ["Today","today"], ["Projects","projects"], ["Leads","leads"], ["Money","money"],
  ["Inbox","inbox"], ["Messages","messages"], ["Calls","calls"], ["Team chat","chat"],
  ["Schedule","schedule"], ["Subs","subs"], ["Vendors","vendors"], ["Files","files"],
  ["Website","site"], ["Newsletter","newsletter"], ["Catalog","catalog"], ["Cost book","cost-book"],
  ["Compliance","compliance"], ["Warranty","warranty"], ["Marketing","marketing"],
  ["Operations engine","engine"], ["Settings","settings"], ["Floor plan","floor"],
  ["Notifications","notifications"], ["Unsorted","unsorted"], ["Scan receipt","scan"],
  ["Workbench","workbench"], ["Time","time"], ["UI gallery","engine/ui"],
  ["Permissions","engine/permissions"], ["Measure","engine/measure"], ["Houzz exit","engine/houzz-exit"],
  ["Operator","panel"],
];
/** Every entry point rechecks DB-backed area access. No data from a denied
 * table is selected, including snippets. Staff panel history is restricted to
 * threads whose runs all belong to them; legacy/unattributed threads stay private. */
export async function searchPanel(raw: string, recordsOnly = false): Promise<PanelSearchResult[]> {
  const user = await requireUser();
  if (user.role !== "owner" && user.role !== "staff") return [];
  const may = (path: string) => user.role === "owner" || staffMayOpen(user.permissions, path);
  const q = raw.trim().slice(0, 120);
  const results: PanelSearchResult[] = recordsOnly ? [] : PAGES.filter(([title,path]) => may('/'+path) && title.toLowerCase().includes(q.toLowerCase()))
    .map(([title,path]) => ({id:'page:'+path,kind:'page',title,detail:'Go to page',href:'/'+path}));
  if (!q) return results;
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const searches: Promise<PanelSearchResult[]>[] = ([['project','projects'],['lead','leads'],['sub','subs'],['vendor','vendors']] as const)
    .filter(([,table])=>may('/'+table)).map(async ([kind,table]) => {
      const {rows}=await query<{id:string;slug:string;name:string}>(`SELECT id::text, slug, name FROM ${table} WHERE name ILIKE $1 ORDER BY name LIMIT 8`,[pattern]);
      return rows.map(r=>({id:`${kind}:${r.id}`,recordId:r.id,kind,title:r.name,detail:kind,href:`/${table}/${encodeURIComponent(r.slug)}`}));
    });
  if (may('/projects')) searches.push((async()=>{
    const {rows}=await query<{id:string;slug:string;client_name:string;name:string}>(`SELECT id::text, slug, client_name, name FROM projects WHERE client_name <> '' AND client_name ILIKE $1 ORDER BY client_name LIMIT 8`,[pattern]);
    return rows.map(r=>({id:'client:'+r.id,recordId:r.id,kind:'client' as const,title:r.client_name,detail:r.name,href:'/projects/'+encodeURIComponent(r.slug)}));
  })());
  if (user.role === 'owner' || user.permissions.includes('invoices')) searches.push((async()=>{
    const {rows}=await query<{id:string;slug:string;number:string;name:string;status:string}>(`SELECT i.id::text, i.number, p.slug, p.name, i.status FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.number ILIKE $1 OR p.name ILIKE $1 OR p.client_name ILIKE $1 ORDER BY i.created_at DESC LIMIT 8`,[pattern]);
    return rows.map(r=>({id:'invoice:'+r.id,recordId:r.id,kind:'invoice' as const,title:r.number || 'Invoice',detail:`${r.name} · ${r.status}`,href:'/projects/'+encodeURIComponent(r.slug)+'?tab=Money'}));
  })());
  if (!recordsOnly && may('/panel')) searches.push((async()=>{
    const {rows}=await query<{id:string;title:string;folder:string|null;body:string|null;message_id:string|null;status:string|null}>(
      `SELECT c.id::text, c.title, f.name AS folder, hit.body, hit.id::text AS message_id,
              (SELECT status FROM dev_agent_runs r WHERE r.conversation_id=c.id ORDER BY r.created_at DESC LIMIT 1) AS status
       FROM ai_conversations c LEFT JOIN ai_folders f ON f.id=c.folder_id
       LEFT JOIN LATERAL (SELECT id, left(body,240) AS body FROM ai_messages m WHERE m.conversation_id=c.id AND m.body ILIKE $1 ORDER BY m.created_at DESC LIMIT 1) hit ON true
       WHERE (c.title ILIKE $1 OR hit.id IS NOT NULL)
         AND ($2::boolean OR (EXISTS (SELECT 1 FROM dev_agent_runs r WHERE r.conversation_id=c.id AND r.principal_user_id=$3)
              AND NOT EXISTS (SELECT 1 FROM dev_agent_runs r WHERE r.conversation_id=c.id AND r.principal_user_id IS DISTINCT FROM $3::uuid)))
       ORDER BY c.updated_at DESC LIMIT 12`,[pattern,user.role==='owner',user.id]);
    return rows.map(r=>({id:'thread:'+r.id,recordId:r.id,messageId:r.message_id??undefined,kind:'thread' as const,title:r.title,detail:[r.folder,r.status,r.body].filter(Boolean).join(' · '),href:`/panel?c=${r.id}${r.message_id?'&m='+r.message_id:''}`}));
  })());
  return [...results,...(await Promise.all(searches)).flat()].slice(0,65);
}
