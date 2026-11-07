#!/usr/bin/env node
/** Source-only refresh. No installed runtime mutation or acceptance promotion.
 * Run after ALL parallel builders settle. --check verifies without rewriting. */
import {readFile,writeFile,readdir} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));const check=process.argv.slice(2).includes('--check');const h=b=>createHash('sha256').update(b).digest('hex');
const read=n=>readFile(path.join(root,n));
async function put(n,b){const old=await read(n).catch(()=>null);if(old?.equals(Buffer.from(b)))return;if(check)throw Error('BROWSER_SOURCES_STALE:'+n);await writeFile(path.join(root,n),b);}
const unitNames=(await readdir(path.join(root,'deploy'))).filter(n=>/^sjcos-browser.*\.service$|^user-.*-sjcosbrowser.*\.slice$/.test(n)).sort();const units={};for(const n of unitNames)units[n]=(await read('deploy/'+n)).toString();await put('deploy/browser/phase1-unit-files.json',JSON.stringify(units,null,2)+'\n');
const launcherPath='deploy/browser/playwright-patch/launcher-files.json';const launcher=JSON.parse(await read(launcherPath));
async function walk(dir){const out=[];for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){if(e.name==='__pycache__'||e.name.endsWith('.pyc'))continue;const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await walk(p));else if(e.isFile())out.push(p);}return out;}
const added=[...(await walk('lib/browser')).filter(n=>n.endsWith('.mjs')), 'scripts/browser-retention.mjs', ...(await walk('deploy/browser')).filter(n=>!n.includes('/playwright-patch/')&&n!=='deploy/browser/runtime-lock.json')];
for(const n of added)launcher[n]=h(await read(n));for(const n of Object.keys(launcher))launcher[n]=h(await read(n));
const sorted=o=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));
await put(launcherPath,JSON.stringify(sorted(launcher),null,2)+'\n');
const lockPath='deploy/browser/runtime-lock.json',lock=JSON.parse(await read(lockPath));for(const n of [...added,launcherPath])lock.files[n]=h(await read(n));for(const n of Object.keys(lock.files))lock.files[n]=h(await read(n));lock.files=sorted(lock.files);
if(lock.acceptance.releaseReady!==false||lock.acceptance.parserTransportIntegrated!==false)throw Error('BROWSER_NO_PROMOTION');
await put(lockPath,JSON.stringify(lock,null,2)+'\n');process.stdout.write(check?'Browser source inventory verified.\n':'Browser source inventory refreshed; root evidence must be rerun.\n');
