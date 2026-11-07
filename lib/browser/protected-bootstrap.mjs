/** Fixed root-owned acceptance bootstrap. Contains no DSN/capability/secret.
 * The adapter path/hash is provisioned by the coordinator, never model argv. */
import {readFile,lstat,open,constants} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256} from './runtime-readiness.mjs';
export async function trustedPath(file){
  if(!path.isAbsolute(file))throw Error('BROWSER_BOOTSTRAP_REFUSED');
  for(let p=file;;p=path.dirname(p)){const s=await lstat(p);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('BROWSER_BOOTSTRAP_REFUSED');if(p==='/')break;}
}
export async function loadBootstrap(){
  const file='/etc/sjcos-browser/acceptance.json';await trustedPath(file);
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let config;
  try{const s=await fd.stat();if(!s.isFile()||s.size>65536)throw Error();config=JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}
  if(config.adapter!=='/opt/sjcos-browser/controller-adapter.mjs'||! /^[a-f0-9]{64}$/.test(config.adapterSha256??''))throw Error('BROWSER_BOOTSTRAP_REFUSED');
  await trustedPath(config.adapter);
  if(sha256(await readFile(config.adapter))!==config.adapterSha256)throw Error('BROWSER_BOOTSTRAP_REFUSED');
  const adapter=await import(pathToFileURL(config.adapter).href);
  return {config,adapter};
}

/** Separate production bootstrap. Acceptance configuration is never authority
 * to start a Phase 1 service. Fixed adapter path + root hash; no caller module. */
export const PRODUCTION_BOOTSTRAP='/etc/sjcos-browser/phase1.json';
// Shared, nonsecret root-owned metadata readable by controller/runner/retention.
// Secret paths/values are not part of this schema. Purpose-specific credentials
// stay under LoadCredential or the authenticated root broker rendezvous.
export function validateProductionBootstrapConfig(config){
 if(!config||Object.getPrototypeOf(config)!==Object.prototype||Object.keys(config).sort().join(',')!=='adapter,adapterSha256,bridgeSha256,phase,v'||config.v!==1||config.phase!==1||config.adapter!=='/opt/sjcos-browser/node/source/deploy/browser/production-adapter.mjs'||!['adapterSha256','bridgeSha256'].every(k=>/^[a-f0-9]{64}$/.test(config[k]??'')))throw Error('BROWSER_BOOTSTRAP_REFUSED');
 return config;
}
export async function loadProductionBootstrap(){
 const file=PRODUCTION_BOOTSTRAP;await trustedPath(file);
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let config;
 try{const s=await fd.stat();if(!s.isFile()||s.uid!==0||s.size>32768||(s.mode&0o777)!==0o644)throw Error('BROWSER_BOOTSTRAP_REFUSED');config=validateProductionBootstrapConfig(JSON.parse(await fd.readFile('utf8')));}finally{await fd.close();}
 await trustedPath(config.adapter);if(sha256(await readFile(config.adapter))!==config.adapterSha256)throw Error('BROWSER_BOOTSTRAP_REFUSED');
 return {config,adapter:await import(pathToFileURL(config.adapter).href)};
}
