/** Coordinator fixture result contract. A scenario is evidence only when the
 * external pinned parser/packet driver supplies measurements for THIS nonce.
 * Pure ledger or simulated counters cannot claim runtime acceptance. */
export const RSS_CASES=Object.freeze(['two-contexts-eight-candidates','two-25MiB-slow-readers','held-request-review','fair-contention-completion','declared-length','unknown-length','chunked-response','short-body','oversize-body','slow-body-deadline','compressed-bomb-no-decode','preallocation-backpressure','disconnect-finally','controller-loss-unknown','consumed-write-no-retry']);
export const NETWORK_CASES=Object.freeze(['direct-ipv4','direct-ipv6','direct-udp','quic','direct-dns','doh','host-cdp','host-app','private-ip','mixed-dns','cname-private','dns-rebind','peer-mismatch','sni-mismatch','host-mismatch','listener-cross-context','listener-reuse','popup-first-request','oopif-first-request','worker-never-resumes','controller-loss-keepalive','fetch-detach-buffered-write','gate-crash','addon-uncaught-exception','unauthorized-second-request','origin-401-no-secret','proxy-407','request-hook-order']);
export function validateEvidence(e,{runId,kind}={}) {
  const required=kind==='rss'?RSS_CASES:NETWORK_CASES;
  if(!['rss','network'].includes(kind)||!e||e.runId!==runId||e.kind!==kind||e.realRuntime!==true||e.simulated!==false||!/^[a-f0-9]{64}$/.test(e.runtimeLockSha256??'')||!Array.isArray(e.cases)||e.cases.length!==required.length||required.some(name=>e.cases.filter(x=>x.name===name&&x.passed===true).length!==1))throw Error('BROWSER_ACCEPTANCE_INCOMPLETE');
  // A pass bit or an empty helper counter is never packet/parser evidence.
  function measurement(value,depth=0){
    if(depth>8)return false;
    if(typeof value==='number')return Number.isFinite(value)&&value>=0;
    if(typeof value==='string')return value.length<=32768;
    if(typeof value==='boolean'||value===null)return true;
    if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;
    const keys=Object.keys(value);return keys.length>0&&keys.length<=128&&keys.every(k=>measurement(value[k],depth+1));
  }
  if(e.cases.some(c=>!c.measurement||typeof c.measurement!=='object'||!measurement(c.measurement)))throw Error('BROWSER_MEASUREMENT_MISSING');
  if(kind==='rss') {
    if(!e.poolMaxima||Object.entries({request:56,response:112,transport:24}).some(([pool,cap])=>!Number.isFinite(e.poolMaxima[pool])||e.poolMaxima[pool]<=0||e.poolMaxima[pool]>cap*1048576)||e.responseReservationBytes!==56*1048576||e.unapprovedUpstreamBytes!==0||e.backpressureBeforeAllocation!==true||e.consumedWriteOutcome!=='unknown'||e.automaticRetries!==0||e.retainedCompletedBodies!==0)throw Error('BROWSER_RSS_ACCEPTANCE_FAILED');
    if(e.parserPreallocationObserved!==true||e.maxResponseSlots!==2||e.maxContexts!==2||e.oomEvents!==0||e.oomLatch!==false||!Number.isFinite(e.baselineRssBytes)||e.baselineRssBytes<=0||e.baselineRssBytes>144*1048576||!Number.isFinite(e.cgroupPeakBytes)||e.cgroupPeakBytes<=0||e.cgroupPeakBytes>336*1048576||!Number.isFinite(e.rssPeakBytes)||e.rssPeakBytes<=0||e.rssPeakBytes>336*1048576||e.maxDirectionalQueueBytes<0||e.maxDirectionalQueueBytes>65536||!Number.isFinite(e.maxDirectionalQueueBytes)||e.remainingFlows!==0||e.remainingReservations!==0)throw Error('BROWSER_RSS_ACCEPTANCE_FAILED');
  }else if(e.unapprovedUpstreamBytes!==0||e.privatePackets!==0||e.captureIngressVerified!==true||e.guardOrderingVerified!==true)throw Error('BROWSER_NETWORK_ACCEPTANCE_FAILED');
  return {ok:true,releaseReady:false}; // Evidence still needs independent review/signature.
}

export function coordinatorSequence(options){
  // Validate all input before interpolating any path into a shell command.
  const network=coordinatorCommand('network',options),rss=coordinatorCommand('rss',options);
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  const root=options.root;
  return [
    `sudo /bin/bash ${quote(root+'/deploy/browser/unprovision-acceptance.sh')}`,
    `sudo /bin/bash ${quote(root+'/deploy/browser/provision-acceptance.sh')}`,
    `sudo /usr/bin/node ${quote(root+'/scripts/browser-runtime-check.mjs')} --installation-only`,
    network,rss,
    `sudo /bin/bash ${quote(root+'/deploy/browser/unprovision-acceptance.sh')}`,
  ];
}

/** Reviewable coordinator commands, side-effect free and shell-quoted. */
export function coordinatorCommand(kind,{root,uid,tag}={}) {
  if(!['network','rss'].includes(kind)||!/^\d+$/.test(String(uid))||!Number.isSafeInteger(Number(uid))||Number(uid)<1||!/^[a-zA-Z0-9_-]{1,40}$/.test(tag??'')||typeof root!=='string'||!root.startsWith('/')||/[\x00-\x1f\x7f]/.test(root))throw Error('BROWSER_FIXTURE_PLAN_INPUT');
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  const limits=kind==='network'?'MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes':'MemoryMax=3G -p MemorySwapMax=0 -p CPUQuota=150% -p TasksMax=256 -p Delegate=yes';
  return `sudo systemd-run --scope --unit=browser-0b-${kind}-${tag} --slice=user-${uid}-sjcosbrowser.slice -p ${limits} /usr/bin/node ${quote(root+'/scripts/browser-'+(kind==='network'?'containment':'rss')+'-check.mjs')} --run --disposable-only --driver /opt/sjcos-browser/fixtures/${kind}-driver --output /tmp/browser-0b-${kind}-${tag}.json`;
}
