/** Installed verbatim at /opt/sjcos-browser/controller-adapter.mjs. Verify the
 * complete imported source graph before evaluating it. No model-selected path. */
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base='/opt/sjcos-browser/node/source';
async function trusted(file){for(let p=file;;p=path.dirname(p)){const s=await lstat(p);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('BROWSER_CONTROLLER_INSTALL_REFUSED');if(p==='/')break;}}
await trusted('/opt/sjcos-browser/runtime-lock.json');
const lock=JSON.parse(await readFile('/opt/sjcos-browser/runtime-lock.json','utf8'));
const required=['lib/browser/controller-adapter.mjs','lib/browser/controller.mjs','lib/browser/controller-authority.mjs','lib/browser/controller-gate.mjs','lib/browser/controller-rpc.mjs','lib/browser/controller-network.mjs','lib/browser/controller-scenarios.mjs','lib/browser/controller-mcp.mjs','lib/browser/acceptance-attestation.mjs','lib/browser/protected-bootstrap.mjs','lib/browser/runtime-readiness.mjs','lib/browser/startup.mjs','lib/browser/network-policy.mjs','lib/browser/gate.mjs','lib/browser/response-budget.mjs','lib/browser/contracts.mjs'];
for(const name of required)if(!lock.files?.[name])throw Error('BROWSER_CONTROLLER_INSTALL_REFUSED');
for(const [name,hash]of Object.entries(lock.files??{})){
  if(!/^(lib\/browser|deploy\/browser)\/[A-Za-z0-9_./-]+$/.test(name)&&name!=='mcp/browser-tools.mjs')continue;
  if(name.includes('..')||! /^[a-f0-9]{64}$/.test(hash))throw Error('BROWSER_CONTROLLER_INSTALL_REFUSED');
  await trusted(base+'/'+name);if(createHash('sha256').update(await readFile(base+'/'+name)).digest('hex')!==hash)throw Error('BROWSER_CONTROLLER_INSTALL_REFUSED');
}
const implementation=await import('/opt/sjcos-browser/node/source/lib/browser/controller-adapter.mjs');
export const {prepareAcceptance,runNetworkCases,browserMcpDependencies}=implementation;
