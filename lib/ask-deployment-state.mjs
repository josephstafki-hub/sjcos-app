// This identity is provisioned explicitly, outside DB backups AND the journal
// volume. Missing state is never silently bootstrapped by an Ask request.
import path from 'node:path';
import {homedir} from 'node:os';
import {mkdir,open,lstat,readFile,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export const deploymentDirectory=()=>process.env.SJC_ASK_DEPLOYMENT_STATE_DIR??path.join(homedir(),'.local','state','sjcos-ask-deployment');
async function read(dir,name){
 const file=path.join(dir,name),s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.size>1024)throw Error('JOURNAL_DEPLOYMENT_STATE');
 return JSON.parse(await readFile(file,'utf8'));
}
async function create(dir,name,value){
 const f=await open(path.join(dir,name),'wx',0o600);
 try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}
 const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}
}
export async function bootstrapDeployment(dir=deploymentDirectory()){
 if(!path.isAbsolute(dir))throw Error('JOURNAL_DEPLOYMENT_STATE');
 await mkdir(dir,{recursive:true,mode:0o700});
 await create(dir,'identity.json',{version:1,id:randomUUID()});
 return readDeployment(dir);
}
export async function readDeployment(dir=deploymentDirectory()){
 const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077))throw Error('JOURNAL_DEPLOYMENT_STATE');
 const identity=await read(dir,'identity.json');
 if(identity.version!==1||!/^[-a-f0-9]{36}$/i.test(identity.id))throw Error('JOURNAL_DEPLOYMENT_STATE');
 let enabled;try{enabled=await read(dir,'deletion-enabled.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(enabled&&(enabled.deployment!==identity.id||!/^[-a-f0-9]{36}$/i.test(enabled.ledger)))throw Error('JOURNAL_DEPLOYMENT_STATE');
 return {dir,...identity,ledger:enabled?.ledger??null};
}
export async function enableDeployment(dir,ledger){
 const state=await readDeployment(dir);
 if(state.ledger&&state.ledger!==ledger)throw Error('JOURNAL_AUTHORITY_IDENTITY');
 if(!state.ledger){try{await create(dir,'deletion-enabled.json',{deployment:state.id,ledger});}catch(e){if(e.code!=='EEXIST')throw e;}
  if((await readDeployment(dir)).ledger!==ledger)throw Error('JOURNAL_AUTHORITY_IDENTITY');}
}

export async function requireSeparateDeployment(journalDir,dir=deploymentDirectory()){
 const protectedPath=await realpath(dir),journalPath=await realpath(journalDir);
 if(protectedPath===journalPath||protectedPath.startsWith(journalPath+path.sep)||journalPath.startsWith(protectedPath+path.sep))throw Error('JOURNAL_DEPLOYMENT_VOLUME');
}
