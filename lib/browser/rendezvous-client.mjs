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
  return exchangeRendezvous({socketPath,request:{runId,kind},validate:x=>validateRegistration(x,{runId})});
}
/** Transport primitive used by the protected production client and disposable
 * Unix-socket tests. This does not grant startup or bypass socket ownership. */
export function exchangeRendezvous({socketPath,request,validate}) {
  return new Promise((resolve,reject)=>{
    const client=connect(socketPath),chunks=[];let bytes=0,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;client.destroy();error?reject(fail()):resolve(result);};
    client.setTimeout(2000,()=>finish(true));client.on('error',()=>finish(true));client.on('end',()=>{if(!settled)finish(true);});
    client.once('connect',()=>client.write(JSON.stringify(request)+'\n'));
    client.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)return finish(true);chunks.push(chunk);if(chunk.includes(10)){try{const x=JSON.parse(Buffer.concat(chunks).toString('utf8'));validate(x);finish(false,x);}catch{finish(true);}}});
  });
}

const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
export function validateRegistration(x,{runId,taskId}={}) {
  if(!x||Object.keys(x).sort().join(',')!=='capability,dsn,principalId,profile,runId,taskId'||x.runId!==runId||taskId&&x.taskId!==taskId||![x.runId,x.taskId,x.principalId].every(uuid)||x.profile!=='browser'||! /^[A-Za-z0-9_-]{43}$/.test(x.capability)||typeof x.dsn!=='string'||x.dsn.length>8192)throw fail();
  return x;
}
export async function startupFromRegistration({registration,runId,taskId,kind,connectDb}) {
  if(!['browser','sjcos','interact'].includes(kind))throw fail();
  validateRegistration(registration,{runId,taskId});
  const key=kind==='browser'?'DATABASE_URL_BROWSER':'DATABASE_URL_AGENT';
  const client=await strictStartup(kind,{env:{[key]:registration.dsn},connect:connectDb});
  const {dsn:_,...verifiedRun}=registration;
  return {client,verifiedRun};
}
export async function startupFromRendezvous({runId,taskId,kind,connectDb}) {
  return startupFromRegistration({registration:await connectRendezvous({runId,kind}),runId,taskId,kind,connectDb});
}
/** Root launcher registers its direct CLI child before releasing stdin. Socket
 * peer is kernel-authenticated by the broker, not a caller-provided uid. */
export async function registerCliPeer(record) {
  if(process.getuid()!==0)throw fail();
  const [parent,socket]=await Promise.all([lstat('/run/sjcos-browser'),lstat('/run/sjcos-browser/launch.sock')]);
  if(!parent.isDirectory()||parent.uid!==0||(parent.mode&0o022)||!socket.isSocket()||socket.uid!==0||(socket.mode&0o007))throw fail();
  await exchangeRendezvous({socketPath:'/run/sjcos-browser/launch.sock',request:{op:'register',...record},validate:r=>{if(r.registered!==true||r.runId!==record.runId)throw fail();}});
}
