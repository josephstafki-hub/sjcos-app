import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const url=new URL('../components/shell/Topbar.tsx',import.meta.url).href;
let path='/inbox',events=[];globalThis.__phonePath=()=>path;
globalThis.window={dispatchEvent:event=>events.push(event.type)};
const stubs={
 'next/navigation':'export const usePathname=()=>globalThis.__phonePath();',
 'next/link':'export default function Link(){}',
 '@/components/ui/Button':'export function Button(){}',
 '@/components/panel/CommandPalette':'export const PALETTE_EVENT="palette";export function CommandPalette(){}',
 './NotificationBell':'export function NotificationBell(){}',
};
registerHooks({resolve(s,c,n){return c.parentURL===url&&s in stubs?{url:'phone:'+s,shortCircuit:true}:n(s,c)},load(u,c,n){if(u===url)return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return u.startsWith('phone:')?{format:'module',source:stubs[u.slice(6)],shortCircuit:true}:n(u,c)}});
const {Topbar}=await import(url);
const nodes=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)];
test('phone inbox has one title, one bell, search and compose triggers with no duplicate field',()=>{
 const list=nodes(Topbar({breadcrumb:'Inbox / Unified',leading:'Menu'}));
 const search=list.find(n=>n.props?.['aria-label']==='Search inbox');const compose=list.find(n=>n.props?.['aria-label']==='Compose email');
 assert.match(search.props.className,/size-11/);assert.match(compose.props.className,/size-11/);
 search.props.onClick();compose.props.onClick();assert.deepEqual(events,['inbox-search','inbox-compose']);
 assert.ok(list.some(n=>n.type==='span'&&n.props.children==='Inbox'&&n.props.className.includes('@max-[40rem]/shell:block')));
 assert.equal(list.filter(n=>n.type?.name==='NotificationBell').length,1);
 assert.ok(list.find(n=>n.props?.id==='inbox-approval-badge'));
 assert.ok(list.some(n=>n.props?.['aria-label']==='Inbox views'));
 list.find(n=>n.props?.['aria-label']==='Inbox views').props.onClick();assert.equal(events.at(-1),'inbox-views');
 assert.match(list.find(n=>n.props?.['aria-label']==='Search').props.className,/@max-\[40rem\]\/shell:hidden/);
 assert.equal(list.some(n=>n.type==='input'),false);
});
test('other pages retain their usual global controls',()=>{
 path='/schedule';const list=nodes(Topbar({breadcrumb:'Schedule'}));assert.equal(list.some(n=>n.props?.['aria-label']==='Compose email'),false);assert.equal(list.find(n=>n.props?.['aria-label']==='Search').props.className,undefined);
});

// Compile the actual utilities: @max-sm is only 384px, so class-name-only
// tests missed the two-toolbar regression at 390px. No browser or app build.
test('phone chrome switches at 640px of available shell/page width, including 390px',async()=>{
 const {compile}=await import('@tailwindcss/node');
 const source=readFileSync(new URL('../components/shell/Topbar.tsx',import.meta.url),'utf8');
 const inbox=readFileSync(new URL('../components/inbox/InboxClient.tsx',import.meta.url),'utf8');
 const tokens=[...source.matchAll(/@max-\[40rem\]\/shell:[\w!:-]+/g),...inbox.matchAll(/@max-\[40rem\]\/page:[\w!:-]+/g)].map(m=>m[0]);
 assert.ok(tokens.includes('@max-[40rem]/shell:hidden'));assert.ok(tokens.includes('@max-[40rem]/page:!hidden'));
 const compiler=await compile('@import "tailwindcss";',{base:process.cwd(),onDependency(){}});
 const css=compiler.build(tokens);
 assert.match(css,/@container shell \(width < 40rem\)/);assert.match(css,/@container page \(width < 40rem\)/);
 assert.doesNotMatch(source+inbox,/@max-sm\/(?:shell|page)/);
});
