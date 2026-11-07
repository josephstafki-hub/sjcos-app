/** QA ONLY source overlay. Copied over ONE production leaf before compilation.
 * The ordinary source/artifact never imports this module. Local audit custody
 * and inert process bindings are screenshot fixtures, not runtime acceptance.
 */
import 'server-only';
import {lstat} from 'node:fs/promises';
import type {Pool} from 'pg';
import type {WebsiteHooks} from '../../lib/browser/web';
import type {WebController} from '../../lib/browser/web-rpc';
import {evaluatePhase1Flags} from '../../lib/browser/phase-flags.mjs';
import {createQaWebsiteHooks,qaGuard,qaPrivatePath,loadQaKeys} from '../../scripts/qa-browser-fake-controller.mjs';

function directory(){
 const dir=process.env.SJC_QA_BROWSER_FAKE;
 if(process.env.SJC_QA_SIDE_BUILD!=='1'||!dir||!/^\/home\/joe\/qa-sjcos\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(dir))throw Error('BROWSER_DISABLED');
 return dir;
}
async function socketPath(kind:'control'|'frames'){
 const dir=directory();await qaPrivatePath(dir);const target=dir+'/'+kind+'.sock',st=await lstat(target);
 if(st.isSymbolicLink()||!st.isSocket()||st.uid!==process.getuid!()||(st.mode&0o077))throw Error('BROWSER_SERVICE_UNAVAILABLE');
 return target;
}
export function browserWebEndpoint(){return {socketPath,
 control:directory()+'/control.sock',frames:directory()+'/frames.sock',
 keys:()=>({key:Buffer.from(process.env.SJC_BROWSER_WEB_RPC_KEY??'','hex'),responseKey:Buffer.from(process.env.SJC_BROWSER_WEB_RESPONSE_KEY??'','hex'),frameKey:Buffer.from(process.env.SJC_BROWSER_FRAME_KEY??'','hex')}),
};}
export async function loadWebsiteTrust(input:{db:Pool;key:Buffer;controller:WebController}):Promise<WebsiteHooks>{
 const dir=await qaGuard(input.db);
 const identity=(await input.db.query('SELECT session_user,current_user,rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0];
 if(identity?.session_user!=='sjcos'||identity.current_user!=='sjcos'||identity.rolsuper)throw Error('BROWSER_DISABLED');
 await qaPrivatePath(dir);const keys=await loadQaKeys(dir) as Record<'request'|'response'|'frame',Buffer>;if(!input.key.equals(keys.request))throw Error('BROWSER_DISABLED');
 return createQaWebsiteHooks({...input,dir});
}
export function readinessSource(){return {evaluateFlags:evaluatePhase1Flags};}
