/** Production trust boundary. An isolated QA artifact may replace this ONE leaf
 * at build time. Runtime environment/database names never select alternate trust.
 * browserWebEndpoint: fixed root-owned sockets + production purpose-separated keys.
 * loadWebsiteTrust: protected installed website bridge (including audit evidence).
 * readinessSource: production feature eligibility; runtime/independent evidence
 * remains verified by the protected bridge and service, never inferred here.
 */
import 'server-only';
import {lstat} from 'node:fs/promises';
import type {Pool} from 'pg';
import type {WebController} from './web-rpc';
import {loadWebsiteBridge} from './website-bridge.mjs';
import {evaluatePhase1Flags} from './phase-flags.mjs';
async function socketPath(kind:'control'|'frames'){
 const path=`/run/sjcos-browser/${kind}.sock`;
 if(!/^\/run\/sjcos-browser\/(?:control|frames)\.sock$/.test(path))throw Error('BROWSER_SERVICE_UNAVAILABLE');
 for(const part of ['/run','/run/sjcos-browser',path]){const s=await lstat(part);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o002)||(part===path?!s.isSocket():!s.isDirectory()))throw Error('BROWSER_SERVICE_UNAVAILABLE');}
 return path;
}
export function browserWebEndpoint(){return {socketPath,
 control:'/run/sjcos-browser/control.sock',frames:'/run/sjcos-browser/frames.sock',
 keys:()=>({key:Buffer.from(process.env.SJC_BROWSER_WEB_RPC_KEY??'','hex'),responseKey:Buffer.from(process.env.SJC_BROWSER_WEB_RESPONSE_KEY??'','hex'),frameKey:Buffer.from(process.env.SJC_BROWSER_FRAME_KEY??'','hex')}),
};}
export function loadWebsiteTrust(input:{db:Pool;key:Buffer;controller:WebController}){return loadWebsiteBridge(input);}
export function readinessSource(){return {evaluateFlags:evaluatePhase1Flags};}
