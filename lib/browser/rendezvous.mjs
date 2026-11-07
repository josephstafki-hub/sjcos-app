/** The Python SO_PEERCRED helper supplies kernelPid/kernelUid and /proc proof;
 * never accept those from a request body. One-shot slots, no reconnect/reissue. */
import {randomBytes} from 'node:crypto';
export class LaunchRegistry {
  #runs=new Map();
  register(record){if(this.#runs.has(record.runId)||!Number.isSafeInteger(record.pid)||!record.startTime||!record.cgroup||!record.executables)throw Error('BROWSER_RENDEZVOUS_REFUSED');this.#runs.set(record.runId,{...structuredClone(record),slots:new Set(['browser','sjcos','interact'])});}
  consume(request,peer){const r=this.#runs.get(request.runId);if(!r||Object.keys(request).sort().join(',')!=='kind,runId'||!r.slots.has(request.kind)||peer.uid!==r.uid||peer.cgroup!==r.cgroup||!peer.ancestors?.some(x=>x.pid===r.pid&&x.startTime===r.startTime)||peer.scriptDigest!==r.executables[request.kind]||!peer.executableDigest||peer.executableDigest!==r.nodeDigest||!peer.startTime)throw Error('BROWSER_RENDEZVOUS_REFUSED');r.slots.delete(request.kind);return {capability:randomBytes(32).toString('base64url'),runId:r.runId,taskId:r.taskId,principalId:r.principalId,profile:'browser'};}
  revoke(runId){this.#runs.delete(runId);}
}
