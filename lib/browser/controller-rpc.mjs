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

/** Phase 1 web RPC. HMAC is purpose separated from frames, request authority and
 * audit. validateRPC is structural only: authenticated proof consumption is the
 * injected SQL adapter, required for every method including read and stream. */
export function createProductionRpc({key,bootId,consumeProof,handlers,responseKey,clock=Date.now}){
 if(!(key instanceof Uint8Array)||key.length!==32||typeof consumeProof!=='function')throw refused();
 const nonces=new Map(),inflight=new Set();
 return async raw=>{
  const {validateRPC,webError}=await import('./phase1-contracts.mjs');
  const {createHmac,timingSafeEqual,createHash}=await import('node:crypto');
  const {canonical}=await import('./acceptance-attestation.mjs');
  try{
   const x=validateRPC(raw),{signature,...unsigned}=x,now=clock();
   if(Buffer.byteLength(JSON.stringify(x))>32768||x.boot_id!==bootId||Date.parse(x.issued_at)>now||Date.parse(x.expires_at)<=now||now-Date.parse(x.issued_at)>5000)throw refused();
   const h=createHmac('sha256',key).update('browser-phase1-web-rpc\0').update(canonical(unsigned)).digest();
   if(!timingSafeEqual(h,Buffer.from(signature,'hex'))||createHash('sha256').update(canonical(x.payload)).digest('hex')!==x.body_digest)throw refused();
   for(const [k,v] of nonces)if(v<=now)nonces.delete(k);
   if(nonces.has(x.nonce)||inflight.has(x.command_id)||nonces.size>=1024)throw refused();
   // No command/input retry here. SQL command proof owns immutable dedupe.
   nonces.set(x.nonce,Date.parse(x.expires_at));inflight.add(x.command_id);
   try{
    if(typeof handlers[x.method]!=='function'||await consumeProof(x)!==true)throw refused();
    const result=await handlers[x.method](x);
    encodeFrame(result);if(responseKey){if(!(responseKey instanceof Uint8Array)||responseKey.length!==32)throw refused();const data={command_id:x.command_id,boot_id:bootId,sequence:x.sequence,result};return {...data,signature:createHmac('sha256',responseKey).update(canonical(data)).digest('hex')};}return result;
   }finally{inflight.delete(x.command_id);}
  }catch{return webError('BROWSER_FORBIDDEN');}
 };
}

/** Separate binary frame channel: header <=4KiB, one JPEG <=160KiB (or bounded
 * human review image <=300KiB), never base64 inside the metadata socket. */
export async function encodeBinaryFrame(header,jpeg,key){
 const {BinaryHeader}=await import('./phase1-contracts.mjs');
 const {createHash,createHmac}=await import('node:crypto');
 const {canonical}=await import('./acceptance-attestation.mjs');
 if(!(key instanceof Uint8Array)||key.length!==32||!Buffer.isBuffer(jpeg))throw refused();
 const unsigned={...header,byte_length:jpeg.length,sha256:createHash('sha256').update(jpeg).digest('hex')};delete unsigned.signature;
 const signed=BinaryHeader.parse({...unsigned,signature:createHmac('sha256',key).update('browser-phase1-frame\0').update(canonical(unsigned)).digest('hex')});
 const h=Buffer.from(JSON.stringify(signed));if(h.length>4096)throw refused();const size=Buffer.alloc(4);size.writeUInt32BE(h.length);return Buffer.concat([size,h,jpeg]);
}
export async function decodeBinaryFrame(bytes,key,authorize){
 const {BinaryHeader}=await import('./phase1-contracts.mjs');const {createHash,createHmac,timingSafeEqual}=await import('node:crypto');const {canonical}=await import('./acceptance-attestation.mjs');
 if(!Buffer.isBuffer(bytes)||bytes.length<5||bytes.length>307200+4100||!(key instanceof Uint8Array)||key.length!==32||typeof authorize!=='function')throw refused();
 const n=bytes.readUInt32BE();if(n<1||n>4096||bytes.length<n+4)throw refused();
 const signed=BinaryHeader.parse(JSON.parse(bytes.subarray(4,n+4))),jpeg=bytes.subarray(n+4),{signature,...unsigned}=signed;
 if(jpeg.length!==signed.byte_length||createHash('sha256').update(jpeg).digest('hex')!==signed.sha256||!timingSafeEqual(Buffer.from(signature,'hex'),createHmac('sha256',key).update('browser-phase1-frame\0').update(canonical(unsigned)).digest())||await authorize(signed)!==true)throw refused();
 return {header:signed,jpeg};
}
/** Nonroot service socket, root-provisioned parent. No privileges are needed
 * to run controller/Chromium; peer/HMAC checks and a fixed path are mandatory. */
export async function serveProductionController({socketPath='/run/sjcos-browser-runtime/web.sock',uid,handle}){
 if(process.getuid()===0||process.getuid()!==uid||socketPath!=='/run/sjcos-browser-runtime/web.sock')throw refused();
 const parent=await lstat(path.dirname(socketPath));if(!parent.isDirectory()||parent.isSymbolicLink()||![0,uid].includes(parent.uid)||(parent.mode&0o007))throw refused();
 const sockets=new Set();let busy=0;
 const server=createServer(s=>{if(sockets.size>=8)return s.destroy();sockets.add(s);s.once('close',()=>sockets.delete(s));s.setTimeout(2000,()=>s.destroy());s.on('error',()=>{});s.on('data',frameReader(async x=>{if(busy>=8)return s.destroy();busy++;try{s.end(encodeFrame(await handle(x)));}catch{s.destroy();}finally{busy--; }},()=>s.destroy()));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o660);
 return {close:async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
}

/** Binary subscriber endpoint behind the fixed root-owned peer relay. It has
 * its own handshake/clock, one pending frame per viewer and independent HMAC.
 * authorize rechecks attendance/session/consent before every frame and each
 * second. subscribe is a protected capture callback, not CDP selected by JSON. */
export async function serveProductionFrames({uid,key,frameKey,authorize,subscribe,clock=Date.now}){
 const {z}=await import('zod'),{UUID,UInt}=await import('./phase1-contracts.mjs'),{canonical}=await import('./acceptance-attestation.mjs'),{createHmac,timingSafeEqual}=await import('node:crypto');
 const Hello=z.strictObject({v:z.literal(1),purpose:z.literal('browser-web-frame-open'),task_id:UUID,viewer_id:UUID,boot_id:UUID,stream_id:UUID,stream_generation:UInt.min(1),context_generation:UInt,issued_at:z.iso.datetime(),expires_at:z.iso.datetime(),nonce:UUID,signature:z.string().regex(/^[a-f0-9]{64}$/)});
 if(process.getuid()===0||process.getuid()!==uid||![key,frameKey].every(k=>k instanceof Uint8Array&&k.length===32)||typeof authorize!=='function'||typeof subscribe!=='function')throw refused();
 const socketPath='/run/sjcos-browser-runtime/frames.sock',parent=await lstat(path.dirname(socketPath));if(parent.isSymbolicLink()||![0,uid].includes(parent.uid)||(parent.mode&0o007))throw refused();
 const sockets=new Set(),nonces=new Map();
 const server=createServer(socket=>{
  if(sockets.size>=8)return socket.destroy();sockets.add(socket);let cleanup=()=>{},presence,expiry,pending=null,sending=false,closed=false;
  const close=()=>{if(closed)return;closed=true;pending=null;clearInterval(presence);clearTimeout(expiry);cleanup();socket.destroy();sockets.delete(socket);};
  socket.on('close',close);socket.on('error',close);socket.setTimeout(2000,close);
  const writeLatest=async()=>{if(sending||closed||!pending)return;sending=true;const frame=pending;pending=null;try{if(await authorize(frame.hello)!==true)throw refused();const packet=await encodeBinaryFrame(frame.header,frame.jpeg,frameKey);if(closed)return;if(await authorize(frame.hello)!==true)throw refused();if(closed)return;if(!socket.write(packet))await new Promise(resolve=>{socket.once('drain',resolve);socket.once('close',resolve);});}catch{close();}finally{sending=false;if(pending&&!closed)void writeLatest();}};
  const reader=frameReader(async raw=>{
   try{
    const h=Hello.parse(raw),{signature,...unsigned}=h,now=clock();
    for(const [n,t]of nonces)if(t<=now)nonces.delete(n);
    if(nonces.size>=1024||nonces.has(h.nonce)||Date.parse(h.issued_at)>now||Date.parse(h.expires_at)<=now||Date.parse(h.expires_at)-Date.parse(h.issued_at)>5000||!timingSafeEqual(Buffer.from(signature,'hex'),createHmac('sha256',key).update(canonical(unsigned)).digest())||await authorize(h)!==true)throw refused();
    nonces.set(h.nonce,Date.parse(h.expires_at));socket.setTimeout(15000,close);
    cleanup=await subscribe(h,({header,jpeg})=>{
     if(closed)return;
     for(const field of ['task_id','viewer_id','boot_id','stream_id','stream_generation','context_generation'])if(header[field]!==h[field])return close();
     pending={header,jpeg,hello:h};void writeLatest();
    });if(closed){cleanup();return;}
    presence=setInterval(()=>{void authorize(h).then(ok=>{if(ok!==true)close();},close);},1000);expiry=setTimeout(close,60000);
   }catch{close();}
  },close);
  socket.on('data',reader);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);
 return {close:async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
}
