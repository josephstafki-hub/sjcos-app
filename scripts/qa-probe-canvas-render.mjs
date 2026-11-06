// Coordinator only. Run against an ALREADY RUNNING, isolated production QA build.
// This script starts Chromium, never a server, and closes everything it opens.
// No installs, DB access, seeding, model calls, screenshots or private console dumps.
// Required env: SJC_CANVAS_QA_BASE_URL, SJC_CANVAS_QA_STORAGE_STATE,
// SJC_CANVAS_QA_SEED (JSON from qa-seed-canvas.mjs).
// Optional: SJC_CANVAS_QA_PLAYWRIGHT (existing module URL/path),
// SJC_CANVAS_QA_CHROMIUM (existing executable path).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const required=name=>{assert.ok(process.env[name],`Missing ${name}`);return process.env[name];};
const base=new URL(required('SJC_CANVAS_QA_BASE_URL'));
assert.ok(['http:','https:'].includes(base.protocol));
assert.ok(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Use a loopback QA side port, never the live site');
assert.ok(base.port,'An explicit QA side port is required');
const seed=JSON.parse(readFileSync(required('SJC_CANVAS_QA_SEED'),'utf8'));
const storageState=required('SJC_CANVAS_QA_STORAGE_STATE');
const {chromium}=await import(process.env.SJC_CANVAS_QA_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.SJC_CANVAS_QA_CHROMIUM?{executablePath:process.env.SJC_CANVAS_QA_CHROMIUM}:{})});
const hash=s=>createHash('sha256').update(s,'utf8').digest('base64');
let context;
try{
 context=await browser.newContext({storageState});
 await context.addInitScript(()=>{
  window.__canvasQa={opaqueReady:false};
  window.addEventListener('message',event=>{if(event.data?.type==='canvas-ready'&&event.origin==='null'&&[...document.querySelectorAll('iframe')].some(f=>f.contentWindow===event.source))window.__canvasQa.opaqueReady=true;});
 });
 async function inspect(name,path,width,height,{panel=false,labels=[]}={}){
  const page=await context.newPage();
  const failures=[],checks=[],childRequests=[];
  page.on('pageerror',()=>failures.push('PAGE_ERROR'));
  page.on('console',m=>{if(/^CANVAS_(?:HANDSHAKE_TIMEOUT|RENDER_TIMEOUT|RENDER_FAILED)$/.test(m.text()))failures.push(m.text());});
  page.on('request',request=>{if(request.frame()!==page.mainFrame()&&request.resourceType()!=='document')childRequests.push(request.resourceType());});
  page.on('response',response=>{
   if(new URL(response.url()).pathname!=='/api/canvas/renderer')return;
   checks.push((async()=>{
    assert.equal(response.status(),200,'renderer HTTP status');
    const csp=response.headers()['content-security-policy'];
    assert.match(csp,/sandbox allow-scripts;/);assert.doesNotMatch(csp,/allow-same-origin|unsafe-eval|nonce-/);
    assert.match(csp,/connect-src 'none'/);assert.equal(response.headers()['x-frame-options'],undefined);
    const scripts=[...(await response.text()).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    assert.equal(scripts.length,2,'two inline scripts');
    const authorized=csp.split('script-src ')[1].split(';')[0].match(/'sha256-[^']+'/g);
    assert.deepEqual(authorized.sort(),scripts.map(s=>`'sha256-${hash(s)}'`).sort(),'actual HTTP script bytes vs CSP');
   })().then(()=>null,()=>{failures.push('HTTP_SCRIPT_HASH_OR_POLICY');}));
  });
  try{
   await page.setViewportSize({width,height});
   await page.goto(new URL(path,base).href,{waitUntil:'domcontentloaded'});
   if(panel){
    const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:/Flowchart history/})});
    await card.getByRole('button',{name:/Open canvas|Open version/}).first().click();
   }
   const iframe=page.locator('iframe[src="/api/canvas/renderer"]');
   await iframe.waitFor({state:'attached',timeout:15000});
   const frame=await iframe.elementHandle().then(el=>el.contentFrame());
   assert.ok(frame);
   await frame.waitForSelector('#canvas-root > svg',{timeout:15000});
   const result=await frame.evaluate(()=>{
    const svg=document.querySelector('#canvas-root > svg'),box=svg.getBoundingClientRect();
    let opaque=false;try{void parent.document;}catch{opaque=true;}
    return {opaque,width:box.width,height:box.height,text:svg.textContent,styleCount:svg.querySelectorAll('style,foreignObject,script').length};
   });
   assert.ok(result.opaque,'frame must not access app DOM');
   assert.ok(result.width>0&&result.width<=8192&&result.height>0&&result.height<=8192,'visible bounded SVG');
   for(const label of labels)assert.ok(result.text.includes(label),'expected label is visible');
   assert.equal(result.styleCount,0,'canonical SVG only');
   assert.equal(await iframe.getAttribute('sandbox'),'allow-scripts');
   assert.equal(await page.evaluate(()=>window.__canvasQa.opaqueReady),true,'announcement from null origin/current frame');
   // Catch a late disposal/error and any attempted child resources.
   await page.waitForTimeout(500);
   assert.equal(await iframe.count(),1,'frame survives render');
   await Promise.all(checks);assert.ok(checks.length>0,'renderer response captured');
   assert.deepEqual(failures,[]);assert.deepEqual(childRequests,[],'no child resource requests');
   console.log(`PASS ${name}: real SVG, opaque bridge, exact HTTP hashes, no child network`);
  }catch(error){
   // Fixed codes only; never dump source, SVG, session state, URLs or parser errors.
   await Promise.all(checks);
   throw new Error(`FAIL ${name}: ${failures.join(',')||'SVG_OR_BRIDGE_ASSERTION'}`,{cause:undefined});
  }finally{await page.close();}
 }
 const flow=seed.joe_flow_v3;assert.ok(flow?.urls?.wrapper&&flow?.urls?.panel,'Missing joe_flow_v3 seed');
 const labels=['Plan','Build','Inspect','Handover'];
 for(const [width,height] of [[360,800],[390,844],[800,360],[820,1180],[1280,900]])await inspect(`wrapper ${width}x${height}`,flow.urls.wrapper,width,height,{labels});
 for(const [width,height] of [[390,844],[1280,900]])await inspect(`panel ${width}x${height}`,flow.urls.panel,width,height,{panel:true,labels});
 if(seed.joe_sequence)await inspect('sequence wrapper',seed.joe_sequence.urls.wrapper,1280,900,{labels:['Joe','Crew','Approve plan','Work complete']});
 // Verify handshake failure is observable without changing sandbox or CSP.
 const page=await context.newPage(),diagnostics=[];
 try{
  page.on('console',m=>{if(m.type()==='warning')diagnostics.push(m.text());});
  await page.route('**/api/canvas/renderer',async route=>{
   const response=await route.fetch();
   await route.fulfill({response,body:'<!doctype html><title>QA withheld bootstrap</title>'});
  });
  await page.goto(new URL(flow.urls.wrapper,base).href,{waitUntil:'domcontentloaded'});
  await page.getByText('This is taking a while.',{exact:true}).waitFor({timeout:15000});
  assert.ok(diagnostics.includes('CANVAS_HANDSHAKE_TIMEOUT'),'parent handshake diagnostic missing');
  assert.equal(await page.locator('iframe').count(),0);
  console.log('PASS withheld bootstrap: fixed parent diagnostic, timeout and frame disposal');
 }finally{await page.close();}
}finally{await context?.close();await browser.close();}
