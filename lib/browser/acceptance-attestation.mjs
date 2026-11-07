/** Independent reviewer signature verification. Never creates a trust key or
 * signs its own acceptance. Installation integrity and acceptance are separate. */
import {createPublicKey,verify} from 'node:crypto';
import {open,constants} from 'node:fs/promises';
import {trustedPath} from './protected-bootstrap.mjs';
export function canonical(value){
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  throw Error('BROWSER_ATTESTATION_REFUSED');
}
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function verifyAttestation(envelope,{publicKey,runtimeLockSha256,now=Date.now()}={}){
  try{
    if(!exact(envelope,['payload','signature']))throw Error();
    const decode=(x,max)=>{if(typeof x!=='string'||x.length>max||!x.length)throw Error();const b=Buffer.from(x,'base64');if(b.toString('base64')!==x)throw Error();return b;};
    const bytes=decode(envelope.payload,65536),signature=decode(envelope.signature,128);
    const key=publicKey?.type==='public'?publicKey:createPublicKey(publicKey);
    if(key.asymmetricKeyType!=='ed25519'||signature.length!==64||!verify(null,bytes,key,signature))throw Error();
    const d=JSON.parse(bytes.toString('utf8'));
    if(canonical(d)!==bytes.toString('utf8')||!exact(d,['format','purpose','issuedAt','expiresAt','runtimeLockSha256','attestation'])||d.format!==1||d.purpose!=='browser-0b-runtime')throw Error();
    if(!Number.isSafeInteger(now)||!Number.isSafeInteger(d.issuedAt)||!Number.isSafeInteger(d.expiresAt)||d.issuedAt>now||d.expiresAt<=now||d.expiresAt<=d.issuedAt||d.expiresAt-d.issuedAt>86400000)throw Error();
    if(!/^[a-f0-9]{64}$/.test(runtimeLockSha256??'')||d.runtimeLockSha256!==runtimeLockSha256||!d.attestation||Object.getPrototypeOf(d.attestation)!==Object.prototype)throw Error();
    return Object.freeze(d.attestation);
  }catch{throw Error('BROWSER_ATTESTATION_REFUSED');}
}
async function protectedRead(file,max){
  await trustedPath(file);
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=await fd.stat();if(!st.isFile()||st.size>max)throw Error('BROWSER_ATTESTATION_REFUSED');return await fd.readFile('utf8');}finally{await fd.close();}
}
export async function loadAttestation(runtimeLockSha256){
  const envelope=JSON.parse(await protectedRead('/etc/sjcos-browser/attestation.json',65536));
  const publicKey=await protectedRead('/etc/sjcos-browser/reviewer-ed25519.pub',4096);
  return verifyAttestation(envelope,{publicKey,runtimeLockSha256});
}
