import os,sys,tempfile,importlib.util,json
spec=importlib.util.spec_from_file_location('broker',os.path.join(os.path.dirname(__file__),'root-broker.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
R='11111111-1111-4111-8111-111111111111';T='22222222-2222-4222-8222-222222222222';P='33333333-3333-4333-8333-333333333333';BOOT='44444444-4444-4444-8444-444444444444';peer={'uid':44,'pid':123}
class Child:
 pid=987654321 # never a real process
 def poll(self):return None
 def wait(self,timeout):return 0
actual={'pid':Child.pid,'startTime':'1234','uid':45,'cgroup':'0::/feature.slice\n','nodeDigest':'a'*64}
c={'controllerUid':46,'websiteUid':44,'runnerUid':45,'runnerGid':45,'nodeDigest':'a'*64,'cgroup':'/feature.slice','executables':{},'credentialFiles':{}}
def denied(fn):
 try:fn()
 except ValueError:return
 raise AssertionError('accepted forbidden request')
with tempfile.TemporaryDirectory() as d:
 broker=b.Broker(c,BOOT,d,spawn=lambda *_:(Child(),os.open('/dev/null',os.O_WRONLY)),inspect=lambda _:dict(actual),owner_uid=os.getuid(),exited=lambda _:False)
 spawn={'op':'spawnHeld','runId':R,'taskId':T,'principalId':P}
 case=sys.argv[1]
 if case=='nonfixed-executable':denied(lambda:broker.dispatch({**spawn,'executable':'/bin/sh'},peer))
 elif case=='wrong-peer':denied(lambda:broker.dispatch(spawn,{'uid':77,'pid':123}))
 else:
  child=broker.dispatch(spawn,peer);assert child['pid']==actual['pid'];reg={'op':'register','runId':R,'pid':child['pid']}
  if case=='fixed-launch':
   assert broker.dispatch(reg,peer)=={'pid':child['pid'],'start_ticks':'1234','cgroup':actual['cgroup'],'boot_id':BOOT}
   cap={'op':'bindCapability','runId':R,'pid':child['pid'],'capability_hash':'a'*64,'expires_at':'2099-01-01T00:00:00Z'}
   denied(lambda:broker.dispatch({**cap,'expires_at':'2000-01-01T00:00:00Z'},peer))
   assert broker.dispatch(cap,peer)['ok'];assert broker.dispatch({'op':'release','runId':R},peer)['ok'];assert broker.held[R]['released']
   denied(lambda:broker.dispatch({'op':'release','runId':R},peer))
  elif case=='foreign-pid':denied(lambda:broker.dispatch({**reg,'pid':os.getpid()},peer))
  elif case=='release-before-bind':denied(lambda:broker.dispatch({'op':'release','runId':R},peer))
  elif case=='stale-process':actual['startTime']='9999';denied(lambda:broker.dispatch(reg,peer))
  elif case=='cancel':broker.dispatch({'op':'cancel','runId':R},peer);assert not broker.held;assert os.path.exists(broker.path(R)+'.revoked')
  elif case=='protected-claims':
   denied(lambda:broker.dispatch({'op':'readClaim','runId':R,'kind':'browser'},peer))
   b.atomic_new(os.path.join(d,R+'.browser.claimed'),{'pid':5,'capabilitySha256':'b'*64})
   assert os.stat(broker.path(R)).st_mode&0o077==0
   proof=broker.dispatch({'op':'readClaim','runId':R,'kind':'browser'},{'uid':46,'pid':7});assert 'credentialFiles' not in proof['record'];assert proof['claim']['pid']==5
  else:raise AssertionError(case)
