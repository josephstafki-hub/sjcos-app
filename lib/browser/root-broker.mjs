/** Protected nonroot adapter; never read root0600 registry directly. */
import {lstat} from 'node:fs/promises';
import {exchangeRendezvous} from './rendezvous-client.mjs';
import {UUID} from './phase1-contracts.mjs';
export async function rootBrokerCall(request){
 const socketPath=['readClaim','registration'].includes(request.op)?'/run/sjcos-browser/broker-authority.sock':'/run/sjcos-browser/broker.sock';
 const parent=await lstat('/run/sjcos-browser'),s=await lstat(socketPath);
 if(!parent.isDirectory()||parent.uid!==0||parent.mode&0o022||!s.isSocket()||s.uid!==0||s.mode&0o007)throw Error('BROWSER_BROKER_REFUSED');
 return exchangeRendezvous({socketPath,request,validate:r=>{if(r?.error)throw Error('BROWSER_BROKER_REFUSED');}});
}
export function createRootBroker({call=rootBrokerCall}={}){
 const id=run=>UUID.parse(run.run_id),children=new Map();
 return {
  async spawnHeld(run){const runId=id(run),r=await call({op:'spawnHeld',runId,taskId:UUID.parse(run.task.id),principalId:UUID.parse(run.task.initiator_user_id)});if(!Number.isSafeInteger(r.pid)||r.pid<2)throw Error('BROWSER_BROKER_REFUSED');const child={runId,pid:r.pid};children.set(runId,child);return child;},
  async register(run,child){const r=await call({op:'register',runId:id(run),pid:child.pid});if(r.pid!==child.pid||!/^\d+$/.test(r.start_ticks)||typeof r.cgroup!=='string'||!r.cgroup)throw Error('BROWSER_BROKER_REFUSED');UUID.parse(r.boot_id);return r;},
  async bindCapability(run,child,issued){if((await call({op:'bindCapability',runId:id(run),pid:child.pid,capability_hash:issued.capability_hash,expires_at:issued.expires_at})).ok!==true)throw Error('BROWSER_BROKER_REFUSED');},
  async release(run){if((await call({op:'release',runId:id(run)})).ok!==true)throw Error('BROWSER_BROKER_REFUSED');},
  async cancel(child){if(child){await call({op:'cancel',runId:child.runId});children.delete(child.runId);}},
  readClaim:(runId,kind='browser')=>call({op:'readClaim',runId:UUID.parse(runId),kind}),
  registration:(runId,kind='browser')=>call({op:'registration',runId:UUID.parse(runId),kind}),
 };
}
