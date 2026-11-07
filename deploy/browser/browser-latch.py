#!/usr/bin/python3
"""Reviewed root-only CLI; no socket/web/model reset. Never run by a builder."""
import os,sys,json,pathlib,time
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from supervisor import Supervisor,BrowserError,G
from accounting import metrics
STATE=pathlib.Path('/var/lib/sjcos-browser-supervisor/oom-latch.json')
def main():
 if os.geteuid()!=0:raise BrowserError('BROWSER_FORBIDDEN')
 # Lock shared with reservation/offer persistence.
 import fcntl
 with open('/run/sjcos-browser-supervisor/admit.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  op=sys.argv[1:]
  s=Supervisor(STATE,lambda:{},recover_running=op!=['record'])
  if op==['check']:
   fd=os.open('/etc/sjcos-browser/supervisor.json',os.O_RDONLY|os.O_NOFOLLOW)
   with os.fdopen(fd) as f:
    st=os.fstat(f.fileno())
    if st.st_uid!=0 or st.st_mode&0o077 or st.st_size>32768:raise BrowserError('BROWSER_LATCHED')
    config=json.load(f)
   m=metrics(joe_uid=config['joe_uid'],browser_uids=config['browser_uids'],common_cgroup=config['common_cgroup'],browser_cgroup=config['browser_cgroup'])
   if m['oom_kill']>s.state.get('oom_kill_count',0) or m['accounted'] is not True or m['available_bytes']<5*G or m['account_bytes']>18*G:raise BrowserError('BROWSER_LATCHED')
   if s.state['latched'] or s.state['running']:raise BrowserError('BROWSER_LATCHED')
   # Marker is durable BEFORE controller or Chromium launch.
   s.state['running']=True;s.persist()
  elif op==['record']:
   if os.environ.get('SERVICE_RESULT')!='success' or os.environ.get('EXIT_STATUS') in ('9','137','KILL'):s.state['latched']=True
   s.state['running']=False;s.persist()
  elif len(op)==3 and op[:2]==['reset','--incident']:
   import re
   if not re.fullmatch('[A-Za-z0-9_-]{1,80}',op[2]):raise BrowserError('BROWSER_BAD_INPUT')
   # Audit before clearing; exclusive append/fsync. Root reviews process/metrics
   # and cgroup OOM counters independently before invoking this command.
   fd=os.open(str(STATE)+'.reset-audit',os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
   try:os.write(fd,(json.dumps({'incident':op[2],'at':time.time(),'generation':s.state['generation']})+'\n').encode());os.fsync(fd)
   finally:os.close(fd)
   config=json.loads(pathlib.Path('/etc/sjcos-browser/supervisor.json').read_text())
   m=metrics(joe_uid=config['joe_uid'],browser_uids=config['browser_uids'],common_cgroup=config['common_cgroup'],browser_cgroup=config['browser_cgroup'])
   s.state['oom_kill_count']=m['oom_kill']
   s.state.update(latched=False,running=False,suspended=False,slots=[],queue=[],dedupe={},generation=s.state['generation']+1);s.persist()
  else:raise BrowserError('BROWSER_BAD_INPUT')
if __name__=='__main__':
 try:main()
 except (BrowserError,OSError,ValueError):print('BROWSER_LATCHED',file=sys.stderr);sys.exit(1)
