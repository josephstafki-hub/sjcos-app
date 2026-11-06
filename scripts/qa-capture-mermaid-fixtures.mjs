#!/usr/bin/env node
/** COORDINATOR ONLY. Starts one Chromium, no server or DB. Never run in a subagent.
 * Run inside the memory-capped unit documented in canvas-phase1-ui-HANDOFF.md.
 * Raw fixtures use the vendored bytes and the emitted renderer's initialize config.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {chromium} from '/home/joe/ordinem/node_modules/playwright-core/index.mjs';
import {CANVAS_BOOTSTRAP,MERMAID_ASSET_PATH,MERMAID_ASSET_SHA256,buildCanvasRendererDocument} from '../lib/canvas-renderer.mjs';
import {validateDiagramSource,validateCanvasSvg} from '../lib/canvas-content.mjs';
const root=new URL('../',import.meta.url);
const bundle=await readFile(new URL(MERMAID_ASSET_PATH,root),'utf8');
const doc=buildCanvasRendererDocument({mermaidBundle:bundle,mermaidSha256:MERMAID_ASSET_SHA256});
let config;
// Read the config by executing the exact bootstrap, not a copied initialize block.
runInNewContext(CANVAS_BOOTSTRAP,{crypto:webcrypto,TextEncoder,performance:{now:()=>0},setTimeout(){},clearTimeout(){},addEventListener(){},ResizeObserver:class{observe(){}},document:{documentElement:{}},parent:{postMessage(){}},mermaid:{initialize:c=>{config=c;}}});
const sources={
 'subgraphs':'flowchart TD\nsubgraph Project[Project work]\nA[Plan]-->B[Build]\nsubgraph Finish[Finish work]\nB-->C[Inspect]\nC-->D[Handover]\nend\nend',
 'long-labels':'flowchart TD\nA[Review the complete permit application and inspection requirements before scheduling work]-->B[Confirm the approved plans and the project schedule with the crew]\nB-->C[Handover]',
 'sequence-notes':'sequenceDiagram\nparticipant Joe\nparticipant Crew\nNote over Joe,Crew: Review the plan\nloop Each work day\nJoe->>Crew: Approve plan\nalt Inspection ready\nCrew-->>Joe: Work complete\nelse More work\nNote right of Crew: Prepare for inspection\nCrew-->>Joe: Work continues\nend\nend',
 'state-notes':'stateDiagram-v2\n[*] --> Draft\nnote right of Draft\nCheck the permit\nConfirm the plan\nend note\nDraft --> Ready\nnote left of Ready: Inspection booked\nReady --> [*]',
 'flowchart-100':'flowchart LR\n'+Array.from({length:99},(_,n)=>` N${n}[Step ${n+1}]-->N${n+1}[Step ${n+2}]`).join('\n'),
};
for(const source of Object.values(sources))validateDiagramSource(source);
const browser=await chromium.launch({executablePath:'/home/joe/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const report=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 // Fulfilled synthetic origin lets the real child reject null parent origins.
 // Every other request is aborted; there is no server/network connection.
 await context.route('**/*',route=>route.request().url()==='https://canvas-fixture.invalid/'?route.fulfill({contentType:'text/html',body:'<!doctype html><main id="canvas-root"></main>'}):route.abort());
 const page=await context.newPage();
 await page.goto('https://canvas-fixture.invalid/');
 await page.addScriptTag({content:bundle});
 await page.evaluate(c=>mermaid.initialize(c),config);
 for(const [name,source] of Object.entries(sources)){
  const raw=await page.evaluate(async({name,source})=>{
   const result=await mermaid.render('canvas-fixture-'+name,source);
   const parsed=new DOMParser().parseFromString(result.svg,'image/svg+xml');
   return {svg:result.svg,viewBox:parsed.documentElement.getAttribute('viewBox'),elements:parsed.querySelectorAll('*').length,bytes:new TextEncoder().encode(result.svg).length};
  },{name,source});
  await writeFile(new URL(`tests/fixtures/canvas-mermaid-12.3.0-${name}.svg`,root),raw.svg+'\n');
  // Run the real opaque-frame handshake + normalization as well as raw capture.
  const rendered=await page.evaluate(async({html,source})=>{
   return await new Promise(resolve=>{
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
    let port;const finish=value=>{clearTimeout(timer);window.removeEventListener('message',connect);port?.close();frame.remove();resolve(value);};
    const timer=setTimeout(()=>finish({code:'COORDINATOR_TIMEOUT'}),15000);
    function connect(event){if(event.source!==frame.contentWindow||event.origin!=='null'||event.data?.type!=='canvas-ready')return;
     const {instance_id,nonce}=event.data,channel=new MessageChannel();port=channel.port1;
     port.onmessage=({data})=>{if(data.type==='ready')port.postMessage({type:'render',instance_id,nonce,sequence:1,canvas_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',version:1,source});else if(['rendered','error'].includes(data.type))finish({code:data.code??'rendered',diagnostic:data.diagnostic,svg:data.svg,width:data.width,height:data.height});};
     port.start();frame.contentWindow.postMessage({type:'connect',instance_id,nonce},'*',[channel.port2]);
    }
    window.addEventListener('message',connect);frame.srcdoc=html;document.body.append(frame);
   });
  },{html:doc.html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+doc.headers['Content-Security-Policy'].replace('sandbox allow-scripts; ','').replace("; frame-ancestors 'self'",'')+'">'),source});
  if(rendered.svg)validateCanvasSvg(rendered.svg);
  const {svg:unused,...metrics}=raw;const {svg:canonical,...result}=rendered;
  const entry={name,...metrics,...result};report.push(entry);console.log(JSON.stringify(entry));
 }
 await context.close();
}finally{await browser.close();}
await mkdir(new URL('tmp/',root),{recursive:true});
const output=new URL('tmp/canvas-mermaid-fixture-report.json',root);await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log('Fixture report: '+fileURLToPath(output));
