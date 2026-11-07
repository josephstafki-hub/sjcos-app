/** Per-call broker claim authority. peer is supplied ONLY by a kernel SO_PEERCRED
 * relay, never JSON. Re-read live PID/start/cgroup/executable on every call. */
import {readFile,open,constants,lstat} from 'node:fs/promises';
import {sha256} from './runtime-readiness.mjs';
import {trustedPath} from './protected-bootstrap.mjs';
import {uuid,hex} from './controller-authority.mjs';
import {PROFILE_TOOLS} from '../../mcp/browser-profile-tools.mjs';
import {validateInput,TOOL_NAMES} from './contracts.mjs';
const fail=()=>{throw Error('BROWSER_FORBIDDEN');};
async function rootJson(file){await trustedPath(file);const s=await lstat(file);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||!s.isFile()||s.size>32768)fail();const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{return JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}}
export async function readBrokerClaim(runId,kind='browser'){if(!uuid(runId)||!['browser','sjcos','interact'].includes(kind))fail();return {record:await rootJson('/run/sjcos-browser/registry/'+runId+'.json'),claim:await rootJson('/run/sjcos-browser/registry/'+runId+'.'+kind+'.claimed')};}
export async function readProcess(pid){if(!Number.isSafeInteger(pid)||pid<2)fail();const stat=await readFile(`/proc/${pid}/stat`,'utf8'),tail=stat.slice(stat.lastIndexOf(')')+2).split(' ');return {pid,startTime:tail[19],cgroup:await readFile(`/proc/${pid}/cgroup`,'utf8'),uid:(await lstat(`/proc/${pid}`)).uid,executableDigest:sha256(await readFile(`/proc/${pid}/exe`)),argv:(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0')};}
export function createMcpAuthority({readClaim=readBrokerClaim,readPeer=readProcess,bootId,resolveTask}){
  const authorize=async(request,peer)=>{
    const {run,name,input}=request,kind=request.kind??'browser';const profileSchema=PROFILE_TOOLS[kind]?.[name];if(!run||!uuid(run.runId)||!uuid(run.taskId)||run.profile!=='browser'||!(kind==='browser'?TOOL_NAMES.includes(name):profileSchema)||!peer||!Number.isSafeInteger(peer.pid))fail();
    if((kind==='browser'?validateInput(name,input).task_id!==run.taskId:!profileSchema.input.safeParse(input).success)||typeof run.capability!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(run.capability))fail();
    const {record,claim}=await readClaim(run.runId,kind);
    if(record.runId!==run.runId||record.taskId!==run.taskId||record.principalId!==run.principalId||record.bootId!==bootId||claim.bootId!==bootId||claim.runId!==run.runId||claim.kind!==kind||claim.pid!==peer.pid||record.uid!==peer.uid||!hex(claim.capabilitySha256)||sha256(run.capability)!==claim.capabilitySha256)fail();
    const [actual,cli]=await Promise.all([readPeer(peer.pid),readPeer(record.pid)]);
    if(actual.pid!==peer.pid||actual.uid!==peer.uid||String(actual.startTime)!==String(claim.startTime)||actual.cgroup!==record.cgroup||actual.executableDigest!==record.nodeDigest||cli.cgroup!==record.cgroup||String(cli.startTime)!==String(record.startTime))fail();
    const script=actual.argv[1];if(typeof script!=='string'||!script.startsWith('/')||sha256(await readFile(script))!==record.executables[kind])fail();
    // Snapshot recheck catches PID reuse or process migration during file reads.
    const again=await readPeer(peer.pid);if(String(again.startTime)!==String(actual.startTime)||again.cgroup!==actual.cgroup||again.executableDigest!==actual.executableDigest)fail();
    const task=await resolveTask(run.taskId);if(!task||task.runId!==run.runId||task.principalId!==run.principalId||task.revoked===true)fail();return task;
  };
  return async(request,peer)=>{
    try{
      if(!['mcp_authorize','mcp_invoke','mcp_observation_context','profile_invoke'].includes(request.op))fail();
      // Observation context uses its own narrow status check; no unvalidated
      // caller context or capability can choose an adapter/document epoch.
      const call=request.op==='mcp_observation_context'?{...request,name:'browser_status',input:{task_id:request.run?.taskId}}:request;
      const task=await authorize(call,peer);
      if(request.op==='mcp_authorize')return {ok:true,allowed:true};
      if(request.op==='mcp_observation_context')return {ok:true,context:await task.observationContext()};
      // The task handler rechecks its control/document epoch at the action's
      // own commit point. Authorization is repeated for EVERY invoke.
      if(request.op==='profile_invoke'){const kind=request.kind,schema=PROFILE_TOOLS[kind]?.[request.name];if(!schema||typeof task.profileInvoke!=='function')fail();const input=schema.input.parse(request.input);if(request.name==='get_project'&&input.project_id!==task.projectId||request.name==='get_lead'&&input.slug!==task.leadSlug||request.name==='get_work_item'&&input.id!==task.workItemId)fail();const result=schema.output.parse(await task.profileInvoke(kind,request.name,input));await authorize(call,peer);return {ok:true,result};}
      if(typeof task.invoke!=='function')fail();return {ok:true,result:await task.invoke(request.name,request.input)};
    }catch{return {ok:false,allowed:false};}
  };
}

/** Node has no public SO_PEERCRED API. A fixed isolated stdlib relay obtains the
 * kernel identity before passing bounded requests over private stdio. */
const RELAY=String.raw`
import os,socket,struct,json,sys,signal
p=sys.argv[1];uid=int(sys.argv[2])
if os.geteuid()!=0 or p!='/run/sjcos-browser/mcp-controller.sock':raise SystemExit(1)
s=socket.socket(socket.AF_UNIX);s.bind(p);os.chmod(p,0o660);os.chown(p,0,int(sys.argv[3]));s.listen(2)
def stop(*args):raise SystemExit(0)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
print(json.dumps({'ready':True}),flush=True)
def exact(c,n):
 b=bytearray(n);i=0
 while i<n:
  got=c.recv_into(memoryview(b)[i:],n-i)
  if not got:raise ValueError()
  i+=got
 return b
try:
 while True:
  c,_=s.accept()
  try:
   c.settimeout(2);pid,peer_uid,gid=struct.unpack('3i',c.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
   if peer_uid!=uid:raise ValueError()
   n,=struct.unpack('!I',exact(c,4))
   if not 0<n<=32768:raise ValueError()
   request=json.loads(exact(c,n))
   print(json.dumps({'peer':{'pid':pid,'uid':peer_uid,'gid':gid},'request':request},separators=(',',':')),flush=True)
   reply=sys.stdin.buffer.readline(32770)
   if not reply or len(reply)>32768:raise ValueError()
   c.sendall(struct.pack('!I',len(reply))+reply)
  except (ValueError,OSError,KeyError):pass
  finally:c.close()
finally:
 s.close();os.unlink(p)
`;
export async function serveMcpAuthority({uid,gid,handle,spawnProcess}){
  if(process.getuid()!==0||!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0)fail();
  const {spawn}=await import('node:child_process');
  const child=(spawnProcess??spawn)('/usr/bin/python3',['-I','-B','-c',RELAY,'/run/sjcos-browser/mcp-controller.sock',String(uid),String(gid)],{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
  let text='',ready=false,stopped=false;
  const exited=new Promise(resolve=>child.once('exit',()=>{stopped=true;resolve();}));child.stderr.on('data',()=>{});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('BROWSER_MCP_AUTHORITY_REFUSED'));},2000);child.once('error',()=>{clearTimeout(timer);reject(Error('BROWSER_MCP_AUTHORITY_REFUSED'));});exited.then(()=>{clearTimeout(timer);if(!ready)reject(Error('BROWSER_MCP_AUTHORITY_REFUSED'));});child.stdout.on('data',chunk=>{text+=chunk.toString();if(Buffer.byteLength(text)>65536){child.kill('SIGKILL');return;}let newline;while((newline=text.indexOf('\n'))>=0){const line=text.slice(0,newline);text=text.slice(newline+1);try{const message=JSON.parse(line);if(!ready){if(message.ready!==true)throw Error();ready=true;clearTimeout(timer);resolve();}else{void Promise.resolve(handle(message.request,message.peer)).then(result=>{const bytes=JSON.stringify(result);if(Buffer.byteLength(bytes)>32767)throw Error();child.stdin.write(bytes+'\n');}).catch(()=>child.stdin.write('{"ok":false}\n'));}}catch{child.kill('SIGKILL');}}});});
  return {close:async()=>{if(!stopped)child.kill('SIGTERM');let timer;try{await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);})]);await exited;}finally{clearTimeout(timer);}}};
}
