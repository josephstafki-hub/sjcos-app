#!/usr/bin/env node
/** Coordinator-only bundle preparation, never imported by browser/controller.
 * No system trust changes or credential discovery. Dry-run is the default.
 * Explicit owner-provided narrow LOGIN file and reviewed config/bridge files
 * remain required. Output must subsequently be reviewed and independently signed.
 */
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdir,writeFile,lstat,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
export const credentialPlan=()=>({dryRun:true,generate:['gate-ca-key','ca-public.pem','read-dispatch','read-dispatch-public','audit','web-rpc','web-response','frame','request-hmac','manifest-hmac'],provided:['browser-database (sjcos_browser LOGIN only)','reviewed production/supervisor bridges and configs'],trust:'public CA in ephemeral service NSS only',systemTrust:false});
export async function prepareCredentials({out,apply=false,databaseFile}={}){
 if(!apply)return credentialPlan();
 if(process.getuid()!==0||!path.isAbsolute(out??'')||!databaseFile)throw Error('BROWSER_CREDENTIAL_REFUSED');
 for(let p=path.dirname(out);;p=path.dirname(p)){const st=await lstat(p);if(st.isSymbolicLink()||st.uid!==0||st.mode&0o022)throw Error('BROWSER_CREDENTIAL_REFUSED');if(p==='/')break;}
 const db=await lstat(databaseFile);if(db.isSymbolicLink()||db.uid!==0||db.mode&0o077||db.size>4096)throw Error('BROWSER_CREDENTIAL_REFUSED');
 // New directory only; no overwrites, output absent on partial failure.
 await mkdir(out,{mode:0o700});
 try{
  const creds=path.join(out,'credentials');await mkdir(creds,{mode:0o700});
  const put=(name,value)=>writeFile(path.join(creds,name),value,{mode:0o600,flag:'wx'});
  for(const name of ['web-rpc','web-response','frame','request-hmac','manifest-hmac'])await put(name,randomBytes(32));
  for(const name of ['read-dispatch','audit']){const k=generateKeyPairSync('ed25519');await put(name,k.privateKey.export({type:'pkcs8',format:'pem'}));if(name==='read-dispatch')await put('read-dispatch-public',k.publicKey.export({type:'spki',format:'pem'}));}
  await put('browser-database',await readFile(databaseFile));
  const r=spawnSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-sha256','-nodes','-days','30','-subj','/CN=SJC isolated browser CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',path.join(creds,'gate-ca-key'),'-out',path.join(out,'ca-public.pem')],{env:{PATH:'/usr/bin:/bin'},stdio:'ignore',timeout:15000});
  if(r.status!==0)throw Error('BROWSER_CREDENTIAL_REFUSED');
  return {prepared:true,requiresIndependentReview:true};
 }catch(e){await rm(out,{recursive:true,force:true});throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2);if(!a.length)process.stdout.write(JSON.stringify(credentialPlan(),null,2)+'\n');
 else if(a.length===5&&a[0]==='--apply'&&a[1]==='--out'&&a[3]==='--database-file')prepareCredentials({apply:true,out:a[2],databaseFile:a[4]}).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(()=>{process.stderr.write('BROWSER_CREDENTIAL_REFUSED\n');process.exitCode=1;});
 else {process.stderr.write('BROWSER_CREDENTIAL_REFUSED\n');process.exitCode=1;}
}
