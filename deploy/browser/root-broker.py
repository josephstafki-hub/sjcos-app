#!/usr/bin/python3
"""Root fixed runner/registry broker. No launch path, argv, SQL or CDP input.
SO_PEERCRED uid gates owner spawn versus controller read-only claim operations.
Registry and one-use claims remain root0600; restart burns old held runners.
"""
import os, sys, json, socket, struct, subprocess, time, signal, re, datetime
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from launch_broker import protected_json, register as register_mcp
from peercred import proc_record, peer_proof, digest
NODE='/usr/bin/node'
RUNNER='/opt/sjcos-browser/node/source/scripts/run-browser-agent.mjs'
SOCKET='/run/sjcos-browser/broker.sock'
REGISTRY='/run/sjcos-browser/registry'
UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
def refuse(): raise ValueError('BROWSER_BROKER_REFUSED')
def expiry(value):
 if not isinstance(value,str) or not value.endswith('Z'):refuse()
 result=datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
 if result<=time.time():refuse()
 return result
def atomic_new(file,record):
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try: os.write(fd,json.dumps(record).encode());os.fsync(fd)
 finally: os.close(fd)
 fd=os.open(os.path.dirname(file),os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
def process(pid):
 r=proc_record(pid);r.update(uid=os.stat(f'/proc/{pid}').st_uid,cgroup=open(f'/proc/{pid}/cgroup').read(),nodeDigest=digest(f'/proc/{pid}/exe'))
 if proc_record(pid)['startTime']!=r['startTime']:refuse()
 return r
def child_exited(child):return os.waitid(os.P_PID,child.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT) is not None
def spawn_fixed(run,config):
 # Verify immutable dedicated bytes at every spawn. No caller env/arguments.
 if digest(NODE)!=config['nodeDigest'] or digest(RUNNER)!=config['runnerDigest']:refuse()
 r,w=os.pipe()
 def setup():
  os.dup2(r,3)
  if r!=3:os.close(r)
 child=subprocess.Popen([NODE,RUNNER,'--run',run],cwd='/var/empty',env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','SJC_BROWSER_HELD':'1'},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,pass_fds=tuple(set((r,3))),preexec_fn=setup,user=config['runnerUid'],group=config['runnerGid'],extra_groups=(),start_new_session=True)
 os.close(r)
 return child,w
class Broker:
 def __init__(self,config,boot,registry=REGISTRY,spawn=spawn_fixed,inspect=process,owner_uid=0,exited=child_exited):
  self.config=config;self.boot=boot;self.registry=registry;self.spawn=spawn;self.inspect=inspect;self.owner_uid=owner_uid;self.held={};self.exited=exited
 def expire(self):
  for run,h in list(self.held.items()):
   if self.exited(h['child']) or time.monotonic()>h['deadline']:
    self.cancel(run)
 def cancel(self,run):
  h=self.held.pop(run,None)
  if h:
   try:os.close(h['fd'])
   except OSError:pass
   try:os.killpg(h['child'].pid,signal.SIGKILL)
   except ProcessLookupError:pass
   h['child'].wait(timeout=2)
  # Keep records but make revoked state authoritative across restarts.
  if os.path.exists(self.path(run)) and not os.path.exists(self.path(run)+'.revoked'):atomic_new(self.path(run)+'.revoked',{'revoked':True})
 def path(self,run):return os.path.join(self.registry,run+'.json')
 def record(self,run):
  if os.path.exists(self.path(run)+'.revoked'):refuse()
  r=protected_json(self.path(run),self.owner_uid)
  if r['bootId']!=self.boot:refuse()
  actual=self.inspect(r['pid'])
  if any(actual[k]!=r[k] for k in ('startTime','cgroup','uid','nodeDigest')):refuse()
  return r
 def dispatch(self,q,peer):
  self.expire();op=q.get('op');run=q.get('runId')
  if not isinstance(run,str) or not UUID.fullmatch(run):refuse()
  expected={'spawnHeld':{'taskId','principalId'},'register':{'pid'},'bindCapability':{'pid','capability_hash','expires_at'},'release':set(),'cancel':set(),'readClaim':{'kind'},'registration':{'kind'}}
  if op not in expected or set(q)!={'op','runId'}|expected[op]:refuse()
  if peer['uid']!=(self.config['controllerUid'] if op in ('readClaim','registration') else self.config['websiteUid']):refuse()
  if op=='spawnHeld':
   if len(self.held)>=2 or run in self.held or os.path.exists(self.path(run)) or not all(UUID.fullmatch(q[k] or '') for k in ('taskId','principalId')):refuse()
   child,fd=self.spawn(run,self.config);a=self.inspect(child.pid)
   self.held[run]={'child':child,'fd':fd,'deadline':time.monotonic()+20,'owner':(peer['pid'],peer.get('startTime')),'actual':a,'bound':False}
   if a['uid']!=self.config['runnerUid'] or a['nodeDigest']!=self.config['nodeDigest'] or not a['cgroup'].strip().endswith(self.config['cgroup']):self.cancel(run);refuse()
   record={'runId':run,'taskId':q['taskId'],'principalId':q['principalId'],'bootId':self.boot,**{k:a[k] for k in ('pid','startTime','uid','cgroup','nodeDigest')},'executables':self.config['executables'],'credentialFiles':self.config['credentialFiles']}
   atomic_new(self.path(run),record);return {'pid':child.pid}
  if op in ('readClaim','registration'):
   if peer['uid']!=self.config['controllerUid'] or q['kind'] not in ('browser','sjcos','interact'):refuse()
   r=self.record(run);claim=protected_json(os.path.join(self.registry,run+'.'+q['kind']+'.claimed'),self.owner_uid)
   # Never disclose credential file paths/DSNs, only proof fields and claim hash.
   return {'record':{k:v for k,v in r.items() if k!='credentialFiles'},'claim':claim}
  h=self.held.get(run)
  if not h or h['owner']!=(peer['pid'],peer.get('startTime')):refuse()
  if op=='cancel':self.cancel(run);return {'ok':True}
  if h.get('released'):refuse()
  r=self.record(run)
  if op in ('register','bindCapability') and q['pid']!=r['pid']:refuse()
  if op=='register':return {'pid':r['pid'],'start_ticks':str(r['startTime']),'cgroup':r['cgroup'],'boot_id':self.boot}
  if op=='bindCapability':
   if h['bound'] or not re.fullmatch(r'[a-f0-9]{64}',q['capability_hash'] or ''):refuse()
   h['capabilityExpires']=expiry(q['expires_at'])
   atomic_new(self.path(run)+'.capability',{'capabilitySha256':q['capability_hash'],'expires_at':q['expires_at']});h['bound']=True;return {'ok':True}
  if not h['bound'] or h['capabilityExpires']<=time.time():refuse()
  os.write(h['fd'],b'1');os.close(h['fd']);h['fd']=-1;h['deadline']=float('inf');h['released']=True;return {'ok':True}
def serve(config):
 if os.geteuid()!=0:refuse()
 boot=open('/proc/sys/kernel/random/boot_id').read().strip();os.makedirs(REGISTRY,mode=0o700,exist_ok=True)
 import pwd
 runner=pwd.getpwnam('sjcos-browser-runner');controller=pwd.getpwnam('sjcos-browser-controller')
 if config['runnerUid']!=runner.pw_uid or config['runnerGid']!=runner.pw_gid or config['controllerUid']!=controller.pw_uid or len({0,998,runner.pw_uid,controller.pw_uid,config['websiteUid']})!=5:refuse()
 b=Broker(config,boot);listeners=[]
 import selectors
 sel=selectors.DefaultSelector()
 for path,gid in ((SOCKET,config['webGid']),('/run/sjcos-browser/broker-authority.sock',controller.pw_gid),('/run/sjcos-browser/launch.sock',runner.pw_gid)):
  s=socket.socket(socket.AF_UNIX);s.bind(path);os.chmod(path,0o660);os.chown(path,0,gid);s.listen(4);s.setblocking(False);sel.register(s,selectors.EVENT_READ);listeners.append(s)
 def stop(*_):raise KeyboardInterrupt()
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 try:
  while True:
   b.expire()
   for key,_ in sel.select(.5):
    c,_=key.fileobj.accept()
    with c:
     try:
      c.settimeout(2);pid,uid,_=struct.unpack('3i',c.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));data=b''
      while not data.endswith(b'\n'):
       x=c.recv(2049-len(data))
       if not x or len(data)+len(x)>2048:refuse()
       data+=x
      q=json.loads(data)
      if key.fileobj.getsockname().endswith('/launch.sock'):
       r=protected_json(b.path(q.get('runId','')),0) if UUID.fullmatch(q.get('runId','')) else refuse()
       if os.path.exists(b.path(q['runId'])+'.revoked') or not os.path.exists(b.path(q['runId'])+'.capability'):refuse()
       expiry(protected_json(b.path(q['runId'])+'.capability')['expires_at'])
       result=register_mcp(q,peer_proof(c),REGISTRY,boot)
      else:result=b.dispatch(q,{'pid':pid,'uid':uid,'startTime':proc_record(pid)['startTime']})
      c.sendall(json.dumps(result).encode()+b'\n')
     except Exception:
      try:c.sendall(b'{"error":"BROWSER_BROKER_REFUSED"}\n')
      except OSError:pass
 finally:
  for run in list(b.held):b.cancel(run)
  for s in listeners:path=s.getsockname();s.close();os.unlink(path)
if __name__=='__main__':serve(protected_json('/etc/sjcos-browser/root-broker.json'))
