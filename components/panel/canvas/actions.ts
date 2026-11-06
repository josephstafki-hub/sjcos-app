'use server';
import {pool} from '@/lib/db';
import type {Availability} from '@/lib/canvas-api-types';
import {threadPrincipal,requireThreadAccess,askFailure} from '@/lib/thread-access';
export async function canvasPanelIdentity(threadId:string|null){
 if(process.env.SJC_CANVAS_ENABLED!=='1')return {ok:false as const,code:'CANVAS_DISABLED'};
 try{const user=await threadPrincipal();if(threadId)await requireThreadAccess(threadId,user);if(!threadId){
   const rows=await pool.query("SELECT key,value FROM app_settings WHERE key=ANY($1)",[['canvas.staff_enabled','canvas.diagrams_enabled','canvas.pages_enabled','canvas.floor_enabled']]);
   const flags=Object.fromEntries(rows.rows.map(r=>[r.key,r.value===true||r.value==='true']));
   const master=user.role==='owner'||flags['canvas.staff_enabled']===true;
   const availability:Availability={revision:'empty',master,diagrams:master&&flags['canvas.diagrams_enabled']===true,pages:master&&flags['canvas.pages_enabled']===true,floor:master&&flags['canvas.floor_enabled']===true,exports:false,staff:master,source:false};
   return {ok:true as const,userId:user.id,availability};
  }
  return {ok:true as const,userId:user.id};}catch(e){return askFailure(e);}
}
