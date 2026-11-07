/** Fresh boot harness for root fixture execution only. No imports start IO. */
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rm,chown,chmod,lstat,readlink,stat,readdir} from 'node:fs/promises';
// Enter ONLY the network namespace (nsenter --net): `ip netns exec` remounts /sys, hiding
// /sys/fs/cgroup, so per-run memory/cpu groups could not be joined from inside it.
import {ROOT,SOURCE,parseRunnerArgs,selectedCases,command,commandFailure,assertMeasuredCase} from './root-runner.mjs';
import {verifySigned} from './controller-authority.mjs';
import {canonical} from './acceptance-attestation.mjs';
import {sha256} from './runtime-readiness.mjs';
import {createFixtureCA,runCommand} from './controller.mjs';
import {launchAcceptanceBrowser} from './launcher.mjs';
import {loadBootstrap} from './protected-bootstrap.mjs';
import {frameReader,encodeFrame} from './controller-rpc.mjs';
import {capturePackets,pcapMetrics} from './controller-network.mjs';
const PY=ROOT+'/py/bin/python',IO=ROOT+'/fixtures/fixture-io.py';
const host='fixture.example',childHost='child.example',url=name=>'https://'+host+'/'+name;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function check(value,step){if(!value)throw Error('BROWSER_MEASUREMENT_FAILED '+step);}
export async function until(action,{timeout=5000,step='ready'}={}){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await action();if(value)return value;}catch(e){if(e.message?.startsWith('BROWSER_ROOT_RUNNER'))throw e;last=e;}await delay(25);}throw Error('BROWSER_WAIT_FAILED '+step+' '+(last?.message??''));}
class Children{
 constructor(name,dir){this.name=name;this.dir=dir;this.children=[];}
 async start(cmd,args,{cgroup,step,ready}={}){
  const argv=cgroup?['-B',IO,'exec',cgroup,cmd,...args]:args,binary=cgroup?PY:cmd;
  const child=spawn(binary,argv,{detached:true,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-4096));child.on('error',e=>stderr=e.message);
  const record={child,cmd,args,step,stderr:()=>stderr};this.children.push(record);
  if(ready)await until(async()=>{if(child.exitCode!==null||child.signalCode)throw commandFailure(step,this.name,cmd,args,{code:child.exitCode,signal:child.signalCode,stderr});return ready();},{step,timeout:10000});return record;
 }
 async stop(r){if(!r||r.stopped)return;const p=r.child;const killed=p.exitCode===137||p.signalCode==='SIGKILL';r.stopped=true;try{process.kill(-p.pid,'SIGTERM');}catch{}if(p.exitCode===null&&!p.signalCode)await Promise.race([new Promise(resolve=>p.once('exit',resolve)),delay(2000)]);try{process.kill(-p.pid,'SIGKILL');}catch{}if(p.exitCode===null&&!p.signalCode)await new Promise(resolve=>p.once('exit',resolve));if(killed)throw commandFailure(r.step,this.name,r.cmd,r.args,{code:p.exitCode,signal:p.signalCode,stderr:r.stderr()});}
 async close(){const errors=[];for(const r of [...this.children].reverse()){try{await this.stop(r);}catch(e){errors.push(e.message);}await writeFile(this.dir+'/'+r.step.replace(/[^a-z0-9]/gi,'_')+'.stderr',r.stderr(),{mode:0o600});}if(errors.length)throw Error(errors.join('\n'));}
}
async function gateCall(socketPath,uid,op,data={}){
 const s=await lstat(socketPath);if(!s.isSocket()||s.uid!==uid||(s.mode&0o077))throw Error('BROWSER_GATE_SOCKET_OWNER');
 return new Promise((resolve,reject)=>{const socket=connect(socketPath);let done=false;const finish=(err,value)=>{if(done)return;done=true;socket.destroy();err?reject(Error('BROWSER_GATE_CONTROL '+op+(typeof err==='string'?' '+err.replace(/[^A-Z0-9_]/g,'').slice(0,60):''))):resolve(value);};socket.setTimeout(2000,()=>finish(true));socket.once('connect',()=>socket.write(encodeFrame({op,...data})));socket.on('error',()=>finish(true));socket.on('end',()=>{if(!done)finish(true);});socket.on('data',frameReader(x=>x.ok===true?finish(false,x):finish(typeof x?.code==='string'?x.code:(typeof x?.error==='string'?x.error:true)),()=>finish(true)));});
}
function dnsConfiguration(dir,{mixed=false,cname=false,rebound=false}={}){
 const records=[`fixture.example. 1 IN A ${rebound?'127.0.0.1':'8.8.8.8'}`,`child.example. 1 IN A 8.8.8.8`,...(mixed?['mixed.example. 1 IN A 8.8.8.8','mixed.example. 1 IN A 127.0.0.1']:['mixed.example. 1 IN A 8.8.8.8']),...(cname?['cname.example. 1 IN CNAME private.example.','private.example. 1 IN A 10.0.0.1']:['cname.example. 1 IN A 8.8.8.8'])];
 return `server:\n interface: 10.204.0.2\n port: 53\n username: ""\n chroot: ""\n directory: "${dir}"\n pidfile: ""\n use-syslog: no\n logfile: ""\n do-daemonize: no\n num-threads: 1\n access-control: 10.204.0.0/30 allow\n do-ip6: no\n module-config: "iterator"\n local-zone: "example." static\n${records.map(r=>' local-data: "'+r+'"').join('\n')}\n`;
}
async function fixtureLeaf(dir,ca){const key=dir+'/leaf.key',csr=dir+'/leaf.csr',cert=dir+'/leaf.pem',ext=dir+'/leaf.ext';await writeFile(ext,'subjectAltName=DNS:fixture.example,DNS:child.example,DNS:mixed.example,DNS:cname.example\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600});await runCommand('/usr/bin/openssl',['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=fixture.example','-keyout',key,'-out',csr]);await runCommand('/usr/bin/openssl',['x509','-req','-in',csr,'-CA',ca.caFile,'-CAkey',ca.keyFile,'-CAcreateserial','-days','1','-sha256','-extfile',ext,'-out',cert]);await chmod(key,0o600);return {key,cert};}
async function readOrigin(file){try{const text=await readFile(file,'utf8');check(Buffer.byteLength(text)<=1048576,'origin log bound');return text.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
const bodySha=method=>sha256(method==='POST'?'fixture-write':'');
export async function runSuite(args){
 const o=parseRunnerArgs(args),names=selectedCases(o.kind,o.caseName);check(process.getuid()===0&&/^[a-f0-9-]{36}$/.test(o.runId),'root nonce');
 const tag=/^b0b-([a-f0-9]{8})-b$/.exec(o.browserNs)?.[1];check(tag&&o.gateNs==='b0b-'+tag+'-g'&&o.fixtureNs==='b0b-'+tag+'-f','namespace identity');
 if(await readlink('/proc/self/ns/net')===await readlink('/proc/1/ns/net')){
  // Per-case process boots in browser netns; parent stays on host only to own
  // lifecycle and collect bounded documents. No CDP/HTTP endpoint on the host.
  const cases=[];let rss;args=[...args,'--supervisor-pids',o.supervisorPids+','+process.pid];
  for(const name of names){const output=await command('/usr/bin/nsenter',['--net=/run/netns/'+o.browserNs,'--','/usr/bin/node','--max-old-space-size=256',SOURCE+'/deploy/browser/fixtures/root-fixture.mjs',...args.filter((a,i)=>a!=='--case'&&args[i-1]!=='--case'),'--case',name],{step:'fresh boot',caseName:name,cgroup:o.helperCgroup,timeout:name==='slow-body-deadline'?90000:120000});const result=JSON.parse(output);cases.push(result.case);rss=combineRss(rss,result.rss);}
  await verifyCaseArtifacts(o.logDir,cases);
  const e={runId:o.runId,kind:o.kind,realRuntime:true,simulated:false,runtimeLockSha256:sha256(await readFile(ROOT+'/runtime-lock.json')),cases,parserTransportIntegrated:true,releaseReady:false,...(o.caseName?{diagnosticOnly:true}:{}),...(o.kind==='network'?{unapprovedUpstreamBytes:cases.reduce((n,c)=>n+c.measurement.unapprovedUpstreamBytes,0),privatePackets:cases.reduce((n,c)=>n+c.measurement.privatePackets,0),captureIngressVerified:cases.every(c=>c.measurement.packets>0),guardOrderingVerified:cases.every(c=>c.measurement.guardOrderingVerified)}:rss)};
  check(Buffer.byteLength(JSON.stringify(e))<=1048576,'evidence document bound');console.log(JSON.stringify(e));return;
 }
 check(names.length===1,'fresh boot one case');const name=names[0],bootRunId=randomUUID(),dir=o.logDir+'/'+name;await mkdir(dir,{mode:0o700});
 await writeFile(dir+'/owned.json',JSON.stringify({bootRunId}),{mode:0o600,flag:'wx'});
 const children=new Children(name,dir);let ca,controller,runtime,gateProcess,dnsProcess,gate,runFile,publicCA;const state={samples:[],targetEvents:[],lastEvents:[],maxima:{request:0,response:0,transport:0},maxSlots:0,maxContexts:0,maxQueue:0};
 let sampler,collectionError,gateCrashed=false; // gateCrashed: visible to the outer finally (deadGate is block-scoped)
 try{
  const {config,adapter}=await loadBootstrap();check(typeof adapter.prepareFixtureController==='function','installed candidate controller');
  ca=await createFixtureCA({runDir:dir});const leaf=await fixtureLeaf(dir,ca);
  // Public CA only in a root-owned searchable path, never expose the CA key.
  publicCA='/run/sjcos-browser/ca-'+bootRunId+'.pem';await writeFile(publicCA,await readFile(ca.caFile),{mode:0o644,flag:'wx'});
  const gateDir='/run/sjcos-browser/g-'+bootRunId;await mkdir(gateDir,{mode:0o700});await chown(gateDir,config.uid,config.gid);
  const gateConfigDir='/etc/sjcos-browser/runs/'+bootRunId;await mkdir(gateConfigDir,{mode:0o750});await chown(gateConfigDir,0,config.gid);
  for(const [to,from]of [['leaf.pem',leaf.cert],['leaf.key',leaf.key],['ca.pem',ca.caFile]]){await writeFile(gateConfigDir+'/'+to,await readFile(from),{mode:0o640});await chown(gateConfigDir+'/'+to,0,config.gid);}
  const gateSocket=gateDir+'/gate.sock';gate=(op,data)=>gateCall(gateSocket,config.uid,op,data);
  const originLog=dir+'/origin.jsonl',originConfig=dir+'/origin.json',originReady=dir+'/origin.ready';await writeFile(originConfig,JSON.stringify({cert:leaf.cert,key:leaf.key,log:originLog,ready:originReady}),{mode:0o600});
  await children.start('/usr/bin/nsenter',['--net=/run/netns/'+o.fixtureNs,'--',PY,'-B',IO,'origin',originConfig],{step:'TLS origin',cgroup:o.helperCgroup,ready:()=>lstat(originReady)});
  const dnsFile=dir+'/unbound.conf';
  const startDns=async flags=>{await children.stop(dnsProcess);await writeFile(dnsFile,dnsConfiguration(dir,flags),{mode:0o600});dnsProcess=await children.start('/usr/bin/nsenter',['--net=/run/netns/'+o.fixtureNs,'--',ROOT+'/unbound/sbin/unbound','-d','-c',dnsFile],{step:'DNS',cgroup:o.dnsCgroup,ready:async()=>{const cmd=['--net=/run/netns/'+o.gateNs,'--',PY,'-B','-c','import socket;s=socket.create_connection(("10.204.0.2",53),.2);s.close()'];
   // A refused probe only means Unbound is not listening YET: retry (until() treats runner errors as fatal).
   try{await command('/usr/bin/nsenter',cmd,{timeout:1000});return true;}catch{return false;}}});};
  await startDns({mixed:name==='mixed-dns',cname:name==='cname-private'});
  const bootId=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),run={purpose:'browser-0b-candidate',runId:bootRunId,userId:randomUUID(),taskId:randomUUID(),bootId,namespace:o.browserNs,expiresAt:Date.now()+600000,runtimeLockSha256:sha256(await readFile(ROOT+'/runtime-lock.json')),networkConfig:{appHosts:['app.example'],serviceHosts:['service.example'],hostPublicAddresses:['9.9.9.9']}};
  await writeFile(dir+'/owned.json',JSON.stringify({bootRunId,userId:run.userId,taskId:run.taskId}),{mode:0o600});
  runFile='/etc/sjcos-browser/runs/'+bootRunId+'.json';await writeFile(runFile,JSON.stringify(run),{mode:0o600,flag:'wx'});
  const specs=[{method:'GET',url:url('control'),kind:'document'},{method:'GET',url:url(name),kind:'document',uses:o.kind==='rss'?2:1},{method:'GET',url:url('completion'),kind:'document',uses:2},{method:'GET',url:'https://child.example/'+name,kind:name==='oopif-first-request'?'document':'document'},{method:'POST',url:url('write'),kind:'fetch'}];
  if(['held-request-review','preallocation-backpressure'].includes(name))specs.push({method:'POST',url:url(name),kind:'fetch',bodySha256:sha256(Buffer.alloc(25*1048576,120))});
  if(name==='controller-loss-keepalive')specs.push({method:'GET',url:url('two-25MiB-slow-readers'),kind:'document'});
  if(name==='mixed-dns'||name==='cname-private')specs.push({method:'GET',url:'https://'+(name==='mixed-dns'?'mixed':'cname')+'.example/'+name,kind:'document'});
  let once=false,reviewRelease,faultObserved=null,faultProof=null;
  controller=await adapter.prepareFixtureController({run,dir,config,gate,ca:{caFile:publicCA,caSha256:ca.caSha256},specs,onRequest:async r=>{
   if(name==='dns-rebind'&&r.url===url(name)&&!once){once=true;await startDns({rebound:true});}
   if(r.url===url('write')){
    if(name==='fetch-detach-buffered-write'){const session=controller.sessions[0];await session._parentSession.send('Target.detachFromTarget',{sessionId:session._sessionId});faultObserved='actual-session-detach';faultProof={sessionId:session._sessionId,acknowledged:true};}
    else if(name==='controller-loss-unknown'){faultProof=await controller.kill();faultObserved='controller-SIGKILL-after-consume';}

   }
   if(name==='held-request-review'&&r.url===url(name))await delay(500);
   if(name==='preallocation-backpressure'&&r.method==='POST')await new Promise(resolve=>reviewRelease=resolve);
  }});
  const sourceHashes={};for(const file of ['parser_adapter.py','transport_runtime.py','transport_tls.py','transport_dns.py','transport_control.py','egress_gate.py','closed_dispatcher.py'])sourceHashes[file]=sha256(await readFile(ROOT+'/'+file));
  const gateConfig=gateConfigDir+'/gate.json';await writeFile(gateConfig,JSON.stringify({controlSocket:gateSocket,policySocket:controller.policyPath,listenHost:'10.203.0.2',listenPorts:[18081,18082],clientCert:gateConfigDir+'/leaf.pem',clientKey:gateConfigDir+'/leaf.key',upstreamCa:gateConfigDir+'/ca.pem',sourceHashes,deniedAddresses:['9.9.9.9']}),{mode:0o640});await chown(gateConfig,0,config.gid);
  gateProcess=await children.start('/usr/bin/nsenter',['--net=/run/netns/'+o.gateNs,'--','/usr/bin/setpriv','--reuid='+config.uid,'--regid='+config.gid,'--clear-groups',PY,'-B',ROOT+'/transport_runtime.py','--config',gateConfig],{step:'gate',cgroup:o.gateCgroup,ready:()=>gate('stats')});
  gateProcess.child.once('exit',()=>{void controller.policy.revokeListener().catch(()=>{});});
  const baseline=Number(await readFile(o.gateCgroup+'/memory.current','utf8'));check(baseline<=144*1048576,'gate baseline <=144MiB');
  const beforeEvents=await readFile(o.gateCgroup+'/memory.events','utf8');
  runtime=await launchAcceptanceBrowser({runId:bootRunId,namespace:{name:o.browserNs,current:await readlink('/proc/self/ns/net'),host:await readlink('/proc/1/ns/net')},userId:run.userId,taskId:run.taskId,uid:config.uid,gid:config.gid,policy:controller.policy,onPort:async()=>{}});
  const progress=runtime.progress,contexts=[];
  const newContext=async()=>{const context=await runtime.browser.newContext(progress,{serviceWorkers:'block',viewport:{width:800,height:600},proxy:{server:'http://10.203.0.2:'+(18081+contexts.length)}});contexts.push(context);return context;};
  const page=await (await newContext()).newPage(progress);
  // core.server.nullProgress has timeout 0, so goto's own timeout is never applied and a navigation
  // whose request the controller denied (boot revoked, request never continued) would hang forever.
  const navigate=(u,p=page)=>{const nav=p.mainFrame().goto(progress,u,{waitUntil:'domcontentloaded',timeout:4000});nav.catch(()=>{});
   let t;return Promise.race([nav,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('BROWSER_NAVIGATE_TIMEOUT')),8000);})]).finally(()=>clearTimeout(t));};
  const evaluate=expression=>page.mainFrame().evaluateExpression(progress,expression,{isFunction:false});
  const negative=async action=>{try{return await action();}catch(e){if(/KILLED_DO_NOT_RETRY/.test(e.message))throw e;return null;}};
  await gate('case_begin',{name});
  const sample=async()=>{const s=await gate('stats');const ev=await gate('events_drain');check(ev.droppedEvents===0,'no dropped gate events');state.lastEvents.push(...ev.events);check(state.lastEvents.length<=2048,'bounded complete gate trace');state.samples.push({at:Date.now(),flows:s.flows,slots:s.activeResponseSlots,pools:s.pools});state.tailFlowIds=[...new Set(state.lastEvents.filter(e=>e.event==='outstanding_tcp_tail'&&e.bodyBytes===25*1048576&&e.bytes>0&&e.reserved===true).map(e=>e.id))];state.tailObserved=state.tailFlowIds.length>=2;if(state.samples.length>1024)state.samples.shift();for(const k of Object.keys(state.maxima))state.maxima[k]=Math.max(state.maxima[k],s.maxima[k]);state.maxSlots=Math.max(state.maxSlots,s.maxResponseSlots);state.maxQueue=Math.max(state.maxQueue,s.maxDirectionalQueueBytes);state.maxContexts=Math.max(state.maxContexts,s.listeners);return s;};
  let sampling=false;sampler=setInterval(()=>{if(sampling)return;sampling=true;sample().catch(e=>{if(name!=='gate-crash')collectionError=e;}).finally(()=>sampling=false);},100);
  const client=async({path='/'+name,method='GET',port=18081,host:hostname=host,...extra}={})=>{
   const binding=controller.bindings.find(b=>b.listener===port);check(binding,'raw parser binding');await controller.queueRaw(binding,{method,url:'https://'+hostname+path,kind:method==='POST'?'fetch':'document'});
   const file=dir+'/client-'+randomUUID()+'.json';await writeFile(file,JSON.stringify({host:hostname,path,method,port,ca:publicCA,...extra}),{mode:0o600});return JSON.parse(await command(PY,['-B',IO,'request',file],{step:'TLS client',caseName:name,cgroup:o.helperCgroup,timeout:75000}));
  };
  let result={},probeCapture,deadGate=false;
  const interfaces=JSON.parse(await command('ip',['-n',o.fixtureNs,'-j','addr'],{step:'capture interface identity',caseName:name}));
  const packetIdentity={linkControlSources:interfaces.filter(x=>x.ifname==='fg'+o.fixtureNs.slice(4,12)).flatMap(x=>(x.addr_info??[]).filter(a=>a.family==='inet6'&&a.scope==='link').map(a=>({index:x.ifindex,source:ipv6Hex(a.local),mac:x.address.replaceAll(':','')})))};
  const pcap=dir+'/ingress.pcap',caseStarted=Date.now();
  const captured=await capturePackets(o.fixtureNs,pcap,async()=>{
   await navigate(url('control'));await until(async()=>{const s=await sample();return s.flows===0&&s.handlers===0;},{step:'positive drain'});
   const controls=await readOrigin(originLog);check(controls.some(r=>r.path==='/control'),'plaintext positive origin control');
   const direct={ 'direct-ipv4':{host:'8.8.8.8',port:443},'direct-ipv6':{host:'2606:4700:4700::1111',port:443,family:6},'direct-udp':{host:'8.8.8.8',port:443,udp:true},quic:{host:'8.8.8.8',port:443,udp:true},'direct-dns':{host:'10.204.0.2',port:53,udp:true},'host-app':{host:'10.203.0.2',port:3017},'private-ip':{host:'169.254.169.254',port:80}};
   if(direct[name]){
    const file=dir+'/probe.json';await writeFile(file,JSON.stringify(direct[name]));
    const probeCaptured=await capturePackets(o.fixtureNs,dir+'/probe.pcap',async()=>{result=JSON.parse(await command(PY,['-B',IO,'probe',file],{step:'bypass probe',caseName:name}));});
    // Empty = no packet at all except kernel link-local IPv6 NDP/MLD (even HTTPS to the fixture counts here).
    {const m=fixturePacketMetrics(await readFile(dir+'/probe.pcap'),packetIdentity);probeCapture={...m,capture:probeCaptured.capture,bypassPackets:m.packets-m.linkControlPackets};}check(probeCapture.bypassPackets===0&&!result.connected,'bypass capture empty');
   }else if(name==='host-cdp'){
    const file=dir+'/probe.json';await writeFile(file,JSON.stringify({host:'127.0.0.1',port:runtime.port}));result=JSON.parse(await command('/usr/bin/nsenter',['--net=/proc/1/ns/net',PY,'-B',IO,'probe',file],{step:'host CDP probe',caseName:name}));check(!result.connected,'CDP unreachable from host');
   }else if(name==='listener-cross-context'){
    await (await newContext()).newPage(progress);const b=controller.bindings[0];await negative(()=>gate('bind',{port:18081,binding:{generation:b.generation,guardId:b.guardId,contextId:controller.bindings.at(-1).contextId,taskId:b.taskId,bootId:b.bootId,targetId:b.targetId}}));check((await gate('stats')).dead,'cross context rejected');
   }else if(name==='listener-reuse'){
    const b=controller.bindings[0];await gate('revoke',{listenerCookie:b.listenerCookie,generation:b.generation});await negative(()=>gate('bind',{port:18081,binding:{generation:b.generation,guardId:b.guardId,contextId:b.contextId,taskId:b.taskId,bootId:b.bootId,targetId:b.targetId}}));check((await gate('stats')).dead,'stale generation rejected');
   }else if(['popup-first-request','oopif-first-request','worker-never-resumes'].includes(name)){
    await navigate(url(name));const target=JSON.stringify('https://child.example/'+name);
    if(name==='popup-first-request')await negative(()=>evaluate('window.open('+target+')'));
    else if(name==='oopif-first-request')await negative(()=>evaluate('{const f=document.createElement("iframe");f.src='+target+';document.body.append(f);}'));
    // Build the worker source with JSON.stringify: the previous hand-escaped literal reached the page as a
    // SyntaxError (swallowed by negative()), so no worker was ever created and the barrier was never exercised.
    else await negative(()=>evaluate('new Worker(URL.createObjectURL(new Blob(['+JSON.stringify('fetch('+target+')')+'],{type:"text/javascript"})))'));
    await delay(800);
   }else if(name==='gate-crash'){
    await sample();await gate('fault_arm',{point:'before_request_decision',action:'exit'});await negative(()=>navigate(url(name)));await until(()=>gateProcess.child.exitCode===70,{step:'abrupt gate exit 70'});deadGate=true;gateCrashed=true;check(controller.events.some(e=>e.event==='boot_revoked'),'gate crash revokes browser');
   }else if(name==='fetch-detach-buffered-write'||name==='controller-loss-keepalive'||name==='controller-loss-unknown'||name==='consumed-write-no-retry'){
    if(name==='controller-loss-keepalive'){
      const active=client({path:'/two-25MiB-slow-readers',readRelease:dir+'/never.release'});
      await until(async()=>{await sample();return state.lastEvents.some(e=>e.event==='response_buffered'&&e.bodyBytes===25*1048576);},{step:'active retained TLS transfer'});
      faultProof=await controller.kill();faultObserved='controller-SIGKILL-active-transfer';await writeFile(dir+'/never.release','read');result=await active;
    }else {
    if(name==='consumed-write-no-retry')await gate('fault_arm',{point:'after_consume',action:'revoke_all'});result=await client({path:'/write',method:'POST'});
    }
   }else if(name==='addon-uncaught-exception'){
    await gate('fault_arm',{point:'before_request_decision',action:'raise'});await negative(()=>navigate(url(name)));check((await gate('stats')).dead,'uncaught exception closes runtime');
   }else if(name==='unauthorized-second-request'){
    await navigate(url(name));await negative(()=>navigate(url(name)));await negative(()=>client({path:'/'+name,second:true}));
   }else if(['sni-mismatch','host-mismatch','peer-mismatch'].includes(name)){
    if(name==='peer-mismatch')await gate('fault_arm',{point:'before_dial',action:'dial_other_peer'});
    result=await client(name==='sni-mismatch'?{sni:childHost}:name==='host-mismatch'?{headerHost:childHost}:{});
   }else if(name==='proxy-407'){
    await gate('fault_arm',{point:'before_connect_reply',action:'proxy407'});await negative(()=>navigate(url(name)));
   }else if(name==='doh'){
    await negative(()=>navigate('https://dns.google/dns-query'));check(controller.events.some(e=>e.event==='boot_revoked'),'DoH denied by exact Fetch authority');
   }else if(name==='mixed-dns'||name==='cname-private'){
    await negative(()=>navigate('https://'+(name==='mixed-dns'?'mixed':'cname')+'.example/'+name));
   }else if(o.kind==='rss'){
    const multi=['two-contexts-eight-candidates','two-25MiB-slow-readers','fair-contention-completion','preallocation-backpressure'].includes(name);
    if(multi){
      await (await newContext()).newPage(progress);
      const release1=dir+'/read1.release',release2=dir+'/read2.release';
      const promises=[client({readRelease:release1}),client({port:18082,readRelease:release2,...(name==='preallocation-backpressure'?{method:'POST',bodyBytes:25*1048576}:{})})];
      await until(async()=>{await sample();return state.samples.at(-1).slots===2&&state.lastEvents.filter(e=>e.event==='response_buffered'&&e.bodyBytes===25*1048576).length>=(name==='preallocation-backpressure'?1:2)&& (name!=='preallocation-backpressure'||reviewRelease);},{timeout:15000,step:'two reserved responses, held request and buffering'});
      const start=Date.now();await delay(1500);const end=Date.now();state.holdWindow={start,end};
      reviewRelease?.();const candidates={18081:1,18082:1};
      if(name==='two-contexts-eight-candidates'||name==='preallocation-backpressure'){
       const refused=[];for(let i=0;i<7;i++)for(const port of [18081,18082]){candidates[port]++;refused.push(client({port,abort:true}));}await Promise.all(refused);
      }
      await writeFile(release1,'read');const first=await promises[0];
      await until(async()=>{const s=await sample();return s.activeResponseSlots===1;},{step:'first slot independently released'});
      await writeFile(release2,'read');const second=await promises[1];await sample();
      result={clients:[first,second],candidates};
      if(name==='fair-contention-completion')result.completions=[await client({path:'/completion'}),await client({path:'/completion',port:18082})];
    }else result=await client({...(name==='held-request-review'?{method:'POST',bodyBytes:25*1048576}:{}),abort:name==='disconnect-finally',hold:name==='disconnect-finally'?1:0,timeout:65});
   }else await negative(()=>navigate(url(name)));
   if(!deadGate)await until(async()=>{const s=await sample();return s.flows===0&&s.handlers===0&&s.reservations===0;},{timeout:65000,step:'zero retained parser flows'});
  });
  clearInterval(sampler);sampler=null;await until(()=>!sampling,{step:'sampler settlement'});if(collectionError)throw collectionError;
  const origins=await readOrigin(originLog),events=state.lastEvents;check(origins.every(r=>!r.secret),'no authorization/cookie secret at origin');
  const approvedPaths=new Set(['/control','/'+name,'/write','/completion',...(name==='controller-loss-keepalive'?['/two-25MiB-slow-readers']:[])]);verifyOriginConsumes(origins,controller.events);const unapproved=origins.filter(r=>!approvedPaths.has(r.path));
  const positiveChild=['popup-first-request','oopif-first-request'].includes(name);if(positiveChild)verifyChildBarrier(name,controller.events,events,origins);
  const denied=['mixed-dns','cname-private','dns-rebind','peer-mismatch','sni-mismatch','host-mismatch','addon-uncaught-exception','doh','gate-crash'];
  if(name==='origin-401-no-secret')check(controller.events.some(e=>e.event==='policy'&&e.status===401)&&controller.events.some(e=>e.event==='auth_cancelled'),'origin401 challenge and actual CancelAuth');
  if(name==='proxy-407')check(events.some(e=>e.event==='proxy_407')&&controller.events.some(e=>e.event==='auth_cancelled')&&origins.every(r=>r.path==='/control'),'proxy407 before tunnel, CancelAuth, no secret or upstream request');
  if(name==='controller-loss-keepalive')check(result.complete!==true&&events.some(e=>e.event==='controller_lost'),'controller loss interrupts active transfer through independent lease');
  if(name==='slow-body-deadline')check(Date.now()-caseStarted>=59000&&events.some(e=>e.event==='socket_closed'&&e.reason==='TimeoutError'||e.event==='refused'&&e.reason==='BROWSER_DEADLINE'),'actual original parser deadline');
  if(name==='held-request-review')check(state.maxima.request>=50*1048576&&result.received>0,'25MiB frozen upload held through review');
  if(name==='compressed-bomb-no-decode')check(events.some(e=>e.event==='refused'&&e.reason==='BROWSER_ENCODING'),'compressed bytes refused before decode');
  if(name==='peer-mismatch')check(events.some(e=>e.event==='peer_refused'&&e.expected==='8.8.8.8'&&e.actual==='8.8.4.4'),'actual kernel peer mismatch');
  if(denied.includes(name))check(origins.every(r=>r.path==='/control'),'negative no plaintext upstream');
  if(name==='worker-never-resumes'){const workers=controller.events.filter(e=>e.event==='child_target'&&e.type==='worker');check(workers.length>0&&workers.every(w=>w.waitingForDebugger&&!controller.events.some(e=>e.event==='resume'&&e.targetId===w.targetId))&&controller.events.some(e=>e.event==='boot_revoked'),'actual worker attached paused, never resumed, boot revoked');}
  if(name==='unauthorized-second-request')check(origins.filter(r=>r.path==='/'+name).length===1,'only authorized first request');
  let unknownOutcome=null;
  if(['fetch-detach-buffered-write','controller-loss-unknown','consumed-write-no-retry'].includes(name)){
   const {readdir}=await import('node:fs/promises');const receipts=await readdir(controller.receiptDir);const unknownFile=receipts.find(x=>x.startsWith('unknown-'));check(unknownFile,'durable unknown receipt');const unknown=JSON.parse(await readFile(controller.receiptDir+'/'+unknownFile,'utf8'));check(unknown.outcome==='unknown'&&unknown.retry===false,'durable no-retry outcome');unknownOutcome=unknown.outcome;check(!origins.some(r=>r.path==='/write'),'consumed interrupted write not sent');
  }
  const readGatePids=async()=>(await readFile(o.gateCgroup+'/cgroup.procs','utf8')).trim().split(/\s+/).filter(Boolean);
  // root-runner deliberately charges its own (root) Node supervision to the measured gate cgroup, so "empty"
  // means: no task left that runs as the gate's dedicated uid. Bounded wait for kernel task release.
  const gateUidTasks=async()=>{const out=[];for(const pid of await readGatePids()){let status;try{status=await readFile('/proc/'+pid+'/status','utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}check(status.length>0,'unreadable task identity:'+pid);const uid=Number(/\nUid:\s+(\d+)/.exec(status)?.[1]??-1);check(uid>=0,'missing survivor uid:'+pid);if(!String(o.supervisorPids).split(',').includes(pid))out.push(pid+':'+((await readFile('/proc/'+pid+'/comm','utf8').catch(()=>'?')).trim()));}return out;};
  let browserSurvivors=null;
  if(['gate-crash','fetch-detach-buffered-write','controller-loss-keepalive','controller-loss-unknown','addon-uncaught-exception','consumed-write-no-retry'].includes(name)){
   await until(async()=>{browserSurvivors=await namespaceSurvivors(o.browserNs,[process.pid]);return browserSurvivors.length===0;},{timeout:5000,step:'case='+name+' browser/controller disappearance before cleanup'});
   check(browserSurvivors.length===0,'no browser survivors');
  }
  let gatePids=await gateUidTasks();
  if(deadGate){
   const end=Date.now()+3000;while(gatePids.length&&Date.now()<end){await delay(50);gatePids=await gateUidTasks();}
   if(gatePids.length)throw Error('BROWSER_MEASUREMENT_FAILED crashed gate cgroup actually empty: '+gatePids.slice(0,8).join(','));
  }
  const stats=deadGate?{flows:gatePids.length,reservations:gatePids.length,handlers:gatePids.length,pools:{request:0,response:0,transport:0}}:await gate('stats');
  const measurement={...fixturePacketMetrics(await readFile(pcap),packetIdentity),capture:captured.capture,gateProcessCount:gatePids.length,durationMs:Date.now()-caseStarted,originRequests:origins.length,originLogSha256:sha256(JSON.stringify(origins)),eventCount:events.length,eventSha256:sha256(JSON.stringify(events)),controllerEventsSha256:sha256(JSON.stringify(controller.events)),controllerEventCount:controller.events.length,remainingFlows:stats.flows,remainingReservations:stats.reservations,unapprovedUpstreamBytes:unapproved.reduce((n,r)=>n+r.bytes,0),guardOrderingVerified:verifyOrdering(controller.events,events),...(probeCapture?{probePackets:probeCapture.packets,probeBypassPackets:probeCapture.bypassPackets,probeLinkControlPackets:probeCapture.linkControlPackets,probePcapSha256:probeCapture.pcapSha256}:{}),clientResultSha256:sha256(JSON.stringify(result)),receiptSha256:await receiptHash(controller.receiptDir),childBarrierVerified:positiveChild?true:null,faultObserved,faultProof,browserSurvivors};
  assertMeasuredCase(measurement);check(measurement.unapprovedUpstreamBytes===0&&measurement.privatePackets===0,'no unapproved plaintext or private packets');
  const peak=Number(await readFile(o.gateCgroup+'/memory.peak','utf8')),afterEvents=await readFile(o.gateCgroup+'/memory.events','utf8');check(beforeEvents===afterEvents,'unchanged cgroup memory events');check(peak<=336*1048576,'gate peak <=336MiB leaving 48MiB');
  const rss={poolMaxima:state.maxima,responseReservationBytes:state.maxima.response/state.maxSlots,unapprovedUpstreamBytes:measurement.unapprovedUpstreamBytes,backpressureBeforeAllocation:events.some(e=>e.event==='admission_refused')&&state.maxSlots===2,consumedWriteOutcome:unknownOutcome,automaticRetries:Math.max(0,origins.filter(r=>r.path==='/write').length-1),retainedCompletedBodies:stats.flows,parserPreallocationObserved:state.maxima.request>0&&state.maxima.response>0,maxResponseSlots:state.maxSlots,maxContexts:state.maxContexts,oomEvents:Number(/(?:^|\n)oom_kill (\d+)/.exec(afterEvents)?.[1]??0),oomLatch:Number(/(?:^|\n)oom_kill (\d+)/.exec(afterEvents)?.[1]??0)>0,baselineRssBytes:baseline,cgroupPeakBytes:peak,rssPeakBytes:peak,maxDirectionalQueueBytes:state.maxQueue,remainingFlows:stats.flows,remainingReservations:stats.reservations};
  if(o.kind==='rss')validateRssCase(name,{state,origins,result,stats});measurement.rss=rss;measurement.rssVerified=o.kind==='rss';
  await writeFile(dir+'/observations.json',JSON.stringify({measurement,gateEvents:events,controllerEvents:controller.events,samples:state.samples,stats,result,holdWindow:state.holdWindow,tailObserved:state.tailObserved,rss}),{mode:0o600});
  console.log(JSON.stringify({case:{name,passed:true,measurement},rss}));
 }finally{
  clearInterval(sampler);await writeFile(dir+'/last-observations.json',JSON.stringify({state,controllerEvents:controller?.events,barrierReason:runtime?.barrierReason?.()??null}),{mode:0o600});try{
   // After a deliberate gate crash (gateCrashed) revocation cannot reach the gate: the controller reports
   // BROWSER_CONTROLLER_REFUSED. That is expected there only; any other close failure still fails the case.
   const deadOk=e=>{if(!(gateCrashed&&['BROWSER_CONTROLLER_REFUSED','BROWSER_LAUNCH_REFUSED','BROWSER_CONTROLLER_BRIDGE_REFUSED'].includes(e?.message)))throw e;};
   try{await runtime?.close().catch(deadOk);}finally{await controller?.close().catch(deadOk);}}finally{try{await children.close();}finally{if(runFile)await rm(runFile,{force:true});if(publicCA)await rm(publicCA,{force:true});if(controller?.receiptDir){const {cp}=await import('node:fs/promises');await cp(controller.receiptDir,dir+'/receipts',{recursive:true});await rm(controller.receiptDir,{recursive:true,force:true});}await ca?.close();for(const secret of ['manifest.key','checkpoint.key','leaf.key','leaf.csr'])await rm(dir+'/'+secret,{force:true});await rm('/etc/sjcos-browser/runs/'+bootRunId,{recursive:true,force:true});await rm('/run/sjcos-browser/g-'+bootRunId,{recursive:true,force:true});}}
 }
}
export function verifyOriginConsumes(origins,events){
 const counts=new Map(),used=new Set();for(const e of events.filter(e=>e.event==='consume')){check(/^[a-f0-9]{64}$/.test(e.requestDigest)&&/^[a-f0-9]{64}$/.test(e.consumeId??'')&&!used.has(e.consumeId),'unique durable consume identity');used.add(e.consumeId);counts.set(e.requestDigest,(counts.get(e.requestDigest)??0)+1);}
 for(const r of origins){check((counts.get(r.requestDigest)??0)>0,'origin request lacks unique consume:'+r.requestDigest);counts.set(r.requestDigest,counts.get(r.requestDigest)-1);}
 return true;
}
export function verifyChildBarrier(name,controller,gate,origins){
 const type=name==='oopif-first-request'?'iframe':'page';
 const child=controller.find(e=>e.event==='child_target'&&e.type===type&&e.waitingForDebugger===true);
 check(child,'missing paused child '+type);
 const attached=controller.find(e=>e.event==='target_attached'&&e.targetId===child.targetId&&e.type===type);
 const guard=controller.find(e=>e.event==='guard_registered'&&e.targetId===child.targetId);
 const resume=controller.find(e=>e.event==='resume'&&e.targetId===child.targetId);
 const fetch=controller.find(e=>e.event==='fetch_paused'&&e.targetId===child.targetId&&e.url==='https://child.example/'+name);
 const write=gate.find(e=>e.event==='flow_closed'&&e.targetId===child.targetId&&e.upstreamPlaintextBytes>0);
 check(attached&&guard&&resume&&fetch&&write&&attached.seq<guard.seq&&guard.seq<resume.seq&&resume.seq<fetch.seq,'child own attach/guard/resume/Fetch/write');
 check(origins.some(r=>r.requestDigest===write.requestDigest&&r.path==='/'+name),'child own origin request');return true;
}
export function verifyOrdering(controllerEvents,gateEvents){
 const writes=gateEvents.filter(e=>e.event==='flow_closed'&&e.upstreamPlaintextBytes>0);check(writes.length>0,'real positive gate plaintext write');
 const used=new Set();
 for(const write of writes){
  check(typeof write.id==='string'&&write.id.length>0&&typeof write.targetId==='string'&&write.targetId.length>0&&/^[a-f0-9]{64}$/.test(write.requestDigest??''),'write missing flow/target/digest');
  const registered=controllerEvents.find(e=>e.event==='digest_registered'&&e.id===write.id&&e.requestDigest===write.requestDigest&&e.targetId===write.targetId);
  const consumed=registered&&controllerEvents.find(e=>e.event==='consume'&&e.id===write.id&&e.targetId===write.targetId&&e.requestDigest===write.requestDigest&&e.seq<registered.seq&&!used.has(e.consumeId)&&/^[a-f0-9]{64}$/.test(e.consumeId??'')&&e.checkpointVerified===true);
  check(registered&&consumed,'unique durable consume/checkpoint before actual upstream write');used.add(consumed.consumeId);
  const attached=controllerEvents.find(e=>e.event==='target_attached'&&e.targetId===write.targetId);
  const guard=controllerEvents.find(e=>e.event==='guard_registered'&&e.targetId===write.targetId);
  const fetch=controllerEvents.find(e=>e.event==='fetch_paused'&&e.targetId===write.targetId&&e.seq<consumed.seq);
  check(attached&&guard&&fetch&&attached.seq<guard.seq&&guard.seq<fetch.seq&&fetch.seq<registered.seq,'matching target attach/guard/Fetch/consume order');
 }
 return true;
}
export function combineRss(a,b){if(!a)return b;const out={...b};for(const k of ['baselineRssBytes','cgroupPeakBytes','rssPeakBytes','maxResponseSlots','maxContexts','maxDirectionalQueueBytes','oomEvents','remainingFlows','remainingReservations','retainedCompletedBodies','unapprovedUpstreamBytes','automaticRetries'])out[k]=Math.max(a[k]??0,b[k]??0);out.poolMaxima=Object.fromEntries(Object.keys(a.poolMaxima).map(k=>[k,Math.max(a.poolMaxima[k],b.poolMaxima[k])]));for(const k of ['parserPreallocationObserved','backpressureBeforeAllocation'])out[k]=a[k]||b[k];out.oomLatch=a.oomLatch||b.oomLatch;out.consumedWriteOutcome=[a.consumedWriteOutcome,b.consumedWriteOutcome].some(x=>x!=null&&x!=='unknown')?'invalid':a.consumedWriteOutcome??b.consumedWriteOutcome;return out;}
export function fixtureBody(size){const block=Buffer.from('<!doctype html><title>fixture</title><link rel="icon" href="data:,">'.padEnd(65536,' '));const h=createHash('sha256');for(let left=size;left>0;left-=block.length)h.update(block.subarray(0,Math.min(left,block.length)));return h.digest('hex');}
export function validatePayload(result,size,digest=fixtureBody(size)){
 check(result?.complete===true&&result.declaredBodyBytes===size&&result.bodyBytes===size&&result.bodySha256===digest,'complete response payload size/digest:'+size);
}
export function validateRssCase(name,{state,origins,result,stats}){
 check(stats.flows===0&&stats.handlers===0&&stats.reservations===0&&Object.values(stats.pools).every(x=>x===0),'settled allocations zero');
 if(['two-contexts-eight-candidates','two-25MiB-slow-readers','fair-contention-completion','preallocation-backpressure'].includes(name)){
  check(result.clients?.length>=2,'two completed clients');for(const client of result.clients.slice(0,2))validatePayload(client,25*1048576);
  const window=state.holdWindow;check(window&&window.end-window.start>=1500,'measured no-read interval >=1500ms');
  const held=state.samples.filter(x=>x.at>=window.start&&x.at<=window.end);check(held.length>=10&&held.every(x=>x.slots===2&&x.pools.response===112*1048576),'sustained exact112MiB reservations');
  const after=state.samples.filter(x=>x.at>window.end).map(x=>x.slots);const one=after.indexOf(1);check(one>=0&&after.slice(one+1).includes(0),'independent2->1->0 release');
  check(state.tailObserved===true,'outstanding TCP tail retains response reservation');
  if(['two-contexts-eight-candidates','preallocation-backpressure'].includes(name))check(result.candidates?.[18081]===8&&result.candidates?.[18082]===8,'eight candidates per context');
  if(name==='fair-contention-completion')check(result.completions?.length===2,'subsequent completion both contexts');
  for(const r of result.completions??[])validatePayload(r,256);
  if(name==='preallocation-backpressure')check(held.some(x=>x.pools.request>=50*1048576),'frozen request storage concurrent with response reservation');
 }
 if(['declared-length','unknown-length','chunked-response','held-request-review'].includes(name))validatePayload(result,name==='declared-length'?25*1048576:name==='chunked-response'?4:256,name==='chunked-response'?sha256('test'):undefined);
 if(['short-body','oversize-body','slow-body-deadline','compressed-bomb-no-decode'].includes(name))check(result.received===0,'malformed/late response sends no bytes');
 check(origins.length>=1,'real parser origin ingress');return true;
}
async function receiptHash(dir){const {readdir}=await import('node:fs/promises');const names=(await readdir(dir)).filter(n=>n.endsWith('.json')).sort();check(names.length>0,'durable receipt inventory');return sha256(Buffer.concat(await Promise.all(names.map(async n=>Buffer.concat([Buffer.from(n),await readFile(dir+'/'+n)])))));}
/** Decode the captured IP envelope, never trust a helper's packet counter.
 * any-interface tcpdump uses SLL/SLL2; raw/Ethernet supported for tests. */
export function fixturePacketMetrics(bytes,{linkControlSources=[]}={}){
 const metrics=pcapMetrics(bytes),le=['d4c3b2a1','4d3cb2a1'].includes(bytes.subarray(0,4).toString('hex')),u32=p=>le?bytes.readUInt32LE(p):bytes.readUInt32BE(p),link=u32(20);let privatePackets=0,linkControlPackets=0;
 for(let p=24;p<bytes.length;){const n=u32(p+8),packet=bytes.subarray(p+16,p+16+n);p+=16+n;const offset=link===276?20:link===113?16:link===1?14:link===101?0:-1;check(offset>=0&&packet.length>=offset+20,'pcap link envelope');const v=packet[offset]>>4;
  if(v===4){const ihl=(packet[offset]&15)*4;check(ihl>=20&&packet.length>=offset+ihl+4,'bounded IPv4 header');const src=[...packet.subarray(offset+12,offset+16)].join('.'),dst=[...packet.subarray(offset+16,offset+20)].join('.'),protocol=packet[offset+9];check((packet.readUInt16BE(offset+6)&0x3fff)===0,'no fragmented acceptance IP');const sport=packet.readUInt16BE(offset+ihl),dport=packet.readUInt16BE(offset+ihl+2);
   const dns=(protocol===6||protocol===17)&&((dst==='10.204.0.2'&&dport===53)||(src==='10.204.0.2'&&sport===53));
   const https=protocol===6&&((['8.8.8.8','8.8.4.4'].includes(dst)&&dport===443)||(['8.8.8.8','8.8.4.4'].includes(src)&&sport===443));
   if(!dns&&!https)privatePackets++;
  }else if(v===6){
   check(packet.length>=offset+40,'bounded IPv6 header');
   const payload=packet.readUInt16BE(offset+4),end=offset+40+payload;check(payload>0,'IPv6 payload length');
   // Other IPv6 remains private, including truncated captures; it never receives a control exception.
   const source=packet.subarray(offset+8,offset+24).toString('hex');
   const provenance=link===276&&packet.readUInt16BE(0)===0x86dd&&packet[10]===4&&linkControlSources.find(x=>x.index===packet.readUInt32BE(4)&&x.source===source&&x.mac===packet.subarray(12,18).toString('hex'));
   if(provenance&&end===packet.length&&validLinkControl(packet.subarray(offset,end),provenance.mac)&&++linkControlPackets<=64){}else privatePackets++;

  }else throw Error('BROWSER_CAPTURE_IP_VERSION');
 }
 return {...metrics,privatePackets,linkControlPackets};
}

export function validLinkControl(ip,mac){
 if(ip.length<48||ip[0]>>>4!==6||ip.readUInt16BE(4)!==ip.length-40)return false;
 if(ip[8]!==0xfe||(ip[9]&0xc0)!==0x80||!(ip[24]===0xff&&ip[25]===2||ip[24]===0xfe&&(ip[25]&0xc0)===0x80))return false;
 let nh=ip[6],at=40,routerAlert=false;
 // Only the canonical MLD Hop-by-Hop Router Alert (value 0), PadN 0 is permitted.
 if(nh===0){if(ip.length<48||!ip.subarray(40,48).equals(Buffer.from([58,0,5,2,0,0,1,0])))return false;nh=58;at=48;routerAlert=true;}
 if(nh!==58||at+8>ip.length||ip[at+1]!==0)return false;
 const icmp=ip.subarray(at),type=icmp[0],ndp=[133,134,135,136,137].includes(type);
 if(ip[7]!== (ndp?255:1)||ndp&&routerAlert||!ndp&&!routerAlert)return false;
 // Verify the full ICMPv6 pseudoheader checksum, never a type-byte exemption.
 const pseudo=Buffer.alloc(8);pseudo.writeUInt32BE(icmp.length);pseudo[7]=58;
 const bytes=Buffer.concat([ip.subarray(8,40),pseudo,icmp]);let sum=0;for(let i=0;i<bytes.length;i+=2)sum+=(bytes[i]<<8)+(bytes[i+1]??0);while(sum>>>16)sum=(sum&65535)+(sum>>>16);if(sum!==65535)return false;
 if(ndp){
  const base={133:8,134:16,135:24,136:24,137:40}[type];if(icmp.length<base)return false;
  if([133,135].includes(type)&&icmp.readUInt32BE(4)!==0)return false;
  if([135,136].includes(type)&&(icmp[8]===0xff||icmp.subarray(8,24).every(x=>x===0)))return false;
  // Only a single link-layer address option matching the attributed interface. No arbitrary payload/options.
  if(icmp.length===base)return true;
  return icmp.length===base+8&&[1,2].includes(icmp[base])&&icmp[base+1]===1&&icmp.subarray(base+2).toString('hex')===mac;
 }
 if([130,131,132].includes(type))return icmp.length===24&&icmp.readUInt16BE(6)===0;
 if(type!==143||icmp.readUInt16BE(4)!==0)return false;
 const count=icmp.readUInt16BE(6);if(!count||count>8||icmp.length!==8+20*count)return false;
 for(let p=8;p<icmp.length;p+=20)if(![1,2,3,4,5,6].includes(icmp[p])||icmp[p+1]!==0||icmp.readUInt16BE(p+2)!==0||icmp[p+4]!==0xff||icmp[p+5]!==2)return false;
 return true;
}

function ipv6Hex(address){const [a,b]=address.split('::');const left=a?a.split(':'):[],right=b?b.split(':'):[];return [...left,...Array(8-left.length-right.length).fill('0'),...right].map(x=>x.padStart(4,'0')).join('');}

export async function namespaceSurvivors(namespace,allowed=[],list,read=readFile){
 if(!list)list=async()=>{const inode=(await stat('/run/netns/'+namespace)).ino,pids=[];for(const pid of await readdir('/proc'))if(/^\d+$/.test(pid)){try{if(await readlink('/proc/'+pid+'/ns/net')==='net:['+inode+']')pids.push(pid);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw e;}}return pids.join('\n');};
 const pids=(await list()).trim().split(/\s+/).filter(Boolean);
 const out=[];for(const pid of pids){if(allowed.includes(Number(pid)))continue;try{await read('/proc/'+pid+'/status','utf8');out.push(Number(pid));}catch(e){if(e.code!=='ENOENT')throw Error('BROWSER_MEASUREMENT_FAILED unreadable survivor identity pid='+pid);}}
 return out;
}

export async function verifyCaseArtifacts(dir,cases){
 for(const c of cases){const base=dir+'/'+c.name,m=c.measurement;
  check(sha256(await readFile(base+'/ingress.pcap.stderr'))===m.capture.stderrSha256,'case='+c.name+' capture stderr artifact mismatch');
  const pcap=pcapMetrics(await readFile(base+'/ingress.pcap'));check(pcap.pcapSha256===m.pcapSha256&&pcap.packets===m.capture.capturedPackets,'case='+c.name+' packet artifact/count mismatch');
  const obs=JSON.parse(await readFile(base+'/observations.json','utf8')),origins=await readOrigin(base+'/origin.jsonl');
  for(const [value,key] of [[obs.gateEvents,'eventSha256'],[obs.controllerEvents,'controllerEventsSha256'],[obs.result,'clientResultSha256'],[origins,'originLogSha256']])check(sha256(JSON.stringify(value))===m[key],'case='+c.name+' artifact hash mismatch:'+key);
  check(JSON.stringify(obs.measurement.faultProof)===JSON.stringify(m.faultProof)&&obs.measurement.faultObserved===m.faultObserved,'case='+c.name+' fault artifact mismatch');
  check(obs.controllerEvents.length===m.controllerEventCount&&obs.gateEvents.length===m.eventCount&&origins.length===m.originRequests,'case='+c.name+' artifact event/origin counts');
  check(JSON.stringify(obs.rss)===JSON.stringify(m.rss),'case='+c.name+' RSS artifact mismatch');
  if(m.rssVerified)validateRssCase(c.name,{state:{maxSlots:obs.rss.maxResponseSlots,samples:obs.samples,holdWindow:obs.holdWindow,tailObserved:obs.tailObserved},origins,result:obs.result,stats:obs.stats});
  for(const e of obs.controllerEvents.filter(x=>x.event==='consume'))verifyConsumeRecord(e,JSON.parse(await readFile(base+'/receipts/consume-'+e.consumeId+'.json','utf8')),JSON.parse(await readFile(base+'/receipts/checkpoint-'+e.consumeId+'.json','utf8')),await readFile(base+'/checkpoint.pub','utf8'),JSON.parse(await readFile(base+'/receipts/sink/sink-'+e.consumeId+'.json','utf8')));
  check(await receiptHash(base+'/receipts')===m.receiptSha256,'case='+c.name+' durable receipt artifact mismatch');
  check(verifyOrdering(obs.controllerEvents,obs.gateEvents),'case='+c.name+' artifact ordering');verifyOriginConsumes(origins,obs.controllerEvents);
  m.artifactHashesVerified=true;
 }
}

export function verifyConsumeRecord(event,consume,checkpoint,publicKey,sink){
 check(consume.transportRequestDigest===event.requestDigest&&checkpoint.id===event.consumeId&&checkpoint.digest===sha256(canonical(consume)),'exact transport digest/durable consume checkpoint');
 const expected={id:checkpoint.id,digest:checkpoint.digest,runId:consume.runId,bootId:consume.bootId,kind:consume.kind};
 check(canonical(verifySigned(checkpoint.ack.envelope,publicKey))===canonical({purpose:'browser-controller-checkpoint',...expected})&&canonical(sink)===canonical(expected),'verified signed checkpoint and independent durable sink');return true;
}
