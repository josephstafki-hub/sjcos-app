import { randomUUID } from 'node:crypto';
import { query, queryOne } from '@/lib/db';
import { loadPrincipalUser } from '@/lib/authority/mcp-gate';
import { runDirect } from '@/lib/commands/db';
import { uuid } from '@/lib/checklist-coverage/manual';
export const runtime='nodejs';
export async function POST(request:Request) {
 const secret=process.env.CRON_SECRET?.trim();
 if(!secret || request.headers.get('authorization')!==`Bearer ${secret}`) return Response.json({ok:false,code:'CHECKLIST_FORBIDDEN'},{status:403});
 try {
 const b=await request.json();
 if(b.principal_revoked) return Response.json({ok:false,code:'CHECKLIST_FORBIDDEN'},{status:403});
 const user=await loadPrincipalUser(runDirect,b.principal_user_id,b.principal_auth_at);
 if(!user || (user.role!=='owner' && !(user.role==='staff' && user.permissions?.includes('comms')))) return Response.json({ok:false,code:'CHECKLIST_FORBIDDEN'},{status:403});
 const headers={'Cache-Control':'private, no-store'};
 if(b.action==='definitions') {
  if(b.kind && !['discovery_call','in_home_consult'].includes(b.kind)) throw new Error('CHECKLIST_INVALID_KIND');
  const definitions=await query(`SELECT d.id,d.key,d.kind,d.label,v.id AS version_id,v.version,v.contract_version,v.items FROM checklist_definitions d JOIN checklist_versions v ON v.id=d.current_version_id WHERE ($1::text IS NULL OR d.kind=$1)`,[b.kind??null]);
  return Response.json({ok:true,definitions:definitions.rows},{headers});
 }
 if(b.action!=='coverage' || (!!b.call_id===!!b.session_id)) throw new Error('CHECKLIST_INVALID_TARGET');
 let sessionId:string=b.session_id?uuid(b.session_id):'';
 if(!sessionId) {const row=await queryOne<{id:string}>('SELECT id FROM checklist_sessions WHERE call_id=$1',[uuid(b.call_id)]);if(!row) return Response.json({ok:true,coverage:null},{headers});sessionId=row.id;}
 const claims={subject:user.id,role:'agent',delegating_subject:user.id,areas:['comms'],run_id:randomUUID(),session_ids:[sessionId],create_scope:null,operations:['read'],expires_at:new Date(Date.now()+60000).toISOString(),nonce:randomUUID()};
 const c=await queryOne<{c:unknown}>('SELECT checklist_mint_context($1) c',[claims]);
 const r=await queryOne<{coverage:unknown}>(`SELECT checklist_read($1,$2,'rows') coverage`,[c!.c,sessionId]);
 return Response.json({ok:true,coverage:r!.coverage},{headers});
 }catch{return Response.json({ok:false,code:'CHECKLIST_UNAVAILABLE'},{status:400,headers:{'Cache-Control':'private, no-store'}});}
}
