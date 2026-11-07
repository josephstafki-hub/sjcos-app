#!/bin/sh
# Coordinator only, offline. Run after independent source/hash review.
set -eu
exec /usr/bin/python3 - "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)" <<'PY'
import hashlib,json,os,pathlib,stat,sys,tempfile
source=pathlib.Path(sys.argv[1]); target=pathlib.Path('/opt/sjcos-browser')
if os.geteuid()!=0: raise SystemExit('BROWSER_INSTALL_ROOT_REQUIRED')
lock_bytes=(source/'deploy/browser/runtime-lock.json').read_bytes()
lock=json.loads(lock_bytes)
files={
 'deploy/browser/parser_adapter.py':'parser_adapter.py',
 'deploy/browser/egress_gate.py':'egress_gate.py',
 'deploy/browser/closed_dispatcher.py':'closed_dispatcher.py',
 **{'deploy/browser/'+name:name for name in ['transport_runtime.py','transport_tls.py','transport_dns.py','transport_control.py']},
 'deploy/browser/controller-adapter.mjs':'controller-adapter.mjs',
 'deploy/browser/fixtures/fixture-io.py':'fixtures/fixture-io.py',
 'deploy/browser/fixtures/network-driver.py':'fixtures/network-driver',
 'deploy/browser/fixtures/rss-driver.py':'fixtures/rss-driver',
}
def sha256(data): return hashlib.sha256(data).hexdigest()
def trusted_dir(path):
 for p in (path,*path.parents):
  st=p.lstat()
  if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o022:
   raise SystemExit('BROWSER_INSTALL_UNTRUSTED_DIRECTORY')
trusted_dir(target); trusted_dir(target/'fixtures')
# Validate ALL source bytes and installed transitive lock before first mutation.
verified={}
for src,dst in files.items():
 p=source/src
 if p.is_symlink(): raise SystemExit('BROWSER_INSTALL_SOURCE_SYMLINK')
 data=p.read_bytes(); expected=lock['files'].get(src)
 if sha256(data)!=expected: raise SystemExit('BROWSER_INSTALL_HASH_MISMATCH:'+src)
 verified[dst]=data
if sha256(verified['parser_adapter.py'])!=lock['acceptance']['parserPatchSha256']:
 raise SystemExit('BROWSER_INSTALL_PARSER_HASH_MISMATCH')
if sha256((target/'mitmproxy-requirements.lock').read_bytes())!=lock['acceptance']['pythonTransitiveLockSha256']:
 raise SystemExit('BROWSER_INSTALL_PYTHON_LOCK_MISMATCH')
verified['runtime-lock.json']=lock_bytes
# Atomic replace (never follow a destination link), safe to repeat byte-for-byte.
for dst,data in verified.items():
 path=target/dst; trusted_dir(path.parent)
 if path.is_symlink(): raise SystemExit('BROWSER_INSTALL_DESTINATION_SYMLINK')
 mode=0o755 if dst.startswith('fixtures/') else 0o644
 fd,tmp=tempfile.mkstemp(prefix='.sjc-install-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:
   f.write(data);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),mode);os.fchown(f.fileno(),0,0)
  os.replace(tmp,path)
  d=os.open(path.parent,os.O_DIRECTORY);os.fsync(d);os.close(d)
 finally:
  if os.path.exists(tmp): os.unlink(tmp)
print('Installed reviewed acceptance sources; acceptance remains OFF/unattested.')
PY
