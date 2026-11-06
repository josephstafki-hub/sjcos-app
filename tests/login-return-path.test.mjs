import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(file, deps = {}) {
 const exports = {};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: s => Object.hasOwn(deps,s) ? deps[s] : {}, process, Buffer, URL, Headers, TextEncoder });
 return exports;
}
const exports = load('lib/web-sessions.ts');
const validate = exports.validateAppReturnPath;
const bad = [null, undefined, 3, {}, '', '//evil.com', '/\\evil.com', '%2f%2fevil.com', '/%2f%2fevil.com', '/%5cevil.com', '/%255cevil.com', 'javascript:alert(1)', 'https://evil.com', 'http://evil.com', '/today\r\nLocation:evil', '/today%0d%0aevil', '/today\t', '/today x', '/today?x=a b', '/today?x=%0a', '/today?x=%2520', '/' + 'a'.repeat(513), '/／evil', '/∕evil', '/⁄evil', '/login', '/login?returnTo=/today', '/logout', '/api/users', '/not-an-app-route', '/projects/../login', '/projects/%2e%2e/login', '/projects/%252e%252e/login', '/projects//evil', '/today%zz', '/today?x=\\evil', '/today?x=%5c', '/projects/a/unknown', '/projects/a%2fb', '/today\u0085', '/today\u200b', '/projects/https:evil', '/projects/a%3fevil', '/projects/a%23evil', '/projects/⧸evil', '/projects/%E2%88%96evil'];
for (const input of bad) test(`reject ${JSON.stringify(input)}`, () => assert.equal(validate(input), '/today'));
for (const path of ['/projects', '/projects/kitchen?tab=money#invoice', '/projects/kitchen/scope', '/settings/team/abc', '/engine/permissions', '/inbox?filter=unread', '/today#queue', '/']) test(`accept ${path}`, () => assert.equal(validate(path), path));
test('strip private pane and unapproved Browser query parameters', () => {
 assert.equal(validate('/projects/kitchen?c=private&m=canvas&browser=bad&review=bad&tab=money#scope'), '/projects/kitchen?tab=money#scope');
 assert.equal(validate('/today?%63=secret&%6d=canvas&browser=bad&review=bad'), '/today');
});
test('only the exact Browser allowlist survives', () => {
 const browser = '/today?browser=12345678-1234-1234-1234-123456789abc&review=abcdefab-1234-1234-1234-123456789abc';
 assert.equal(validate(browser), browser);
 assert.equal(exports.validateBrowserReturnPath('/projects'), null);
 assert.equal(validate(browser + '&c=secret'), '/today');
});

const homeForRole = role => role === 'owner' ? '/today' : '/client-portal';
const redirect = path => { throw Object.assign(new Error('redirect'), {path}); };
for (const [input, expected] of [['/projects/kitchen?tab=money&c=secret#scope', '/projects/kitchen?tab=money#scope'], ['//evil.com','/today'], [null,'/client-portal']]) test(`login action revalidates form return ${input}`, async () => {
 let created=0;
 const action=load('lib/actions/auth.ts', {
  '@/lib/web-sessions': exports, 'next/navigation': {redirect}, zod: require('zod'),
  '@/lib/db': {queryOne: async()=>({id:'person',active:true,role:'client',password_hash:'hash'})},
  '@/lib/password': {verifyPassword:async()=>true}, '@/lib/session':{createSession:async()=>{created++;}},
  '@/lib/dal': {homeForRole}, '@/lib/permissions': {normalizePermissions:()=>[]},
 });
 const form=new FormData();form.set('email','person@example.test');form.set('password','secret');if(input!==null)form.set('returnTo',input);
 await assert.rejects(action.login({},form),e=>e.path===expected);assert.equal(created,1);
});
function request(path, authenticated=false) {
 const url=new URL(path,'https://app.test');url.clone=()=>{const copy=new URL(url);copy.clone=url.clone;return copy;};
 return {url:url.href,nextUrl:url,method:'GET',headers:new Headers(),cookies:{get:()=>authenticated?{value:'token'}:undefined}};
}
function proxyFor(session) {
 return load('proxy.ts', {
  'next/server': {NextResponse:{redirect:url=>({url:url.href,cookies:{set(){}}}),next:()=>({next:true})}},
  jose:{jwtVerify:async()=>({payload:{...session,iat:Math.floor(Date.now()/1000)}})},
  '@/lib/web-sessions':{...exports,verifyWebSessionToken:async()=>true},
  '@/lib/session-window':{SESSION_COOKIE:'session',SESSION_RENEW_AFTER_S:86400},
  '@/lib/permissions':{isOwnerOnlyPath:()=>false,staffHome:()=>'/today'},
 }).default;
}
test('signed-out proxy carries a sanitized ordinary return to login',async()=>{
 const result=await proxyFor()(request('/projects/kitchen?tab=money&c=private'));
 const url=new URL(result.url);assert.equal(url.pathname,'/login');assert.equal(url.searchParams.get('returnTo'),'/projects/kitchen?tab=money');
});
test('signed-in proxy preserves ordinary pathname, query and hash',async()=>{
 const result=await proxyFor({role:'owner',userId:'person'})(request('/login?returnTo='+encodeURIComponent('/projects/kitchen?tab=money#scope'),true));
 assert.equal(result.url,'https://app.test/projects/kitchen?tab=money#scope');
});
test('signed-in proxy rejects an external return',async()=>{
 const result=await proxyFor({role:'owner',userId:'person'})(request('/login?returnTo=%2F%2Fevil.com',true));assert.equal(result.url,'https://app.test/today');
});
test('Browser review still requires a sid session in the proxy',async()=>{
 const target='/today?browser=12345678-1234-1234-1234-123456789abc';
 const result=await proxyFor({role:'owner',userId:'person'})(request(target,true));
 assert.equal(new URL(result.url).pathname,'/login');assert.equal(new URL(result.url).searchParams.get('returnTo'),target);
});
for (const signedIn of [false,true]) test(`login page ${signedIn?'redirects':'form carries'} sanitized ordinary return`,async()=>{
 const page=load('app/login/page.tsx', {
  'react/jsx-runtime':require('react/jsx-runtime'), '@/lib/web-sessions':exports,
  '@/lib/session':{readSession:async()=>null}, '@/lib/dal':{getCurrentUser:async()=>signedIn?{role:'owner'}:null,homeForRole},
  'next/navigation':{redirect},
 }).default;
 const props={searchParams:Promise.resolve({returnTo:'/projects/kitchen?c=secret&tab=money#scope'})};
 if(signedIn)await assert.rejects(page(props),e=>e.path==='/projects/kitchen?tab=money#scope');
 else {const tree=await page(props);let found;const visit=node=>{if(!node||typeof node!=='object')return;if(node.props?.returnTo)found=node.props.returnTo;const children=node.props?.children;for(const c of Array.isArray(children)?children:[children])visit(c);};visit(tree);assert.equal(found,'/projects/kitchen?tab=money#scope');}
});

test('allowlist covers every existing (os) page',()=>{
 for(const file of readdirSync(new URL('../app/(os)',import.meta.url),{recursive:true})) {
  if(!/(^|\/)page\.tsx$/.test(file))continue;
  const path='/'+file.replace(/(^|\/)page\.tsx$/,'').replace(/\[[^/]+\]/g,'sample');
  assert.equal(validate(path),path,file);
 }
});
