/** No activation based on package metadata. Every unimplemented or unmeasured
 * boundary is a named blocker, not an invented attestation. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyRuntimeFiles(root,lock) {
  const failures=[];
  for(const [file,hash]of Object.entries(lock.files??{})){
    if((!/^(lib\/browser|deploy\/browser)\/[A-Za-z0-9_./-]+$/.test(file)&&file!=='mcp/browser-tools.mjs')||file.includes('..')){failures.push(file);continue;}
    try{if(sha256(await readFile(`${root}/${file}`))!==hash)failures.push(file);}catch{failures.push(file);}
  }
  return {ok:failures.length===0&&Object.keys(lock.files??{}).length>0,failures,releaseReady:false};
}
export function runtimeReadiness(attestation,verifySignature) {
  const required=['parserPatchSha256','patchedBundleSha256','playwrightPatchSha256','pythonTransitiveLockSha256','namespaceEvidenceSha256','rssEvidenceSha256','cliResolvedPolicyEvidenceSha256','rendezvousEvidenceSha256','sandboxEvidenceSha256','reviewApprovalSha256'];
  const blockers=required.filter(k=>!/^[a-f0-9]{64}$/.test(attestation?.[k]??''));
  if(attestation?.parserTransportIntegrated!==true)blockers.push('parser-transport-integration');
  if(!attestation||typeof verifySignature!=='function'||verifySignature(attestation)!==true)blockers.push('signed-root-attestation');
  return {ok:blockers.length===0,blockers};
}

/** Inspect installed runtime, never resolve through the app's node_modules. */
export async function inspectInstalledRuntime(root,lock) {
  const {lstat,realpath,readdir}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const failures=[],versions={},hashes={};
  async function trusted(file) {
    try {
      for(let p=file;;p=p.slice(0,p.lastIndexOf('/'))||'/') {
        const s=await lstat(p);
        if(s.uid!==0||(s.mode&0o022)||s.isSymbolicLink())throw Error();
        if(p==='/')break;
      }
      return true;
    }catch{failures.push('ownership:'+file);return false;}
  }
  async function digest(file,expected) {
    try{await trusted(file);const h=sha256(await readFile(file));hashes[file]=h;if(!/^[a-f0-9]{64}$/.test(expected??'')||h!==expected)throw Error();}
    catch{failures.push('hash:'+file);}
  }
  async function json(file){try{await trusted(file);return JSON.parse(await readFile(file,'utf8'));}catch{failures.push('metadata:'+file);return {};}}
  const node=root+'/node/node_modules',core=await json(node+'/playwright-core/package.json'),sdk=await json(node+'/@modelcontextprotocol/sdk/package.json'),browsers=await json(node+'/playwright-core/browsers.json');
  versions.playwrightCore=core.version;versions.mcpSdk=sdk.version;
  const chromium=browsers.browsers?.find(x=>x.name==='chromium');versions.chromium=chromium;
  if(core.version!=='1.64.1'||sdk.version!=='1.29.0'||chromium?.revision!=='1248'||chromium?.browserVersion!=='156.0.8078.4')failures.push('node-runtime-pins');
  await digest(root+'/mitmproxy-requirements.lock',lock.acceptance?.pythonTransitiveLockSha256);
  await digest(root+'/parser_adapter.py',lock.acceptance?.parserPatchSha256);
  await digest(node+'/playwright-core/lib/coreBundle.js',lock.acceptance?.patchedBundleSha256);
  // A deployment manifest binds executable binaries and Python distributions to
  // exact installed hashes; ownership is checked recursively as well as per file.
  let manifest={};try{await trusted(root+'/installed-hashes.json');manifest=JSON.parse(await readFile(root+'/installed-hashes.json','utf8'));}catch{failures.push('installed-hashes-manifest');}
  const required=['unbound/sbin/unbound','browsers/chromium-1248/chrome-linux64/chrome','fixtures/network-driver','fixtures/rss-driver'];
  for(const file of required)if(!manifest.files?.[file])failures.push('installed-hash-missing:'+file);
  for(const [file,hash] of Object.entries(manifest.files??{})) {
    if(!/^[A-Za-z0-9_./@+-]+$/.test(file)||file.includes('..')||file.startsWith('/')){failures.push('installed-path');continue;}
    await digest(root+'/'+file,hash);
  }
  // Root-owned venv python is commonly a symlink to the system interpreter;
  // verify the resolved target and each parent, never execute a writable target.
  try {
    const python=await realpath(root+'/py/bin/python');
    const beforePython=failures.length;await tree(root+'/py');
    if(failures.length===beforePython&&await trusted(python)&&await trusted(root+'/py/pyvenv.cfg')) {
      const r=spawnSync(root+'/py/bin/python',['-I','-c','import importlib.metadata, json, sys; print(json.dumps({"python":list(sys.version_info[:3]),"mitmproxy":importlib.metadata.version("mitmproxy")}))'],{encoding:'utf8',timeout:10000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1'}});
      const v=JSON.parse(r.stdout);Object.assign(versions,v);
      if(r.status!==0||v.python?.[0]!==3||v.python?.[1]<12||v.mitmproxy!=='12.3.1')throw Error();
      // Verify the complete locked distribution graph and each wheel RECORD
      // digest in place. RECORD is not an acceptance signature; root ownership
      // and independent installed-artifact manifest remain separate blockers.
      const program=`import importlib.metadata as m, pathlib, re, hashlib, base64, json
lock=pathlib.Path(${JSON.stringify(root+'/mitmproxy-requirements.lock')}).read_text()
expected={re.sub(r"[-_.]+","-",n).lower():v for n,v in re.findall(r"^([A-Za-z0-9_.-]+)==([^ ]+) --hash=sha256:[a-f0-9]{64}$",lock,re.M)}
failed=[]
for name,version in expected.items():
 try:
  d=m.distribution(name)
  if d.version!=version: raise ValueError()
  for f in d.files or []:
   if f.hash:
    if f.hash.mode!="sha256": raise ValueError()
    digest=base64.urlsafe_b64encode(hashlib.sha256(d.locate_file(f).read_bytes()).digest()).rstrip(b"=").decode()
    if digest!=f.hash.value: raise ValueError()
 except Exception: failed.append(name)
print(json.dumps({"locked":len(expected),"failed":failed}))
`;
      const checked=spawnSync(root+'/py/bin/python',['-I','-c',program],{encoding:'utf8',timeout:20000,maxBuffer:8192,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1'}});
      const graph=JSON.parse(checked.stdout);versions.pythonGraph=graph;
      if(checked.status!==0||graph.locked<1||graph.failed.length)failures.push('python-installed-records');
    }
  }catch{failures.push('python-runtime-pins');}
  if(await trusted(root+'/unbound/sbin/unbound')) {
    const r=spawnSync(root+'/unbound/sbin/unbound',['-V'],{encoding:'utf8',timeout:10000,maxBuffer:8192,env:{PATH:'/usr/bin:/bin'}});
    versions.unbound=(r.stdout+r.stderr).match(/Version (\d+\.\d+\.\d+)/)?.[1];
    if(r.status!==0||versions.unbound!=='1.26.2')failures.push('unbound-runtime-pin');
  }
  async function tree(dir) {
    try{for(const entry of await readdir(dir,{withFileTypes:true})) {
      const file=dir+'/'+entry.name,s=await lstat(file);
      if(s.uid!==0||(!s.isSymbolicLink()&&(s.mode&0o022)))failures.push('ownership:'+file);
      if(s.isSymbolicLink()){const target=await realpath(file);if(!target.startsWith(root+'/'))await trusted(target);}
      else if(entry.isDirectory())await tree(file);
    }}catch{failures.push('unreadable:'+dir);}
  }
  await tree(root);
  return {ok:failures.length===0,root,versions,hashes,failures:[...new Set(failures)],releaseReady:false};
}
