// Run after UI assets have been copied to public/consult/assets. Never caches Next RSC.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../public/consult/',import.meta.url);
const assets=[{url:'/consult/offline.html',sha256:createHash('sha256').update(await readFile(new URL('offline.html',root))).digest('hex')}];
async function walk(dir,prefix){for(const entry of await readdir(dir,{withFileTypes:true})){const path=prefix+entry.name;if(entry.isDirectory())await walk(new URL(entry.name+'/',dir),path+'/');else assets.push({url:'/consult/'+path,sha256:createHash('sha256').update(await readFile(new URL(entry.name,dir))).digest('hex')});}}
await walk(new URL('assets/',root),'assets/');
if(!assets.some(a=>a.url==='/consult/assets/capture.js'))throw new Error('Build the consult UI as public/consult/assets/capture.js before preparing offline pages');
assets.sort((a,b)=>a.url.localeCompare(b.url));const build=createHash('sha256').update(JSON.stringify(assets)).digest('hex');
await writeFile(new URL('precache.json',root),JSON.stringify({build,assets},null,2)+'\n');
