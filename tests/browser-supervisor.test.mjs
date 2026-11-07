import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Expectations written before the implementation. No socket/browser/service.
const cases=[
 ['missing accounting refuses',"s.metrics['accounted']=False; denied(lambda:s.reserve(T(1),I(1),0),'BROWSER_RESOURCE_LIMIT')"],
 ['five GiB headroom required',"s.metrics['available_bytes']=5*G-1; denied(lambda:s.reserve(T(1),I(1),0),'BROWSER_RESOURCE_LIMIT')"],
 ['eighteen GiB account ceiling',"s.metrics['account_bytes']=18*G+1; denied(lambda:s.reserve(T(1),I(1),0),'BROWSER_RESOURCE_LIMIT')"],
 ['persistent latch refuses',"s.state['latched']=True; denied(lambda:s.reserve(T(1),I(1),0),'BROWSER_LATCHED')"],
 ['generation cannot be forged',"denied(lambda:s.reserve(T(1),I(1),9),'BROWSER_REVOKED')"],
 ['one person one task',"s.reserve(T(1),I(1),0); denied(lambda:s.reserve(T(2,1),I(2),0),'BROWSER_BUSY')"],
 ['two slots only',"s.reserve(T(1),I(1),0); s.reserve(T(2),I(2),0); denied(lambda:s.reserve(T(3),I(3),0),'BROWSER_BUSY')"],
 ['idempotency conflict',"s.reserve(T(1),I(1),0); denied(lambda:s.reserve(T(2),I(1),0),'BROWSER_IDEMPOTENCY_CONFLICT')"],
 ['idempotent reservation',"a=s.reserve(T(1),I(1),0); assert a==s.reserve(T(1),I(1),0)"],
 ['offer expires thirty seconds',"s.reserve(T(1),I(1),0); clock[0]+=31; s.expire(); assert not s.state['slots']"],
 ['FIFO never role priority',"s.enqueue(T(1)); s.enqueue(T(2)); assert s.offer()['task_id']==I(1)"],
 ['eight queue entries maximum',"[s.enqueue(T(n)) for n in range(1,9)]; denied(lambda:s.enqueue(T(9)),'BROWSER_QUEUE_FULL')"],
 ['queue five minute expiry',"s.enqueue(T(1)); clock[0]+=301; s.expire(); assert not s.state['queue']"],
 ['pressure fences in five seconds',"s.reserve(T(1),I(1),0); s.metrics['account_bytes']=21*G; assert s.tick()['close_all']; assert s.state['suspended']"],
 ['sustained child pressure',"s.metrics['browser_bytes']=int(2.6*G); assert not s.tick()['evict_idle']; clock[0]+=10; assert s.tick()['evict_idle']"],
 ['uncleared marker latches reboot',"s.state['running']=True; s.persist(); other=Supervisor(file,lambda:s.metrics,clock=lambda:clock[0]); assert other.state['latched']"],
 ['corrupt state fails closed',"file.write_text('{'); other=Supervisor(file,lambda:s.metrics,clock=lambda:clock[0]); assert other.state['latched']"],
 ['missing state fails closed',"other=Supervisor(file.parent/'absent',lambda:s.metrics,clock=lambda:clock[0]); assert other.state['latched']"],
];
for(const [name,body] of cases)test(name,()=>{
 const code=`import sys,tempfile,pathlib\nsys.path.insert(0,'deploy/browser')\nfrom supervisor import Supervisor,BrowserError,G\nfrom uuid import UUID\nI=lambda n:str(UUID(int=n,version=4))\nT=lambda n,p=None:{'task_id':I(n),'person_id':I(p or n),'present':True}\nclock=[1000.]\nwith tempfile.TemporaryDirectory() as d:\n file=pathlib.Path(d)/'state'\n file.write_text('{"v":1,"generation":0,"latched":false,"running":false,"slots":[],"queue":[],"dedupe":{},"suspended":false}')\n s=Supervisor(file,lambda:{'available_bytes':6*G,'account_bytes':17*G,'browser_bytes':0,'accounted':True},clock=lambda:clock[0])\n def denied(f,code):\n  try:f()\n  except BrowserError as e:assert str(e)==code,(str(e),code)\n  else:raise AssertionError('unexpected authorization')\n ${body}\n`;
 const r=spawnSync('python3',['-I','-B','-c',code],{encoding:'utf8',maxBuffer:8192});assert.equal(r.status,0,r.stderr);
});
