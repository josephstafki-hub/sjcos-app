#!/usr/bin/env node
/** Copy source only. Never builds, starts a server, installs, or connects to DB. */
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdir,lstat,realpath,readFile,writeFile,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
const QA_ROOT='/home/joe/qa-sjcos';
const LIVE='/home/joe/sjcos-app';
const MARKER='QA-BROWSER-OVERLAY.json';
const inside=(p,root)=>p===root||p.startsWith(root+path.sep);
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function noSymlinkAncestors(target){
 let current=path.parse(target).root;
 for(const part of target.split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  try{const st=await lstat(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('QA_ONLY: overlay ancestry must be real directories');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
export function overlayCommands(outDir,envDir=process.env.SJC_QA_BROWSER_FAKE??QA_ROOT+'/browser-p1'){
 const common=`-p MemoryMax=8G -p Restart=no -p WorkingDirectory=${quote(outDir)} -p EnvironmentFile=${quote(envDir+'/side.env')}`;
 // Next's distDir must be relative and remain inside its source root.
 const executable='/usr/bin/env SJC_DIST_DIR=.next-qa-browser NODE_OPTIONS=--max-old-space-size=6144';
 return [
  'pgrep -af next',
  `systemd-run --user --unit=sjcos-qa-browser-build --collect --wait --pipe ${common} /usr/bin/nice -n 19 ${executable} ./node_modules/.bin/next build`,
  `systemd-run --user --unit=sjcos-qa-browser-side --collect ${common} ${executable} ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3191`,
 ];
}
export async function createOverlay(output){
 if(!output||!path.isAbsolute(output)||path.normalize(output)!==output||!inside(output,QA_ROOT)||output===QA_ROOT||inside(output,path.resolve(sourceRoot))||inside(output,LIVE))throw Error('QA_ONLY: outDir must be a new directory under /home/joe/qa-sjcos, outside both checkouts');
 await noSymlinkAncestors(output);
 const root=await realpath(sourceRoot);
 if(inside(output,root))throw Error('QA_ONLY: overlay cannot be inside source checkout');
 await mkdir(path.dirname(output),{recursive:true,mode:0o700});
 // Refuse reuse, including a previous partial copy. Never clobber a source tree.
 await mkdir(output,{mode:0o700});
 const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,maxBuffer:16*1024*1024}).toString().split('\0').filter(Boolean);
 const excluded=name=>name.split('/').some(p=>p==='node_modules'||p==='.git'||p.startsWith('.next')||p==='.env'||p.startsWith('.env.')||p.endsWith('.tsbuildinfo'))||name===MARKER;
 for(const name of new Set(names.filter(n=>!excluded(n)))){
  if(path.isAbsolute(name)||name.split('/').includes('..'))throw Error('QA_ONLY: invalid source path');
  const from=path.join(root,name),to=path.join(output,name);
  const st=await lstat(from);if(!st.isFile())throw Error('QA_ONLY: only regular source files may be copied: '+name);
  await mkdir(path.dirname(to),{recursive:true,mode:0o700});await copyFile(from,to);
 }
 const replacement='lib/browser/runtime-endpoints.ts';
 await copyFile(path.join(root,'qa/browser/runtime-endpoints.ts'),path.join(output,replacement));
 await symlink(await realpath(path.join(root,'node_modules')),path.join(output,'node_modules'),'dir');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const marker={qa_only:true,production_trust:false,source_root:root,source_head:execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),created_at:new Date().toISOString(),replacement,production_leaf_sha256:hash(await readFile(path.join(root,replacement))),qa_leaf_sha256:hash(await readFile(path.join(output,replacement))),dist_dir:path.join(output,'.next-qa-browser')};
 await writeFile(path.join(output,MARKER),JSON.stringify(marker,null,2)+'\n',{flag:'wx',mode:0o600});
 return {outDir:output,marker,commands:overlayCommands(output)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 createOverlay(process.argv.length===3?process.argv[2]:null).then(result=>{console.log('QA ONLY source artifact: '+result.outDir+'\nBuild/start commands (coordinator only; not executed):\n'+result.commands.join('\n'));}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
