"""Offline, reversible root provisioning for the DISABLED acceptance candidate.

No credential discovery and no live database query. DB-less unless a future
reviewed narrow-role bootstrap supplies credentials; credentialFiles stays empty.
No controller/transport evidence is fabricated. A root reviewer installs its own
public trust key and independently signed attestation AFTER real acceptance.
"""
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
import tempfile

SOURCE = Path(__file__).resolve().parents[2]
RUNTIME = Path('/opt/sjcos-browser')
HOME = Path('/var/lib/sjcos-browser')
STATE = HOME / 'acceptance-provision'
JOURNAL = STATE / 'journal.json'
UPSTREAM = '829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d'
PATCHED = '553dafa64ab61b527475f0627afadd15d84c4a9b101efe66d762e1fd752ef2da'
PATCH = 'f89e294eda3b46c3d5efd15d13f5c33f5a851fce4407e9a56ff1d47d7fb7cbad'

def fail(code):
    raise RuntimeError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def trusted(path, directory=False):
    for p in (path, *path.parents):
        s = p.lstat()
        if s.st_uid != 0 or s.st_mode & 0o022 or stat.S_ISLNK(s.st_mode):
            fail('BROWSER_PROVISION_UNTRUSTED_PATH')
    if directory and not path.is_dir():
        fail('BROWSER_PROVISION_DIRECTORY_REQUIRED')

def run(args):
    subprocess.run(args, check=True, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'},
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=120)

def atomic(file, data, mode=0o600):
    fd, name = tempfile.mkstemp(prefix='.sjc-provision-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode); os.fchown(stream.fileno(), 0, 0)
        os.replace(name, file)
        directory = os.open(file.parent, os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)

def verified_sources():
    """Freeze bytes BEFORE the first mutation, including installer inputs."""
    lock_bytes = (SOURCE/'deploy/browser/runtime-lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    files = {}
    for name, expected in lock['files'].items():
        if not (name.startswith(('deploy/browser/','lib/browser/')) or name == 'mcp/browser-tools.mjs') or '..' in name:
            fail('BROWSER_PROVISION_SOURCE_PATH')
        p = SOURCE/name
        if p.is_symlink(): fail('BROWSER_PROVISION_SOURCE_SYMLINK')
        data = p.read_bytes()
        if digest(data) != expected: fail('BROWSER_PROVISION_SOURCE_HASH:'+name)
        files[name] = data
    launcher = json.loads(files['deploy/browser/playwright-patch/launcher-files.json'])
    if any(name not in files or digest(files[name]) != expected for name,expected in launcher.items()):
        fail('BROWSER_PROVISION_LAUNCHER_HASH')
    result = json.loads(files['deploy/browser/playwright-patch/result.json'])
    if (result['upstreamBundleSha256'], result['playwrightPatchSha256'], result['patchedBundleSha256']) != (UPSTREAM,PATCH,PATCHED):
        fail('BROWSER_PROVISION_PATCH_PINS')
    if digest(files['deploy/browser/playwright-patch/target-barrier.patch.json']+b'\0'+files['deploy/browser/playwright-patch/runtime.js']) != PATCH:
        fail('BROWSER_PROVISION_PATCH_HASH')
    if lock['acceptance']['playwrightPatchSha256'] != PATCH or lock['acceptance']['patchedBundleSha256'] != PATCHED:
        fail('BROWSER_PROVISION_LOCK_PINS')
    return files, lock_bytes, lock, launcher

class Transaction:
    def __init__(self, state): self.state = state
    def save(self): atomic(JOURNAL, json.dumps(self.state, sort_keys=True).encode())
    def directory(self, path, mode=0o755):
        if path.exists():
            trusted(path, True)
            return
        self.directory(path.parent)
        # Record intent first. On interruption teardown removes only empty dirs.
        if str(path) not in self.state['directories']:
            self.state['directories'].append(str(path)); self.save()
        path.mkdir(mode=mode)
    def remember(self, path, content=True):
        key = str(path)
        if key in self.state['files']: return
        if path.is_symlink(): fail('BROWSER_PROVISION_DESTINATION_SYMLINK')
        old = None
        if path.exists():
            trusted(path)
            st=path.stat()
            if not stat.S_ISREG(st.st_mode): fail('BROWSER_PROVISION_FILE_REQUIRED')
            old={'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode)}
            if content:
                data=path.read_bytes(); old['backup']=digest(data)
                backup=STATE/('backup-'+old['backup'])
                if not backup.exists(): atomic(backup,data)
        self.state['files'][key]={'before':old,'after':None}; self.save()
    def write(self,path,data,mode=0o644):
        self.directory(path.parent)
        self.remember(path)
        # Record expected bytes BEFORE writing for interruption-safe rollback.
        self.state['files'][str(path)]['after']=digest(data); self.save()
        atomic(path,data,mode)
    def permissions(self,path,gid):
        # Symlinks in npm packages are not followed or chmodded. A link out of
        # the isolated runtime is never granted service-group permissions.
        st=path.lstat()
        if stat.S_ISLNK(st.st_mode):
            if not path.resolve().is_relative_to(RUNTIME): fail('BROWSER_PROVISION_EXTERNAL_SYMLINK')
            return
        if st.st_uid!=0 or st.st_mode&0o022: fail('BROWSER_PROVISION_WRITABLE_RUNTIME')
        key=str(path)
        if key not in self.state['permissions']:
            fail('BROWSER_PROVISION_PERMISSION_JOURNAL_MISSING')
        mode=stat.S_IMODE(st.st_mode)
        # g+rX, o-rwx, NEVER group write. Existing owner permissions preserved.
        mode=(mode|0o040|(0o010 if stat.S_ISDIR(st.st_mode) or mode&0o111 else 0))&~0o027
        os.chown(path,0,gid); os.chmod(path,mode)

def provision():
    files,lock_bytes,lock,launcher=verified_sources()
    trusted(RUNTIME,True); trusted(RUNTIME/'fixtures',True)
    if digest((RUNTIME/'mitmproxy-requirements.lock').read_bytes()) != lock['acceptance']['pythonTransitiveLockSha256']:
        fail('BROWSER_PROVISION_PYTHON_LOCK')
    core=RUNTIME/'node/node_modules/playwright-core'
    bundle=core/'lib/coreBundle.js'
    trusted(bundle)
    if json.loads((core/'package.json').read_text())['version']!='1.64.1': fail('BROWSER_PROVISION_CORE_VERSION')
    if digest(bundle.read_bytes()) not in (UPSTREAM,PATCHED): fail('BROWSER_PROVISION_CORE_HASH')
    for p in [Path('/usr/bin/node'),RUNTIME/'unbound/sbin/unbound',RUNTIME/'browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell']:
        trusted(p)
    if JOURNAL.exists():
        trusted(JOURNAL); state=json.loads(JOURNAL.read_text())
        if state['sourceLockSha256']!=digest(lock_bytes): fail('BROWSER_PROVISION_DIFFERENT_CANDIDATE_UNPROVISION_FIRST')
    else:
        # Bootstrap root-only journal before account creation or runtime edits.
        home_created=not HOME.exists()
        if home_created: HOME.mkdir(mode=0o711)
        trusted(HOME,True)
        if STATE.exists(): fail('BROWSER_PROVISION_AMBIGUOUS_STATE')
        STATE.mkdir(mode=0o700)
        state={'format':1,'sourceLockSha256':digest(lock_bytes),'homeCreated':home_created,
               'userCreated':False,'groupCreated':False,'directories':[],'files':{},'permissions':{},'complete':False}
        atomic(JOURNAL,json.dumps(state).encode())
    tx=Transaction(state)
    try: group=grp.getgrnam('sjcos-browser')
    except KeyError:
        state['groupCreated']=True;tx.save();run(['/usr/sbin/groupadd','--system','sjcos-browser']);group=grp.getgrnam('sjcos-browser')
    try: user=pwd.getpwnam('sjcos-browser')
    except KeyError:
        state['userCreated']=True;tx.save()
        run(['/usr/sbin/useradd','--system','--gid','sjcos-browser','--home-dir','/var/lib/sjcos-browser','--no-create-home','--shell','/usr/sbin/nologin','sjcos-browser'])
        user=pwd.getpwnam('sjcos-browser')
    if user.pw_uid<=0 or group.gr_gid<=0 or user.pw_gid!=group.gr_gid or user.pw_dir!='/var/lib/sjcos-browser' or user.pw_shell!='/usr/sbin/nologin':
        fail('BROWSER_PROVISION_ACCOUNT_REFUSED')
    state.update(uid=user.pw_uid,gid=group.gr_gid);tx.save()
    # Work on a root-only frozen source snapshot. The checkout is writable by
    # Joe, so root must not execute its scripts after a separate hash check.
    with tempfile.TemporaryDirectory(prefix='sources-',dir=STATE) as temp:
        frozen=Path(temp)
        for name,data in files.items():
            p=frozen/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        (frozen/'deploy/browser/runtime-lock.json').write_bytes(lock_bytes)
        if digest(bundle.read_bytes())==UPSTREAM:
            # Exact reviewed apply script writes NEW files, never mutates input.
            output=frozen/'patched'
            run(['/usr/bin/node',str(frozen/'deploy/browser/playwright-patch/apply.mjs'),str(bundle),str(output)])
            patched=(output/'coreBundle.js').read_bytes()
            if digest(patched)!=PATCHED: fail('BROWSER_PROVISION_PATCH_RESULT')
            tx.write(bundle,patched)
            tx.write(core/'lib/sjc-patch.json',(output/'sjc-patch.json').read_bytes())
        else:
            metadata=json.loads((core/'lib/sjc-patch.json').read_text())
            if metadata['playwrightPatchSha256']!=PATCH or metadata['patchedBundleSha256']!=PATCHED: fail('BROWSER_PROVISION_PATCH_METADATA')
        # Remember every destination touched by install-acceptance.sh, then use
        # that existing independently hash-checking installer as required.
        installs={'parser_adapter.py':'deploy/browser/parser_adapter.py','egress_gate.py':'deploy/browser/egress_gate.py',
                  'closed_dispatcher.py':'deploy/browser/closed_dispatcher.py',
                  **{name:'deploy/browser/'+name for name in ['transport_runtime.py','transport_tls.py','transport_dns.py','transport_control.py']},
                  'controller-adapter.mjs':'deploy/browser/controller-adapter.mjs',
                  'fixtures/fixture-io.py':'deploy/browser/fixtures/fixture-io.py','fixtures/network-driver':'deploy/browser/fixtures/network-driver.py',
                  'fixtures/rss-driver':'deploy/browser/fixtures/rss-driver.py'}
        for dst,src in installs.items():
            tx.remember(RUNTIME/dst);state['files'][str(RUNTIME/dst)]['after']=digest(files[src])
        tx.remember(RUNTIME/'runtime-lock.json');state['files'][str(RUNTIME/'runtime-lock.json')]['after']=digest(lock_bytes);tx.save()
        run(['/bin/sh',str(frozen/'deploy/browser/install-acceptance.sh')])
    for name in files:
        tx.write(RUNTIME/'node/source'/name,files[name])
    tx.write(RUNTIME/'fixtures/launcher-driver',files['deploy/browser/launcher-driver'],0o755)
    # Dedicated runtime group access exactly g+rX / o-rwx, never symlink targets.
    permission_paths=[]
    for base in (RUNTIME/'node',RUNTIME/'browsers'):
        permission_paths.append(base)
        for root,dirs,names in os.walk(base,followlinks=False):
            permission_paths.extend(Path(root)/name for name in dirs+names)
    for p in permission_paths:
        st=p.lstat()
        if stat.S_ISLNK(st.st_mode):
            if not p.resolve().is_relative_to(RUNTIME): fail('BROWSER_PROVISION_EXTERNAL_SYMLINK')
            continue
        if st.st_uid!=0 or st.st_mode&0o022: fail('BROWSER_PROVISION_WRITABLE_RUNTIME')
        original=state['files'].get(str(p),{}).get('before')
        state['permissions'].setdefault(str(p),{'gid':original['gid'] if original else st.st_gid,
                                                'mode':original['mode'] if original else stat.S_IMODE(st.st_mode)})
    tx.save() # Batch metadata intent BEFORE chmod, no multi-MiB journal per file.
    for p in permission_paths: tx.permissions(p,group.gr_gid)
    for d,mode in [('/etc/sjcos-browser',0o755),('/run/sjcos-browser',0o711),('/run/sjcos-browser/profiles',0o711),('/run/sjcos-browser/cli',0o711),('/run/sjcos-browser/registry',0o700),('/etc/sjcos-browser/runs',0o711),('/var/lib/sjcos-browser/controller-receipts',0o700)]:
        tx.directory(Path(d),mode)
    node_hash=digest(Path('/usr/bin/node').read_bytes())
    # No DSNs, fake executable digests, self-signed review or fabricated controller.
    # Broker is not started; empty credentials refuse every credential request.
    broker={'webGid':group.gr_gid,'launcherUid':0,'launcherNodeDigest':node_hash,
            'launcherDigests':[digest(files['deploy/browser/launcher-driver.mjs'])],
            'cliDigest':None,'nodeDigest':node_hash,
            'executables':{'browser':digest(files['deploy/browser/mcp-entry.mjs'])},'credentialFiles':{}}
    blockers=['root network/RSS evidence not yet collected','independent acceptance evidence/signature']
    config={'format':1,'enabled':False,'dbMode':'DB-less','uid':user.pw_uid,'gid':group.gr_gid,
            'adapter':'/opt/sjcos-browser/controller-adapter.mjs','adapterSha256':digest(files['deploy/browser/controller-adapter.mjs']),'databaseEnabled':False,'candidateRunner':'root-only-disposable','blockers':blockers,
            'caps':{'childMemory':'3G','childCpu':'150%','tasks':256,'gateMiB':384,'gateCpu':'35%','dnsMiB':64,'controllerHeapMiB':256,'contexts':2,'tabs':4}}
    tx.write(Path('/etc/sjcos-browser/launch-broker.json'),json.dumps(broker,indent=2).encode()+b'\n',0o600)
    tx.write(Path('/etc/sjcos-browser/acceptance.json'),json.dumps(config,indent=2).encode()+b'\n',0o644)
    # Installed inventory proves byte integrity, NEVER review/acceptance.
    inventory=['unbound/sbin/unbound','browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',*installs,
               'fixtures/launcher-driver','node/node_modules/playwright-core/lib/coreBundle.js','node/node_modules/playwright-core/lib/sjc-patch.json']
    inventory += ['node/source/'+name for name in files]
    manifest={'format':1,'sourceLockSha256':digest(lock_bytes),'files':{name:digest((RUNTIME/name).read_bytes()) for name in inventory}}
    tx.write(RUNTIME/'installed-hashes.json',json.dumps(manifest,indent=2).encode()+b'\n')
    state['complete']=True;tx.save()
    print('Provisioned DISABLED candidate. DB-less: no credentials created; no database accessed.')
    print('NOT acceptance-ready: '+'; '.join(blockers))

def unprovision():
    if not JOURNAL.exists():
        print('No acceptance provision journal; nothing changed.');return
    trusted(JOURNAL);state=json.loads(JOURNAL.read_text())
    # Never stop processes or destroy receipt/claim/profile evidence. Coordinator
    # must finish its disposable runs before reversing this journal.
    for name in ('profiles','cli','registry'):
        p=Path('/run/sjcos-browser')/name
        if p.exists() and any(p.iterdir()): fail('BROWSER_UNPROVISION_ACTIVE_OR_RETAINED_RUN_DATA')
    if Path('/run/sjcos-browser/launch.sock').exists(): fail('BROWSER_UNPROVISION_BROKER_STILL_RUNNING')
    # All conflicts checked BEFORE the first rollback mutation.
    for name,item in state['files'].items():
        p=Path(name)
        if p.is_symlink(): fail('BROWSER_UNPROVISION_SYMLINK')
        if p.exists():
            before=item['before']; allowed={item['after']}
            if before and 'backup' in before: allowed.add(before['backup'])
            if digest(p.read_bytes()) not in allowed: fail('BROWSER_UNPROVISION_CHANGED_FILE:'+name)
        if item['before']:
            backup=STATE/('backup-'+item['before']['backup'])
            trusted(backup)
            if digest(backup.read_bytes())!=item['before']['backup']: fail('BROWSER_UNPROVISION_BACKUP_HASH')
    if state['userCreated']:
        try: account=pwd.getpwnam('sjcos-browser')
        except KeyError: pass
        else:
            if account.pw_uid!=state.get('uid') or account.pw_dir!='/var/lib/sjcos-browser': fail('BROWSER_UNPROVISION_ACCOUNT_CHANGED')
    if state['groupCreated']:
        try: account=grp.getgrnam('sjcos-browser')
        except KeyError: pass
        else:
            if account.gr_gid!=state.get('gid'): fail('BROWSER_UNPROVISION_GROUP_CHANGED')
    for name,item in reversed(list(state['files'].items())):
        p=Path(name);before=item['before']
        if before:
            data=(STATE/('backup-'+before['backup'])).read_bytes()
            if digest(data)!=before['backup']: fail('BROWSER_UNPROVISION_BACKUP_HASH')
            atomic(p,data,before['mode']);os.chown(p,before['uid'],before['gid'])
        else: p.unlink(missing_ok=True)
    for name,before in reversed(list(state['permissions'].items())):
        p=Path(name)
        if p.exists() and not p.is_symlink(): os.chown(p,0,before['gid']);os.chmod(p,before['mode'])
    for name in reversed(state['directories']):
        p=Path(name)
        if p.exists(): p.rmdir()  # Refuse nonempty/unowned leftovers, never rm -rf.
    if state['userCreated']:
        try: pwd.getpwnam('sjcos-browser')
        except KeyError: pass
        else: run(['/usr/sbin/userdel','sjcos-browser'])
    if state['groupCreated']:
        try: grp.getgrnam('sjcos-browser')
        except KeyError: pass
        else: run(['/usr/sbin/groupdel','sjcos-browser'])
    for backup in STATE.glob('backup-*'):
        if not backup.is_file() or backup.is_symlink(): fail('BROWSER_UNPROVISION_BACKUP_TYPE')
        backup.unlink()
    JOURNAL.unlink();STATE.rmdir()
    if state['homeCreated']: HOME.rmdir()
    print('Reversed acceptance provision journal. Existing accounts/runtime preserved.')

def main():
    if sys.argv[1:] == ['--check-sources']:
        verified_sources(); print('Frozen source/hash/pin verification passed; no mutations.');return
    if os.geteuid()!=0: fail('BROWSER_PROVISION_ROOT_REQUIRED')
    if sys.argv[1:] == ['provision']: provision()
    elif sys.argv[1:] == ['unprovision']: unprovision()
    else: fail('BROWSER_PROVISION_USAGE')

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error,RuntimeError) else 'BROWSER_PROVISION_FAILED_REVIEW_JOURNAL',file=sys.stderr)
        sys.exit(1)
