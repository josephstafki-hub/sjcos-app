import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/web-sessions.ts',import.meta.url),'utf8'),exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({}),Buffer,URL,process,TextEncoder});
const id='11111111-1111-4111-8111-111111111111',path=`/today?browser=${id}&review=${id}`;
test('canonical Watch and review returns survive unchanged',()=>{for(const p of [path,`/today?browser=${id}`]){assert.equal(exports.validateBrowserReturnPath(p),p);assert.equal(exports.validateAppReturnPath(p),p);}});
test('all external, encoded, nested, fragment, extra/duplicate and oversized returns refuse',()=>{for(const p of ['https://evil.test'+path,'//evil.test'+path,'/\\evil.test',path+'#x',path+'&browser='+id,path+'&returnTo=/today',path+'&x=1',path.replace('/today','/%74oday'),path.replace('browser','%2562rowser'),'/projects/%252e%252e/today?browser='+id,'/today?browser='+id+'&review='+id+'&x='+'a'.repeat(300)])assert.equal(exports.validateBrowserReturnPath(p),null,p);});
test('four auth surfaces use narrow validator and reject ambiguous returnTo multiplicity',()=>{for(const f of ['proxy.ts','app/login/page.tsx','components/auth/LoginForm.tsx','lib/actions/auth.ts']){const s=readFileSync(new URL('../'+f,import.meta.url),'utf8');assert.match(s,f.includes('LoginForm')?/name="returnTo"/:/validate(?:App|Browser)ReturnPath/,f);}assert.equal(exports.validateBrowserReturnPath([path,path]),null);});
function load(file,deps={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:id=>deps[id]??{},Buffer,URL,Headers,TextEncoder,process:{env:{NEXT_PUBLIC_APP_URL:'https://canonical.test'}}});return exports;}
test('legacy cookie reauth preserves Browser path and ignores spoofed Host in redirect',async()=>{
 const session={userId:id,role:'owner',iat:Math.floor(Date.now()/1000)};
 const proxy=load('proxy.ts',{'next/server':{NextResponse:{next:()=>({next:true}),redirect:url=>({url:url.href,cookies:{set(){}}})}},jose:{jwtVerify:async()=>({payload:session})},'@/lib/web-sessions':exports,'@/lib/session-window':{SESSION_COOKIE:'session',SESSION_RENEW_AFTER_S:86400},'@/lib/permissions':{isOwnerOnlyPath:()=>false,staffHome:()=>'/today'}}).default;
 const url=new URL(path,'https://spoof.test');url.clone=()=>new URL(url);const r=await proxy({url:url.href,nextUrl:url,method:'GET',headers:new Headers({Host:'evil.test'}),cookies:{get:()=>({value:'legacy'})}});const redirect=new URL(r.url);assert.equal(redirect.origin,'https://canonical.test');assert.equal(redirect.pathname,'/login');assert.equal(redirect.searchParams.get('returnTo'),path);
});
test('login action keeps exact Browser return and rejects repeated hidden keys',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const action=load('lib/actions/auth.ts',{'@/lib/web-sessions':exports,'next/navigation':{redirect:path=>{throw Object.assign(Error('redirect'),{path});}},zod:require('zod'),'@/lib/db':{queryOne:async()=>({id,role:'owner',active:true,password_hash:'hash'})},'@/lib/password':{verifyPassword:async()=>true},'@/lib/session':{createSession:async()=>{}},'@/lib/dal':{homeForRole:()=>'/today'},'@/lib/permissions':{normalizePermissions:()=>[]}}).login;
 for(const duplicate of [false,true]){const f=new FormData();f.set('email','person@example.test');f.set('password','secret');f.append('returnTo',path);if(duplicate)f.append('returnTo',path);await assert.rejects(action({},f),e=>e.path===(duplicate?'/today':path));}
});
