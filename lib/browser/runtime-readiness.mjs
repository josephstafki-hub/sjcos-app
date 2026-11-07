/** No activation based on package metadata. Every unimplemented or unmeasured
 * boundary is a named blocker, not an invented attestation. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyRuntimeFiles(root,lock) {
  const failures=[];
  for(const [file,hash]of Object.entries(lock.files??{})){
    if(!/^(lib\/browser|deploy\/browser)\/[A-Za-z0-9_./-]+$/.test(file)||file.includes('..')){failures.push(file);continue;}
    try{if(sha256(await readFile(`${root}/${file}`))!==hash)failures.push(file);}catch{failures.push(file);}
  }
  return {ok:failures.length===0&&Object.keys(lock.files??{}).length>0,failures,releaseReady:false};
}
export function runtimeReadiness(attestation,verifySignature) {
  const required=['parserPatchSha256','patchedBundleSha256','playwrightPatchSha256','pythonTransitiveLockSha256','namespaceEvidenceSha256','rssEvidenceSha256','cliResolvedPolicyEvidenceSha256','rendezvousEvidenceSha256','sandboxEvidenceSha256','reviewApprovalSha256'];
  const blockers=required.filter(k=>!/^[a-f0-9]{64}$/.test(attestation?.[k]??''));
  if(!attestation||typeof verifySignature!=='function'||verifySignature(attestation)!==true)blockers.push('signed-root-attestation');
  return {ok:blockers.length===0,blockers};
}
