/** Website-only protected assembly. Never accepts route JSON as a classifier,
 * catalog, module path, SQL adapter or runner authority. No import-time I/O. */
import {readFile,open,constants} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {NavigationProjection} from './phase1-contracts.mjs';
import {privateRecordFacts} from './record-projections.mjs';
import {trustedPath} from './protected-bootstrap.mjs';
import {createWebsiteStart,createWebsiteProjection,confirmedFactsFromCatalog,createWebsiteDiscovery} from './production-bridge.mjs';
const fail=()=>{throw Error('BROWSER_SERVICE_UNAVAILABLE');};
export function createWebsiteBridge(config){
 const {catalog,privateFacts}=config??{};
 if(!Number.isSafeInteger(catalog?.version)||catalog.version<1||!Array.isArray(catalog.tasks)||!catalog.tasks.length)fail();
 const facts=confirmedFactsFromCatalog({values:catalog.privateValues,publicUrls:catalog.publicUrls});
 // Snapshot protected config so a caller cannot change classification mid-call.
 const confirmed=async task=>confirmedFactsFromCatalog({values:[...facts.values,...await privateRecordFacts(config,task),...(privateFacts?await privateFacts(task):[])],publicUrls:catalog.publicUrls});
 const stage=createWebsiteDiscovery({...config,confirmedFacts:confirmed});
 const tasks=structuredClone(catalog.tasks),version=catalog.version,publicUrls=[...catalog.publicUrls];
 for(const t of tasks)if(!['public_research','permit','invoice','purchase'].includes(t.task_kind)||!t.conversation_id||!t.user_id)fail();
 /** @param {{task:any,proposal?:any,origin?:string|null}} input */
 async function discover({task,proposal,origin}){
  if(!proposal){const urls=publicUrls.filter(url=>!origin||new URL(url).origin===origin);if(!urls.length)fail();proposal={v:1,entries:urls.slice(0,20).map(url=>({url,role:'document',source:'person'}))};}
  return stage({task,proposal});
 }
 return Object.freeze({
  discover,
  classifyTask:async input=>{const matches=tasks.filter(t=>['conversation_id','project_id','lead_slug','user_id'].every(k=>(t[k]??null)===(input[k]??null)));if(matches.length!==1)fail();return {task_kind:matches[0].task_kind,catalog_version:version};},
  confirmedFacts:async task=>confirmedFactsFromCatalog({values:[...facts.values,...await privateRecordFacts(config,task),...(privateFacts?await privateFacts(task):[])],publicUrls}),
  authorizePrivateWatch:async input=>{if(typeof config.audit?.anchorPrivateView!=='function')fail();return config.audit.anchorPrivateView(input);},
  navigation:async input=>{if(typeof config.navigationProjection!=='function')return null;return config.navigationProjection(input);},
  start:createWebsiteStart(config),projection:createWebsiteProjection(config),
 });
}
/** Fixed paths and SHA pin, no environment/module fallback. The website bridge
 * has owner SQL; controller's production bridge must never receive this DSN. */
export async function loadWebsiteBridge({db,key,controller,readConfig}={}){
 const path='/etc/sjcos-browser/phase1-website.json';
 let config;
 if(readConfig)config=await readConfig(); // trusted test/installation IO only
 else{
  await trustedPath(path);const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await fd.stat();if(!s.isFile()||s.size>32768||(s.mode&0o022))fail();config=JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}
 }
 if(config?.v!==1||config.module!=='/etc/sjcos-browser/phase1-website-bridge.mjs'||!/^[a-f0-9]{64}$/.test(config.sha256??''))fail();
 await trustedPath(config.module);
 if(createHash('sha256').update(await readFile(config.module)).digest('hex')!==config.sha256)fail();
 const installed=await import(pathToFileURL(config.module).href);
 if(typeof installed.websiteDependencies!=='function')fail();
 return createWebsiteBridge({...await installed.websiteDependencies({db,key}),controller});
}
export function navigationControls(task,runtime){
 if(task.private||task.privacy_mode==='private'||!['active','paused'].includes(task.state)||runtime?.guarded!==true)return [];
 return ['back','forward','reload'].filter(k=>runtime[k]===true).concat(runtime.targets?.length>1?['switch_tab']:[]);
}

export function navigationProjection(task,runtime,loading=false){
 const controls=navigationControls(task,runtime);
 if(!controls.length&&!loading)return null;
 const target_ids=Array.isArray(runtime?.targets)&&runtime.targets.length<=2&&runtime.targets.every(t=>typeof t==='string'&&t.length>0&&Buffer.byteLength(t)<=160)?[...runtime.targets]:[];
 return NavigationProjection.parse({context_generation:Number(task.context_generation),document_epoch:Number(task.document_epoch),read_manifest_revision:Number(task.read_manifest_revision),target_ids,loading:task.private||task.privacy_mode!=='public'?false:loading});
}
