/** Bounded metadata-only Unix RPC, identical framing to Python UnixPolicy.
 * Sockets live in protected root-owned directories; no TCP/HTTP fallback. */
import path from 'node:path';
import {connect,createServer} from 'node:net';
import {chmod,lstat,unlink} from 'node:fs/promises';
import {trustedPath} from './protected-bootstrap.mjs';
const refused=()=>Error('BROWSER_CONTROLLER_RPC_REFUSED');
export function encodeFrame(value){const bytes=Buffer.from(JSON.stringify(value));if(!bytes.length||bytes.length>32768)throw refused();const head=Buffer.alloc(4);head.writeUInt32BE(bytes.length);return Buffer.concat([head,bytes]);}
export function frameReader(onMessage,onError){let data=Buffer.alloc(0),length=null,done=false;return chunk=>{if(done)return onError();if(data.length+chunk.length>32772){done=true;return onError();}data=Buffer.concat([data,chunk]);if(length===null&&data.length>=4){length=data.readUInt32BE();if(length<1||length>32768){done=true;return onError();}}if(length!==null&&data.length>=length+4){done=true;if(data.length!==length+4)return onError();try{const value=JSON.parse(data.subarray(4).toString('utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw refused();onMessage(value);}catch{onError();}}};}
export async function unixCall(socketPath,payload){
  await trustedPath(path.dirname(socketPath));const s=await lstat(socketPath);if(s.isSymbolicLink()||s.uid!==0||!s.isSocket()||(s.mode&0o007))throw refused();
  return new Promise((resolve,reject)=>{const socket=connect(socketPath);let done=false;const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(refused()):resolve(value);};socket.setTimeout(2000,()=>finish(true));socket.on('error',()=>finish(true));socket.on('end',()=>{if(!done)finish(true);});socket.once('connect',()=>{try{socket.write(encodeFrame(payload));}catch{finish(true);}});socket.on('data',frameReader(value=>value.ok===true?finish(false,value):finish(true),()=>finish(true)));});
}
export async function serveController(socketPath,handle){
  if(process.getuid()!==0||!/^\/run\/sjcos-browser\/controller-[a-f0-9-]{36}\.sock$/.test(socketPath))throw refused();
  await trustedPath('/run/sjcos-browser');const sockets=new Set();let busy=0;
  const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));if(busy>=8){socket.destroy();return;}socket.setTimeout(2000,()=>socket.destroy());socket.on('error',()=>{});socket.on('data',frameReader(async value=>{busy++;try{socket.end(encodeFrame(await handle(value)));}catch{socket.end(encodeFrame({ok:false}));}finally{busy--; }},()=>socket.destroy()));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);
  return {close:async()=>{for(const socket of sockets)socket.destroy();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    // Node already removes a listening Unix socket path on close; tolerate that, never mask the real error.
    await unlink(socketPath).catch(e=>{if(e?.code!=='ENOENT')throw e;});}};
}
