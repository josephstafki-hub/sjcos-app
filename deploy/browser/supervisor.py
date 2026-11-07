#!/usr/bin/python3
"""Production admission state machine. stdlib only; never launches Chromium.
The privileged integration supplies checked registrations from the SQL bridge,
not a person/priority asserted by a socket client. State is root-only, atomic
and fsynced; a missing state or uncleared running marker is a persistent latch.
"""
import json, os, time, uuid, pathlib, fcntl, socket, struct
G = 1024**3
class BrowserError(Exception): pass
def deny(code): raise BrowserError(code)
def identity(value):
    try:
        if str(uuid.UUID(value)) != value: raise ValueError()
    except (ValueError,TypeError,AttributeError): deny('BROWSER_BAD_INPUT')
    return value
class Supervisor:
    def __init__(self, file, metrics, clock=time.time, recover_running=True):
        self.file=pathlib.Path(file); self.clock=clock; self.metrics=metrics(); self.read_metrics=metrics; self.high_since=None
        try:
            raw=self.file.read_bytes()
            if len(raw)>65536: raise ValueError()
            self.state=json.loads(raw)
            if set(self.state)-{'oom_kill_count'}!={'v','generation','latched','running','slots','queue','dedupe','suspended'} or self.state['v']!=1 or not isinstance(self.state['generation'],int) or self.state['generation']<0 or len(self.state['slots'])>2 or len(self.state['queue'])>8: raise ValueError()
            if recover_running and self.state['running']: self.state['latched']=True
        except (OSError,ValueError,TypeError,KeyError):
            self.state=dict(v=1,generation=0,latched=True,running=False,slots=[],queue=[],dedupe={},suspended=True)
    def persist(self):
        tmp=self.file.with_suffix('.new')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            with os.fdopen(fd,'w') as f:
                json.dump(self.state,f,separators=(',',':')); f.flush(); os.fsync(f.fileno())
            os.replace(tmp,self.file)
            d=os.open(self.file.parent,os.O_DIRECTORY); os.fsync(d); os.close(d)
        finally:
            try:tmp.unlink()
            except FileNotFoundError:pass
    def headroom(self):
        if self.state['latched']: deny('BROWSER_LATCHED')
        m=self.metrics
        if self.state['suspended'] or m.get('accounted') is not True or any(type(m.get(k)) is not int or m[k]<0 for k in ('available_bytes','account_bytes','browser_bytes')) or m['available_bytes']<5*G or m['account_bytes']>18*G: deny('BROWSER_RESOURCE_LIMIT')
    def expire(self):
        n=self.clock()
        self.state['slots']=[x for x in self.state['slots'] if x['active'] or x['expires_at']>n]
        self.state['queue']=[x for x in self.state['queue'] if x['expires_at']>n]
        self.state['dedupe']={k:v for k,v in self.state['dedupe'].items() if v['expires_at']>n}
    def reserve(self,task,key,generation):
        if not isinstance(task,dict) or set(task)!={'task_id','person_id','present'} or type(task['present']) is not bool:deny('BROWSER_BAD_INPUT')
        identity(task['task_id']); identity(task['person_id']); identity(key)
        self.expire(); self.headroom()
        if generation!=self.state['generation']:deny('BROWSER_REVOKED')
        prior=self.state['dedupe'].get(key)
        if prior:
            if prior['task_id']!=task['task_id']:deny('BROWSER_IDEMPOTENCY_CONFLICT')
            return prior['response']
        if task.get('present') is not True:deny('BROWSER_ATTENDED_ONLY')
        if any(x['person_id']==task['person_id'] for x in self.state['slots']):deny('BROWSER_BUSY')
        if len(self.state['slots'])>=2:deny('BROWSER_BUSY')
        # Queued people may not be bypassed by another direct reservation.
        if self.state['queue'] and self.state['queue'][0]['task_id']!=task['task_id']:deny('BROWSER_BUSY')
        if len(self.state['dedupe'])>=128:deny('BROWSER_RATE_LIMIT')
        slot={**task,'reservation_id':str(uuid.uuid4()),'active':False,'expires_at':self.clock()+30}
        self.state['slots'].append(slot)
        response={k:slot[k] for k in ('task_id','reservation_id','expires_at')}
        self.state['dedupe'][key]={'task_id':task['task_id'],'expires_at':self.clock()+300,'response':response}
        self.persist(); return response
    def enqueue(self,task):
        self.expire(); identity(task['task_id']); identity(task['person_id'])
        if any(x['person_id']==task['person_id'] for x in self.state['queue']+self.state['slots']):deny('BROWSER_BUSY')
        if len(self.state['queue'])>=8:deny('BROWSER_QUEUE_FULL')
        self.state['queue'].append({**task,'expires_at':self.clock()+300}); self.persist()
    def offer(self):
        self.expire()
        if not self.state['queue']:return None
        task=self.state['queue'][0]
        result=self.reserve({k:task[k] for k in ('task_id','person_id','present')},str(uuid.uuid4()),self.state['generation'])
        self.state['queue'].pop(0); self.persist(); return result
    def activate(self,task,reservation,generation):
        self.expire();self.headroom()
        if generation!=self.state['generation']:deny('BROWSER_REVOKED')
        slot=next((s for s in self.state['slots'] if s['task_id']==task['task_id'] and s['reservation_id']==reservation),None)
        if slot is None:deny('BROWSER_OFFER_EXPIRED')
        if task.get('present') is not True:deny('BROWSER_ATTENDED_ONLY')
        slot['active']=True;self.state['running']=True;self.persist();return slot
    def release(self,task,reservation,generation):
        if generation!=self.state['generation']:deny('BROWSER_REVOKED')
        self.state['slots']=[s for s in self.state['slots'] if not(s['task_id']==task['task_id'] and s['reservation_id']==reservation)]
        # running is cleared only by independently confirmed process shutdown.
        self.persist()
    def tick(self):
        self.expire();m=self.metrics
        if type(m.get('oom_kill')) is int and m['oom_kill']>self.state.get('oom_kill_count',0):self.state['latched']=True
        bad=m.get('accounted') is not True or any(type(m.get(k)) is not int or m[k]<0 for k in ('available_bytes','account_bytes','browser_bytes'))
        close=self.state['latched'] or bad or m.get('account_bytes',21*G)>=21*G or m.get('available_bytes',0)<=3*G
        high=m.get('browser_bytes',0)>2.5*G
        if high and self.high_since is None:self.high_since=self.clock()
        if not high:self.high_since=None
        evict=high and self.clock()-self.high_since>=10
        if close or evict:self.state['suspended']=True
        self.persist();return {'close_all':close,'deadline_seconds':5 if close else None,'evict_idle':evict}

def checked_request(x):
    if not isinstance(x,dict) or set(x)!={'v','op','task_id','reservation_id','expected_generation','idempotency_key'} or x['v']!=1 or x['op'] not in ('reserve','activate','release','metrics') or type(x['expected_generation']) is not int or x['expected_generation']<0:deny('BROWSER_BAD_INPUT')
    identity(x['idempotency_key'])
    for k in ('task_id','reservation_id'):
        if x[k] is not None:identity(x[k])
    if x['op']=='metrics' and (x['task_id'] is not None or x['reservation_id'] is not None):deny('BROWSER_BAD_INPUT')
    if x['op']!='metrics' and x['task_id'] is None:deny('BROWSER_BAD_INPUT')
    if x['op'] in ('activate','release') and x['reservation_id'] is None:deny('BROWSER_BAD_INPUT')
    return x

def serve(*,path,controller_uid,state_file,metrics,registration,reconcile,pressure):
    """Trusted fixed adapters only. Reconcile durable DB offers while flock is held.
    No reset/SQL/launch/CDP method. Python SO_PEERCRED never comes from JSON.
    The bridge's bounded registration/metrics/pressure adapters must time out.
    """
    if os.geteuid()!=0 or path!='/run/sjcos-browser-supervisor/admission.sock':deny('BROWSER_FORBIDDEN')
    lock=os.open('/run/sjcos-browser-supervisor/admit.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    listener=socket.socket(socket.AF_UNIX);listener.bind(path);os.chmod(path,0o660);listener.listen(8);listener.settimeout(1)
    def exact(c,n):
        out=bytearray()
        while len(out)<n:
            b=c.recv(n-len(out))
            if not b:raise ValueError()
            out.extend(b)
        return out
    # Load once: an active marker is only interpreted on supervisor restart.
    s=Supervisor(state_file,metrics)
    last_tick=0
    try:
        while True:
            if time.monotonic()-last_tick>=1:
                fcntl.flock(lock,fcntl.LOCK_EX)
                try:s.metrics=metrics();pressure(s.tick());last_tick=time.monotonic()
                finally:fcntl.flock(lock,fcntl.LOCK_UN)
            try:c,_=listener.accept()
            except socket.timeout:continue
            with c:
                try:
                    c.settimeout(2)
                    pid,uid,gid=struct.unpack('3i',c.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                    if uid not in (0,controller_uid):deny('BROWSER_FORBIDDEN')
                    n=struct.unpack('!I',exact(c,4))[0]
                    if not 0<n<=8192:deny('BROWSER_BAD_INPUT')
                    x=checked_request(json.loads(exact(c,n)))
                    fcntl.flock(lock,fcntl.LOCK_EX)
                    try:
                        s.metrics=metrics();reconcile(s)
                        task=registration(x['task_id']) if x['task_id'] else None
                        op=x['op'];r=None
                        if op=='reserve':r=s.reserve(task,x['idempotency_key'],x['expected_generation'])
                        elif op=='activate':r=s.activate(task,x['reservation_id'],x['expected_generation'])
                        elif op=='release':s.release(task,x['reservation_id'],x['expected_generation'])
                        reply={'ok':True,'boot_id':metrics()['boot_id'],'generation':s.state['generation'],'reservation_id':r['reservation_id'] if r else None,'expires_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(r['expires_at'])) if r else None,'metrics':{k:s.metrics[k] for k in ('available_bytes','account_bytes','browser_bytes','accounted')}|{'latched':s.state['latched']},'code':{'reserve':'RESERVED','activate':'ACTIVE','release':'RELEASED','metrics':'METRICS'}[op]}
                    finally:fcntl.flock(lock,fcntl.LOCK_UN)
                except (BrowserError,ValueError,OSError,KeyError,TypeError) as error:
                    code=str(error) if isinstance(error,BrowserError) and str(error) in ('BROWSER_LATCHED','BROWSER_RESOURCE_LIMIT','BROWSER_BUSY','BROWSER_BAD_INPUT','BROWSER_REVOKED','BROWSER_IDEMPOTENCY_CONFLICT','BROWSER_ATTENDED_ONLY','BROWSER_OFFER_EXPIRED','BROWSER_RATE_LIMIT') else 'BROWSER_SERVICE_UNAVAILABLE'
                    reply={'ok':False,'code':code,'message':code,'retryable':code in ('BROWSER_BUSY','BROWSER_RESOURCE_LIMIT','BROWSER_SERVICE_UNAVAILABLE')}
                try:
                    b=json.dumps(reply,separators=(',',':')).encode();c.sendall(struct.pack('!I',len(b))+b)
                except OSError:pass
    finally:listener.close();os.close(lock)
