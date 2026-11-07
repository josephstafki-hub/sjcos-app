/** Installation adapter loader, executed nonroot. The separately trusted app
 * bridge is necessary because controller LOGIN has no table or approval rights.
 * This intentionally refuses an unprovisioned bridge, stale evidence or a
 * fixture-only installation. No root acceptance adapter fallback exists. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {trustedPath} from '../../lib/browser/protected-bootstrap.mjs';
import {sha256,runtimeReadiness} from '../../lib/browser/runtime-readiness.mjs';
import {assertProductionNamespace} from '../../lib/browser/launcher.mjs';
async function bridge(config){
 if(process.getuid()===0||config.phase!==1)throw Error('BROWSER_FORBIDDEN');
 const file='/etc/sjcos-browser/phase1-bridge.mjs';await trustedPath(file);
 if(!/^[0-9a-f]{64}$/.test(config.bridgeSha256??'')||sha256(await readFile(file))!==config.bridgeSha256)throw Error('BROWSER_BOOTSTRAP_REFUSED');
 return import(pathToFileURL(file).href);
}
export function validateServiceDependencies(deps){
 for(const name of ['verifyReadiness','verifyAccounting','handlers'])if(typeof deps[name]!=='function')throw Error('BROWSER_BOOTSTRAP_REFUSED');
 for(const name of ['runEnd','browser','authorize','transition','fence','reconcile','audit','release','privacyIO','resolveInput','deliverInput','begin','finish','commandResult','confirmFresh','navigationState','prepareNavigation','guardedNavigation','pausePublic','resumePublic'])if(typeof deps.io?.[name]!=='function')throw Error('BROWSER_BOOTSTRAP_REFUSED');
 return deps;
}
export async function serviceDependencies(config){
 const installed=await bridge(config),deps=validateServiceDependencies(await installed.serviceDependencies(config));
 const verify=deps.verifyReadiness;
 return {...deps,verifyReadiness:async()=>{
  const evidence=await verify();
  if(!runtimeReadiness(evidence?.attestation,evidence?.verifySignature).ok||evidence?.phase!==1||evidence?.releaseReady!==true)throw Error('BROWSER_RUNTIME_NOT_READY');
  // phase verification comes from the independent installer, never a boolean
  // supplied by an RPC caller. All named new runtime gates remain mandatory.
  for(const key of ['supervisorEvidenceSha256','privateCanaryEvidenceSha256','publicReadEvidenceSha256','staffParityEvidenceSha256','transportEvidenceSha256'])if(!/^[a-f0-9]{64}$/.test(evidence.attestation?.[key]??''))throw Error('BROWSER_RUNTIME_NOT_READY');
  await assertProductionNamespace();
 }};
}
export async function agentDependencies(config){
 const installed=await bridge(config),deps=await installed.agentDependencies(config);
 for(const name of ['admittedRun','checkAdmission','providerCredential','registerProcess','appendMessage','finishRun','failRun','purgeRunCache'])if(typeof deps.bridge?.[name]!=='function')throw Error('BROWSER_BOOTSTRAP_REFUSED');
 return deps;
}
/** Owner retention bridge runs in a separate bounded identity/unit, never the
 * controller's narrow LOGIN. The installed bridge owns the actual backend. */
export async function retentionDependencies(config){
 const installed=await bridge(config);
 if(typeof installed.retentionDependencies!=='function')throw Error('BROWSER_BOOTSTRAP_REFUSED');
 return installed.retentionDependencies(config);
}
