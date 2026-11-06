/** Both stdio hops use this startup before any tool registration. The broker
 * socket path is launcher-owned, never model argv or an HTTP fallback. */
import {connect} from 'node:net';
import {lstat} from 'node:fs/promises';
import {strictStartup} from './startup.mjs';
const fail=()=>Error('BROWSER_RENDEZVOUS_REFUSED');
export async function connectRendezvous({runId,kind,socketPath='/run/sjcos-browser/launch.sock'}) {
  if(!/^[a-f0-9-]{36}$/.test(runId)||!['browser','sjcos','interact'].includes(kind)||socketPath!=='/run/sjcos-browser/launch.sock')throw fail();
  const [parent,socket]=await Promise.all([lstat('/run/sjcos-browser'),lstat(socketPath)]);
  if(!parent.isDirectory()||parent.uid!==0||(parent.mode&0o022)||!socket.isSocket()||socket.uid!==0||(socket.mode&0o007))throw fail();
  return new Promise((resolve,reject)=>{
    const client=connect(socketPath),chunks=[];let bytes=0,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;client.destroy();error?reject(fail()):resolve(result);};
    client.setTimeout(2000,()=>finish(true));client.on('error',()=>finish(true));client.on('end',()=>{if(!settled)finish(true);});
    client.once('connect',()=>client.write(JSON.stringify({runId,kind})+'\n'));
    client.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)return finish(true);chunks.push(chunk);if(chunk.includes(10)){try{const x=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(x.runId!==runId||x.profile!=='browser'||typeof x.capability!=='string'||x.capability.length!==43||!x.taskId||!x.principalId||!x.dsn)throw fail();finish(false,x);}catch{finish(true);}}});
  });
}
export async function startupFromRendezvous({runId,taskId,kind,connectDb}) {
  const registration=await connectRendezvous({runId,kind});
  if(registration.taskId!==taskId)throw fail();
  const client=await strictStartup(kind==='browser'?'runner':kind,{env:{DATABASE_URL_AGENT:registration.dsn},connect:connectDb});
  const {dsn:_,...verifiedRun}=registration;
  return {client,verifiedRun}; // capability in process memory, never stdout/config.
}
