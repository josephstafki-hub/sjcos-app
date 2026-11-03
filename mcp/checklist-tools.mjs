import {z} from 'zod';
export function registerChecklistTools(server,{json,checklistCall}) {
 server.registerTool('get_call_coverage',{title:'Read discovery checklist',description:'Read-only checklist rows and pinned version. Does not capture, dial, edit, or send.',inputSchema:{call_id:z.string().uuid().optional(),session_id:z.string().uuid().optional()}},async input=>{
 if(!!input.call_id===!!input.session_id) return json({ok:false,code:'CHECKLIST_INVALID_TARGET'});
 return json(await checklistCall('coverage',input));
 });
 server.registerTool('list_checklist_definitions',{title:'List checklist definitions',description:'Read-only current published checklist versions.',inputSchema:{kind:z.enum(['discovery_call','in_home_consult']).optional()}},async input=>json(await checklistCall('definitions',input)));
}
