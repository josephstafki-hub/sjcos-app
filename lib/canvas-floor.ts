// Floor hooks for the existing authenticated Canvas transaction. The caller
// retains thread fencing, provenance, CAS, request/event/quota and flag gates.
// Never call from an unfenced route or expose any of these SQL rows directly.
import type {PoolClient} from 'pg';
import {ensurePlanSnapshot,savePlanSnapshot,lockPlanDesign,type PlanSnapshot} from './plan-version-writes.ts';
import {floorBoundaryId,floorPreviewProps} from './canvas-floor-preview.ts';
type Tx=Pick<PoolClient,'query'>;
type Person={id:string;role:string;permissions:string[];active?:boolean};
type Actor={person:Person};
type Scope={project_id:string|null;lead_id:string|null};
type Canvas=Scope&{id:string;owner_user_id:string;conversation_id?:string};
const unavailable=():never=>{throw Error('CANVAS_UNAVAILABLE');};
export function assertFloorAccess(person:Person,design:{project_id?:string|null;lead_slug?:string|null;is_template?:boolean},allowTemplate=false) {
 if(person.active===false||!['owner','staff'].includes(person.role))unavailable();
 if(person.role!=='owner'&&(!person.permissions.includes('projects')||(design.lead_slug&&!person.permissions.includes('leads'))))unavailable();
 if((design.is_template&&!allowTemplate)||(!design.project_id&&!design.lead_slug&&!(design.is_template&&allowTemplate)))unavailable();
}
export async function prepareFloorCanvas(tx:Tx,actor:Actor,content:{kind:string;design_id:string;expected_design_rev:number},scope?:Scope&{id?:string;latest_version?:number}) {
 if(content.kind!=='floor_plan')throw Error('INVALID_INPUT');
 floorBoundaryId(content.design_id); // legacy Designer uses safe JS number IDs
 const d=await lockPlanDesign(tx,content.design_id);
 assertFloorAccess(actor.person,d);
 if(scope&&(scope.project_id!==d.project_id||scope.lead_id!==d.lead_id))unavailable();
 let preferredId:string|undefined;
 if(scope?.id){
  const old=await floorVersionMeta(tx,String(scope.id),Number(scope.latest_version));
  if(old&&old.id!==d.id)unavailable();
  preferredId=old?.snapshot_id;
 }
 const snapshot=await ensurePlanSnapshot(tx,d.id,content.expected_design_rev,actor.person.id,preferredId);
 const source=JSON.stringify({kind:'floor_plan',design_id:d.id,snapshot_id:snapshot.id});
 return {snapshot,source,project_id:d.project_id,project_slug:d.project_slug,lead_id:d.lead_id,lead_slug:d.lead_slug,design:{id:d.id,snapshot_id:snapshot.id,number:snapshot.number,rev:d.rev}};
}
export async function attachFloorCanvas(tx:Tx,canvas:Canvas,version:number,snapshot:PlanSnapshot) {
 await tx.query('INSERT INTO ask_canvas_floor_refs(canvas_id,version,design_id,snapshot_id) VALUES($1,$2,$3,$4)',[canvas.id,version,snapshot.design_id,snapshot.id]);
}
// Internal metadata only: callers must first fence the owned live thread and
// current floor scope. The name is current, even for a historical snapshot.
export async function floorVersionMeta(tx:Tx,canvasId:string,version:number) {
 const r=(await tx.query(`SELECT v.id,v.design_id,v.number,v.source_rev,d.name FROM ask_canvas_floor_refs f JOIN plan_design_versions v ON (v.id,v.design_id)=(f.snapshot_id,f.design_id) JOIN plan_designs d ON d.id=f.design_id WHERE f.canvas_id=$1 AND f.version=$2`,[canvasId,version])).rows[0];
 return r?{id:r.design_id,snapshot_id:r.id,number:r.number,rev:r.source_rev??0,name:r.name}:null;
}
export async function readFloorCanvas(tx:Tx,actor:Actor,canvas:Canvas,version:number) {
 if(canvas.owner_user_id!==actor.person.id)unavailable();
 const r=(await tx.query(`SELECT v.*,d.name,d.rev,d.project_id,d.lead_slug,d.is_template,p.slug AS project_slug,l.id AS lead_id
 FROM ask_canvas_floor_refs f JOIN plan_design_versions v ON (v.id,v.design_id)=(f.snapshot_id,f.design_id)
 JOIN plan_designs d ON d.id=f.design_id LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN leads l ON l.slug=d.lead_slug
 WHERE f.canvas_id=$1 AND f.version=$2`,[canvas.id,version])).rows[0];
 if(!r)unavailable();assertFloorAccess(actor.person,r);
 if(canvas.project_id!==r.project_id||canvas.lead_id!==r.lead_id)unavailable();
 // Compare canonical content, not snapshot.source_rev: restoring identical
 // content legitimately reuses a snapshot made at an older live revision.
 const current=(await tx.query(`SELECT v.doc=m.doc AS equal FROM plan_designs d CROSS JOIN LATERAL(SELECT d.doc) m JOIN plan_design_versions v ON v.id=$2 WHERE d.id=$1`,[r.design_id,r.id])).rows[0];
 // Successful reads already passed the full-designer Projects + scoped Leads
 // gate above; templates remain unavailable through Canvas.
 return {canEdit:true,props:floorPreviewProps(r),snapshotId:r.id,designId:r.design_id,number:r.number,latestRev:r.rev,changed:!current?.equal,href:`/floor/${r.design_id}`};
}
export async function restoreFloorCanvas(tx:Tx,actor:Actor,canvas:Canvas,from:number,to:number) {
 const view=await readFloorCanvas(tx,actor,canvas,from);
 const snapshot=(await tx.query('SELECT * FROM plan_design_versions WHERE id=$1',[view.snapshotId])).rows[0];
 await attachFloorCanvas(tx,canvas,to,snapshot);return snapshot as PlanSnapshot;
}
export const FLOOR_DELETE_MESSAGE="A canvas still uses this floor plan, so it can't be deleted yet. Canvases deleted in the last 30 days count too.";
export type FloorDeletionBlock={message:string;links:{title:string;href:string}[]};
export async function floorDeletionBlock(tx:Tx,person:Person,designId:string,snapshotId?:string):Promise<FloorDeletionBlock|null> {
 // Owner command only; narrow MCP never SELECTs private refs for deletion.
 const refs=(await tx.query(`SELECT c.id,c.owner_user_id,c.project_id,c.lead_id,c.deleted_at,c.hold_until,t.deleted_at AS thread_deleted,t.purge_hold,t.owner_user_id AS thread_owner,c.required_areas,v.title,v.version
 FROM ask_canvas_floor_refs f JOIN ask_canvases c ON c.id=f.canvas_id JOIN ai_conversations t ON t.id=c.conversation_id
 JOIN ask_canvas_versions v ON (v.canvas_id,v.version)=(f.canvas_id,f.version)
 WHERE f.design_id=$1 AND ($2::bigint IS NULL OR f.snapshot_id=$2)`,[designId,snapshotId??null])).rows;
 if(!refs.length)return null;
 const own=person.active!==false&&refs.every(r=>r.owner_user_id===person.id&&!r.deleted_at&&!r.hold_until&&!r.thread_deleted&&!r.purge_hold&&r.thread_owner===person.id&&(person.role==='owner'||(person.permissions.includes('projects')&&(!r.lead_id||person.permissions.includes('leads'))))&&(person.role==='owner'||r.required_areas.every((a:string)=>person.permissions.includes(a))));
 return own?{message:`This floor plan is used by your canvas "${refs[0].title}".`,links:[...new Map(refs.map(r=>[r.id,{title:r.title,href:`/panel/canvas/${r.id}?v=${r.version}`}])).values()]}:{message:FLOOR_DELETE_MESSAGE,links:[]};
}

export async function prepareFloorRestore(tx:Tx,actor:Actor,canvas:Canvas,version:number) {
 const view=await readFloorCanvas(tx,actor,canvas,version);
 const snapshot=(await tx.query('SELECT * FROM plan_design_versions WHERE id=$1',[view.snapshotId])).rows[0] as PlanSnapshot;
 return {snapshot,source:JSON.stringify({kind:'floor_plan',design_id:snapshot.design_id,snapshot_id:snapshot.id}),project_id:canvas.project_id,lead_id:canvas.lead_id,design:{id:snapshot.design_id,snapshot_id:snapshot.id,number:snapshot.number,rev:snapshot.source_rev??0}};
}
/** Admitted panel floor MCP save: app transaction sees private refs; MCP does
 * not get private SELECT grants or its own snapshot allocation implementation. */
export async function saveFloorVersion(tx:Tx,actor:Actor,input:Record<string,unknown>) {
 const id=String(input.design_id);floorBoundaryId(id);
 const d=await lockPlanDesign(tx,id);assertFloorAccess(actor.person,d);
 if(!Number.isSafeInteger(input.expected_design_rev)||d.rev!==input.expected_design_rev)throw Error('VERSION_CONFLICT');
 const v=await savePlanSnapshot(tx,id,actor.person.id,String(input.label??''));
 return {ok:true,id:v.id,number:v.number};
}
