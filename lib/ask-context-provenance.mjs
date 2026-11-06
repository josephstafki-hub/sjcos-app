import {CLASSIFICATION_REGISTRY, CONTENT_AREAS} from './canvas-classification.mjs';
/** Called under the Canvas thread lock. Never infers sensitivity from the actor.
 * Absent, pending, legacy, interrupted or unknown context always means full C.
 * No private text is copied into the immutable Canvas version manifest. */
export async function conversationProvenance({client,threadId}) {
 const state=(await client.query('SELECT * FROM ask_context_provenance WHERE conversation_id=$1',[threadId])).rows[0];
 if(!state)return {complete:false,areas:null,revision:0,inputs:[]};
 const rows=(await client.query('SELECT id,kind,ref,state,complete,areas,output_hash FROM ask_context_inputs WHERE conversation_id=$1 ORDER BY id',[threadId])).rows;
 const complete=!state.unknown&&!!state.epoch_run_id&&state.tracker_version===1&&state.classifier_version===CLASSIFICATION_REGISTRY.version&&rows.every(r=>r.state==='resolved'&&r.complete&&r.output_hash&&r.areas.every(a=>CONTENT_AREAS.includes(a)));
 const union=new Set(rows.flatMap(r=>r.areas));
 return {complete,areas:complete?CONTENT_AREAS.filter(a=>union.has(a)).sort():null,revision:Number(state.revision),inputs:rows.filter(r=>r.output_hash).map(r=>({ref:`${r.kind}:${r.id}`,hash:r.output_hash,areas:[...r.areas].sort()}))};
}
