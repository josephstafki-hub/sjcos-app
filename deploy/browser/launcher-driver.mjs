#!/usr/bin/node
/** N interface: called by network-driver INSIDE disposable browser netns. No
 * simulated evidence: the reviewed controller supplies real packet case runner. */
import {readlink} from 'node:fs/promises';
import {launchBrowser} from '../../lib/browser/launcher.mjs';
import {loadBootstrap} from '../../lib/browser/protected-bootstrap.mjs';
let runtime;
try{
 const a=process.argv.slice(2);
 if(a.length!==10||a[0]!=='--kind'||a[1]!=='network'||a[2]!=='--run-id'||a[4]!=='--browser-ns'||a[6]!=='--gate-ns'||a[8]!=='--fixture-ns'||! /^[a-f0-9-]{36}$/.test(a[3]))throw Error();
 const tag=/^b0b-([a-f0-9]{8})-b$/.exec(a[5])?.[1];if(!tag||a[7]!==`b0b-${tag}-g`||a[9]!==`b0b-${tag}-f`)throw Error();
 const {config,adapter}=await loadBootstrap();
 if(typeof adapter.prepareAcceptance!=='function'||typeof adapter.runNetworkCases!=='function')throw Error();
 const context=await adapter.prepareAcceptance({runId:a[3],config});
 const namespace={name:a[5],current:await readlink('/proc/self/ns/net'),host:await readlink('/proc/1/ns/net')};
 runtime=await launchBrowser({...context,namespace});
 const result=await adapter.runNetworkCases({runtime,runId:a[3],namespaces:{browser:a[5],gate:a[7],fixture:a[9]}});
 const required=['host-cdp','listener-cross-context','listener-reuse','popup-first-request','oopif-first-request','worker-never-resumes','controller-loss-keepalive','fetch-detach-buffered-write','gate-crash','addon-uncaught-exception','unauthorized-second-request','origin-401-no-secret','proxy-407','request-hook-order','doh','mixed-dns','cname-private','dns-rebind','peer-mismatch','sni-mismatch','host-mismatch'];
 if(result.runId!==a[3]||result.kind!=='network'||result.realRuntime!==true||result.simulated!==false||result.guardOrderingVerified!==true||result.cases?.length!==required.length||required.some(n=>result.cases.filter(x=>x.name===n&&x.passed===true&&x.measurement&&Object.keys(x.measurement).length).length!==1))throw Error();
 const json=JSON.stringify(result);if(Buffer.byteLength(json)>1024*1024)throw Error();
 await runtime.close();runtime=null;process.stdout.write(json+'\n');
}catch{process.stderr.write('BROWSER_ACCEPTANCE_LAUNCH_REFUSED\n');process.exitCode=1;}
finally{await runtime?.close();}
