/** Deterministic exact-match patch. Never modify the input or live node_modules. */
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
export const UPSTREAM_SHA256='829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d';
const hash=x=>createHash('sha256').update(x).digest('hex');
const here=path.dirname(fileURLToPath(import.meta.url));
export function census(bundle){return bundle.split('\n').flatMap((text,i)=>/Runtime\.runIfWaitingForDebugger|Target\.setAutoAttach|Fetch\.enable|Fetch\.disable/.test(text)?[{line:i+1,text:text.trim(),sha256:hash(text.trim())}]:[]);}
export function lifecycleCensus(bundle){return bundle.split('\n').flatMap((text,i)=>/Target\.(?:createBrowserContext|disposeBrowserContext|closeTarget|detachedFromTarget)/.test(text)?[{line:i+1,text:text.trim(),sha256:hash(text.trim())}]:[]);}
export async function patchBundle(source){
  if(hash(source)!==UPSTREAM_SHA256)throw Error('SJC_UPSTREAM_HASH_MISMATCH');
  const [patch,helper,inventory]=await Promise.all([readFile(path.join(here,'target-barrier.patch.json'),'utf8'),readFile(path.join(here,'runtime.js'),'utf8'),readFile(path.join(here,'../playwright-resume-census.json'),'utf8')]);
  if(JSON.stringify(census(source))!==JSON.stringify(JSON.parse(inventory).occurrences))throw Error('SJC_CENSUS_MISMATCH');
  if(JSON.stringify(lifecycleCensus(source))!==JSON.stringify(JSON.parse(inventory).lifecycleOccurrences))throw Error('SJC_LIFECYCLE_CENSUS_MISMATCH');
  let bundle=source;
  for(const {before,after,matches}of JSON.parse(patch)){if(bundle.split(before).length-1!==matches)throw Error('SJC_PATCH_SITE_MISMATCH');bundle=bundle.replace(before,()=>after);}
  bundle=helper+'\nconst __sjc = createSjcRuntime();\n'+bundle;
  new vm.Script(bundle); // syntax verification without evaluating the pinned bundle
  const after=census(bundle);
  if(after.some(x=>x.text.includes('Runtime.runIfWaitingForDebugger'))||after.filter(x=>x.text.includes('Target.setAutoAttach')).length!==4||after.some(x=>/Fetch\.(enable|disable)/.test(x.text)))throw Error('SJC_PATCH_CENSUS_MISMATCH');
  const metadata={version:'1.64.1',upstreamBundleSha256:UPSTREAM_SHA256,playwrightPatchSha256:hash(patch+'\0'+helper),patchedBundleSha256:hash(bundle),patchedCensus:after,patchedLifecycleCensus:lifecycleCensus(bundle)};
  return {bundle,metadata,runtimeFactory:vm.runInNewContext(helper+'\ncreateSjcRuntime',{setTimeout,clearTimeout})};
}
export async function apply(sourceFile,targetDir){
  const sourcePath=await realpath(sourceFile),target=path.resolve(targetDir);
  if(target===path.dirname(sourcePath)||target.includes('/node_modules/')&&target.startsWith('/home/joe/sjcos-app/'))throw Error('SJC_TARGET_REFUSED');
  const result=await patchBundle(await readFile(sourcePath,'utf8'));
  const expected=JSON.parse(await readFile(path.join(here,'result.json'),'utf8'));
  if(result.metadata.playwrightPatchSha256!==expected.playwrightPatchSha256||result.metadata.patchedBundleSha256!==expected.patchedBundleSha256)throw Error('SJC_RECORDED_RESULT_MISMATCH');
  await mkdir(target,{recursive:true,mode:0o700});
  await writeFile(path.join(target,'coreBundle.js'),result.bundle,{flag:'wx',mode:0o600});
  await writeFile(path.join(target,'sjc-patch.json'),JSON.stringify(result.metadata,null,2)+'\n',{flag:'wx',mode:0o600});
  return result.metadata;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw Error('usage: node apply.mjs PRISTINE_CORE_BUNDLE NEW_TARGET_DIR');
  console.log(JSON.stringify(await apply(process.argv[2],process.argv[3])));
}
