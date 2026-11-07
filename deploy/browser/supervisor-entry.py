#!/usr/bin/python3
"""Fixed privileged supervisor entry. Installation bridge is separately reviewed
and root-hashed. It exposes registration/reconciliation/pressure only, not SQL,
commands, CDP or a general subprocess launcher."""
import os,sys,pathlib,json,hashlib,importlib.util
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from supervisor import serve
from accounting import metrics

def protected(file,max_bytes=32768):
 p=pathlib.Path(file)
 for q in [p,*p.parents]:
  s=q.lstat()
  if q.is_symlink() or s.st_uid!=0 or s.st_mode&0o022:raise ValueError()
 b=p.read_bytes()
 if len(b)>max_bytes:raise ValueError()
 return b

def main():
 if os.geteuid()!=0 or len(sys.argv)!=1:raise ValueError()
 config=json.loads(protected('/etc/sjcos-browser/supervisor.json'))
 path='/etc/sjcos-browser/supervisor-bridge.py'
 source=protected(path)
 if hashlib.sha256(source).hexdigest()!=config['bridge_sha256']:raise ValueError()
 spec=importlib.util.spec_from_file_location('protected_bridge',path);bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
 # The bridge must verify DB queue/offers and never grant a slot from IDs alone.
 serve(path='/run/sjcos-browser-supervisor/admission.sock',controller_uid=config['controller_uid'],state_file='/var/lib/sjcos-browser-supervisor/oom-latch.json',metrics=lambda:metrics(joe_uid=config['joe_uid'],browser_uids=config['browser_uids'],common_cgroup=config['common_cgroup'],browser_cgroup=config['browser_cgroup']),registration=bridge.registration,reconcile=bridge.reconcile,pressure=bridge.pressure)
if __name__=='__main__':
 try:main()
 except Exception:print('BROWSER_SUPERVISOR_STARTUP_REFUSED',file=sys.stderr);sys.exit(1)
