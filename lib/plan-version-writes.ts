// Shared transaction commands. Call inside BEGIN/COMMIT, never a pool's query.
// PostgreSQL jsonb::text is the canonical key-order/whitespace encoding used
// by backfill, the immutable insert trigger and collision-checked lookup.
import type { PoolClient } from 'pg';
import {migrateDoc, parseDoc} from './plan-doc.ts';
type Tx = Pick<PoolClient,'query'>;
export type PlanSnapshot = {id:string;design_id:string;number:number;source_rev:number|null;doc_sha256:string;doc:unknown};
const fail=(message:string):never=>{throw new Error(message);};
export async function lockPlanDesign(tx:Tx, id:string) {
 if(!/^[1-9][0-9]*$/.test(id)||BigInt(id)>BigInt('9223372036854775807'))fail('INVALID_INPUT');
 const d=(await tx.query('SELECT d.*,p.slug AS project_slug,l.id AS lead_id FROM plan_designs d LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN leads l ON l.slug=d.lead_slug WHERE d.id=$1 FOR UPDATE OF d',[id])).rows[0];
 if(!d)fail('CANVAS_UNAVAILABLE');return d;
}
function currentDoc(raw:unknown) {const p=parseDoc(migrateDoc(raw));if(!p.ok)throw Error('INVALID_INPUT');return p.doc;}
export async function ensurePlanSnapshot(tx:Tx,id:string,rev:number,actor:string|null,preferredId?:string):Promise<PlanSnapshot> {
 const d=await lockPlanDesign(tx,id);
 if(!Number.isSafeInteger(rev)||rev<0)fail('INVALID_INPUT');
 if(d.rev!==rev)fail('VERSION_CONFLICT');
 const doc=currentDoc(d.doc),bytes=JSON.stringify(doc);
 const hash=(await tx.query('SELECT plan_snapshot_hash($1::jsonb) AS hash',[bytes])).rows[0].hash;
 const matches=(await tx.query('SELECT * FROM plan_design_versions WHERE design_id=$1 AND doc_sha256=$2 ORDER BY number DESC',[id,hash])).rows;
 for(const m of matches){
  const equal=(await tx.query('SELECT $1::jsonb = $2::jsonb AS equal',[JSON.stringify(m.doc),bytes])).rows[0].equal;
  if(!equal)fail('SNAPSHOT_HASH_CONFLICT');
 }
 if(matches.length)return matches.find(m=>m.id===preferredId)??matches[0];
 return insertSnapshot(tx,id,bytes,rev,actor,'');
}
async function insertSnapshot(tx:Tx,id:string,doc:string,rev:number,actor:string|null,label:string):Promise<PlanSnapshot> {
 return (await tx.query(`INSERT INTO plan_design_versions(design_id,number,label,doc,source_rev,created_by) VALUES($1,1,$2,$3::jsonb,$4,$5) RETURNING *`,[id,label.trim().slice(0,80),doc,rev,actor])).rows[0];
}
export async function savePlanSnapshot(tx:Tx,id:string,actor:string|null,label=''):Promise<PlanSnapshot> {
 const d=await lockPlanDesign(tx,id);
 return insertSnapshot(tx,id,JSON.stringify(currentDoc(d.doc)),d.rev,actor,label);
}
export async function restorePlanSnapshot(tx:Tx,snapshotId:string,expectedRev:number,actor:string) {
 const v=(await tx.query('SELECT * FROM plan_design_versions WHERE id=$1',[snapshotId])).rows[0];
 if(!v)fail('CANVAS_UNAVAILABLE');
 const d=await lockPlanDesign(tx,v.design_id);
 if(d.rev!==expectedRev)fail('VERSION_CONFLICT');
 await savePlanSnapshot(tx,d.id,actor,`Before restoring v${v.number}`);
 return (await tx.query('UPDATE plan_designs SET doc=$2::jsonb,rev=rev+1,updated_by=$3,updated_at=now() WHERE id=$1 AND rev=$4 RETURNING rev',[d.id,JSON.stringify(currentDoc(v.doc)),actor,expectedRev])).rows[0];
}
