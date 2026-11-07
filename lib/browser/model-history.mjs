/** Model context boundary. UI thread rendering is separate from model input.
 * A browser message/attachment/summary never becomes ordinary model context.
 * Missing provenance is unknown and excluded at in-memory boundaries. */
import {UUID} from './phase1-contracts.mjs';
export function filterModelHistory(rows,{profile='ordinary',taskId=null}={}){
 if(!Array.isArray(rows)||!['ordinary','browser'].includes(profile))throw Error('BROWSER_BAD_INPUT');
 if(profile==='browser')UUID.parse(taskId);
 return rows.filter(r=>r.trust_profile===profile&&(profile!=='browser'||r.browser_task_id===taskId));
}
export async function assertOrdinaryConversation(client,conversationId){
 UUID.parse(conversationId);
 const {rows}=await client.query(`SELECT EXISTS(SELECT 1 FROM ai_messages WHERE conversation_id=$1 AND trust_profile='browser') OR EXISTS(SELECT 1 FROM dev_agent_runs WHERE conversation_id=$1 AND profile='browser') AS tainted`,[conversationId]);
 if(rows.length!==1||rows[0].tainted!==false)throw Error('BROWSER_NEW_CONVERSATION_REQUIRED');
}
export async function appendBrowserMessage(client,{conversationId,taskId,runId,role,body}){
 for(const id of [conversationId,taskId,runId])UUID.parse(id);
 if(!['user','assistant'].includes(role)||typeof body!=='string'||Buffer.byteLength(body)>32768)throw Error('BROWSER_BAD_INPUT');
 // Website bridge only: SQL trigger verifies thread/task/run and actual owner
 // LOGIN. No browser DSN may INSERT protected message provenance directly.
 return (await client.query(`INSERT INTO ai_messages(conversation_id,run_id,role,body,agent,trust_profile,browser_task_id) VALUES($1,$2,$3,$4,'claude','browser',$5) RETURNING id`,[conversationId,runId,role,body,taskId])).rows[0];
}
