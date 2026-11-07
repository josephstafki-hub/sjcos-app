/** Effective Phase 1 switches. Runtime readiness/authority are separate gates. */
import {UUID} from './phase1-contracts.mjs';
export const BOOLEAN_FLAG_KEYS=Object.freeze(['enabled','staff_enabled','vault_enabled','files_enabled','final_steps_enabled','permit_handoff_enabled']);
export const LATER_PHASE_FLAGS=Object.freeze(BOOLEAN_FLAG_KEYS.slice(2));
function list(raw){try{const v=typeof raw==='string'?JSON.parse(raw):raw;return Array.isArray(v)&&v.every(x=>UUID.safeParse(x).success)?[...new Set(v)]:[];}catch{return [];}}
export function evaluatePhase1Flags({settings={},env={},user=null}={}){
 const get=k=>settings instanceof Map?settings.get(k):settings[k];
 const yes=k=>get('browser.'+k)===true||get('browser.'+k)==='true';
 const enabled=env.SJC_BROWSER_ENABLED==='1'&&yes('enabled');
 const flags=Object.fromEntries(BOOLEAN_FLAG_KEYS.map(k=>[k,k==='enabled'?enabled:k==='staff_enabled'?yes(k):false]));
 const pilot_user_ids=list(get('browser.pilot_user_ids'));
 const can_start=enabled&&user?.active===true&&pilot_user_ids.includes(user.id)&&(user.role==='owner'||(user.role==='staff'&&flags.staff_enabled));
 const suppress_takeover_confirm=can_start&&user.role==='owner'&&list(get('browser.takeover_confirm_suppressed_user_ids')).includes(user.id);
 return {enabled,staff_enabled:flags.staff_enabled,flags,can_start,reason_code:can_start?null:'BROWSER_DISABLED',pilot_user_ids,suppress_takeover_confirm};
}

/** QA side builds only. The database identity is read from the connected pool;
 * an env DSN/name is never evidence. No I/O on the ordinary production path. */
export async function qaBrowserDirectory(db,env=process.env){
 if(env.SJC_QA_SIDE_BUILD!=='1'||!env.SJC_QA_BROWSER_FAKE)return null;
 const dir=env.SJC_QA_BROWSER_FAKE;
 if(!/^\/home\/joe\/qa-sjcos\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(dir))throw Error('BROWSER_DISABLED');
 const {rows}=await db.query('SELECT current_database() AS name');
 if(!/^sjcos_qa_[a-z0-9_]+$/.test(rows[0]?.name??''))throw Error('BROWSER_DISABLED');
 return dir;
}
